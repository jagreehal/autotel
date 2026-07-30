import * as path from 'node:path';
import * as fs from 'node:fs';
import { Project, SyntaxKind, type Node, type SourceFile } from 'ts-morph';

/**
 * One file reduced to the handful of facts the rules ask about.
 *
 * Rules read facts rather than walking the AST themselves: the walk happens
 * once per file, and a rule stays a dozen lines of "is this name here?".
 */
export interface CallFact {
  /** Full callee text, e.g. `log.set` or `trace`. */
  text: string;
  /** Rightmost name — `set` for `log.set(...)`, `trace` for `trace(...)`. */
  member: string;
  /** Leftmost identifier — `log` for `log.set(...)`, null when not an identifier. */
  root: string | null;
  line: number;
  args: number;
}

export interface ThrowFact {
  kind: 'plain-error' | 'structured' | 'other';
  line: number;
  /** Object-literal fields passed to the structured-error constructor. */
  props: ReadonlySet<string>;
  /** Stable status + literal message, used only for duplicate detection. */
  signature?: string;
  label?: string;
}

export interface CatchFact {
  line: number;
  isEmpty: boolean;
  /** Rethrows, or records the error somewhere a human or backend will see it. */
  handled: boolean;
}

export interface NetworkFact {
  name: string;
  line: number;
  handled: boolean;
}

export interface FileFacts {
  /** Local binding name → module specifier it came from. */
  imports: ReadonlyMap<string, string>;
  /** Local binding name → original imported name (`foo` for `foo as local`). */
  importedNames: ReadonlyMap<string, string>;
  /** Every module specifier imported by the file. */
  modules: ReadonlySet<string>;
  calls: readonly CallFact[];
  throws: readonly ThrowFact[];
  catches: readonly CatchFact[];
  /** Server/page data calls and whether that particular call has an error path. */
  network: readonly NetworkFact[];
  /** Local variable → factory call that produced it (e.g. `log` → `useLogger`). */
  factoryBindings: ReadonlyMap<string, string>;
  /** Identifiers and property names present in the file — for PII heuristics. */
  names: ReadonlySet<string>;
  /** Calls to a bare identifier, e.g. `trace(...)`. */
  callsTo: (name: string) => readonly CallFact[];
  /** Calls to a member, e.g. `.set(...)` regardless of receiver. */
  memberCalls: (member: string) => readonly CallFact[];
}

export function isAutotelModule(specifier: string): boolean {
  return (
    specifier === 'autotel' ||
    specifier.startsWith('autotel/') ||
    specifier.startsWith('autotel-')
  );
}

/**
 * Whether a canonical Autotel API is actually called in these facts.
 *
 * Import provenance matters: a local helper with the same name must not count.
 * Namespace and aliased imports are resolved here once for every scanner rule
 * and for project-level integration detection.
 */
export function usesAutotelApi(
  facts: FileFacts,
  names: readonly string[],
  autoImports: readonly string[] = [],
): boolean {
  return names.some((name) => {
    if (autoImports.includes(name) && facts.callsTo(name).length > 0) {
      return true;
    }
    for (const [local, module] of facts.imports) {
      if (!isAutotelModule(module)) continue;
      const imported = facts.importedNames.get(local);
      if (imported === name && facts.callsTo(local).length > 0) return true;
      if (
        imported === '*' &&
        facts.memberCalls(name).some((call) => call.root === local)
      ) {
        return true;
      }
    }
    return false;
  });
}

/** Names that mean "this error was recorded", not swallowed. */
const ERROR_SINKS = new Set([
  'error',
  'recordStructuredError',
  'recordException',
  'captureException',
  'recordError',
  'fail',
]);

/** Autotel's structured-throw constructors. */
const STRUCTURED_ERROR_NAMES = new Set([
  'createStructuredError',
  'createError',
  'AutotelError',
]);

/**
 * Read-and-parse for one scan, memoised per path.
 *
 * The adapters and the analysis want the same files, and a framework like Next
 * yields one entry point per exported method, so a file is parsed once per run
 * rather than once per entry point.
 */
export type Parser = (absolutePath: string) => SourceFile | null;

export function createParser(): Parser {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { allowJs: true, checkJs: false },
  });
  const cache = new Map<string, SourceFile | null>();

  return (absolutePath) => {
    const cached = cache.get(absolutePath);
    if (cached !== undefined) return cached;
    let file: SourceFile | null;
    try {
      if (absolutePath.endsWith('.vue')) {
        const text = fs.readFileSync(absolutePath, 'utf8');
        const scripts = [
          ...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi),
        ];
        if (scripts.length === 0) {
          file = project.createSourceFile(`${absolutePath}.ts`, '');
        } else {
          /* Preserve line numbers by blanking markup rather than concatenating
             script bodies. Evidence still points at the original SFC. */
          const chars: string[] = [...text].map((char) =>
            char === '\n' ? '\n' : ' ',
          );
          for (const match of scripts) {
            const body = match[1] ?? '';
            const bodyOffset = (match.index ?? 0) + match[0].indexOf(body);
            for (let index = 0; index < body.length; index++) {
              chars[bodyOffset + index] = body[index] ?? ' ';
            }
          }
          file = project.createSourceFile(`${absolutePath}.ts`, chars.join(''));
        }
      } else {
        file = project.addSourceFileAtPath(absolutePath);
      }
    } catch {
      file = null;
    }
    cache.set(absolutePath, file);
    return file;
  };
}

/** Rightmost name and leftmost identifier of a callee expression. */
function calleeParts(expr: Node): { member: string; root: string | null } {
  const access = expr.asKind(SyntaxKind.PropertyAccessExpression);
  if (access) {
    let root: Node = access.getExpression();
    for (;;) {
      const inner = root.asKind(SyntaxKind.PropertyAccessExpression);
      if (!inner) break;
      root = inner.getExpression();
    }
    return {
      member: access.getName(),
      root: root.isKind(SyntaxKind.Identifier) ? root.getText() : null,
    };
  }
  const text = expr.getText();
  return {
    member: text,
    root: expr.isKind(SyntaxKind.Identifier) ? text : null,
  };
}

function isEmptyBlock(block: Node | undefined): boolean {
  if (!block) return true;
  const asBlock = block.asKind(SyntaxKind.Block);
  return asBlock ? asBlock.getStatements().length === 0 : false;
}

/** Whether a catch block records the error rather than dropping it. */
function catchHandles(block: Node): boolean {
  let handled = false;
  block.forEachDescendant((node, traversal) => {
    if (node.isKind(SyntaxKind.ThrowStatement)) {
      handled = true;
      traversal.stop();
      return;
    }
    if (!node.isKind(SyntaxKind.CallExpression)) return;
    const { member } = calleeParts(node.getExpression());
    if (ERROR_SINKS.has(member)) {
      handled = true;
      traversal.stop();
    }
  });
  return handled;
}

function classifyThrow(expression: Node | undefined): ThrowFact['kind'] {
  if (!expression) return 'other';

  const newExpr = expression.asKind(SyntaxKind.NewExpression);
  if (newExpr) {
    const name = newExpr.getExpression().getText();
    if (STRUCTURED_ERROR_NAMES.has(name)) return 'structured';
    return name === 'Error' || name.endsWith('Error') ? 'plain-error' : 'other';
  }

  const call = expression.asKind(SyntaxKind.CallExpression);
  if (call) {
    const { member } = calleeParts(call.getExpression());
    if (STRUCTURED_ERROR_NAMES.has(member)) return 'structured';
    return 'other';
  }

  return 'other';
}

function classifyImportedThrow(
  expression: Node | undefined,
  imports: ReadonlyMap<string, string>,
  importedNames: ReadonlyMap<string, string>,
): ThrowFact['kind'] {
  const direct = classifyThrow(expression);
  if (direct !== 'other') return direct;
  const call =
    expression?.asKind(SyntaxKind.CallExpression) ??
    expression?.asKind(SyntaxKind.NewExpression);
  if (!call) return direct;
  const { member, root } = calleeParts(call.getExpression());
  const localModule = imports.get(member);
  if (
    STRUCTURED_ERROR_NAMES.has(importedNames.get(member) ?? '') &&
    localModule !== undefined
  ) {
    return 'structured';
  }
  if (
    root &&
    importedNames.get(root) === '*' &&
    imports.has(root) &&
    STRUCTURED_ERROR_NAMES.has(member)
  ) {
    return 'structured';
  }
  return direct;
}

function objectProperties(node: Node | undefined): ReadonlySet<string> {
  const object = node?.asKind(SyntaxKind.ObjectLiteralExpression);
  if (!object) return new Set();
  return new Set(
    object.getProperties().flatMap((property) => {
      if (
        property.isKind(SyntaxKind.PropertyAssignment) ||
        property.isKind(SyntaxKind.ShorthandPropertyAssignment) ||
        property.isKind(SyntaxKind.MethodDeclaration) ||
        property.isKind(SyntaxKind.GetAccessor) ||
        property.isKind(SyntaxKind.SetAccessor)
      ) {
        return [property.getName().replaceAll(/^['"]|['"]$/g, '')];
      }
      return [];
    }),
  );
}

function structuredProps(expression: Node | undefined): ReadonlySet<string> {
  const call = expression?.asKind(SyntaxKind.CallExpression);
  if (call) return objectProperties(call.getArguments()[0]);
  const created = expression?.asKind(SyntaxKind.NewExpression);
  return created ? objectProperties(created.getArguments()[0]) : new Set();
}

function structuredIdentity(
  expression: Node | undefined,
): { signature: string; label: string } | null {
  const call = expression?.asKind(SyntaxKind.CallExpression);
  const created = expression?.asKind(SyntaxKind.NewExpression);
  const object = (
    call?.getArguments()[0] ?? created?.getArguments()[0]
  )?.asKind(SyntaxKind.ObjectLiteralExpression);
  if (!object) return null;
  const message = object.getProperty('message');
  const status = object.getProperty('status');
  if (
    !message?.isKind(SyntaxKind.PropertyAssignment) ||
    !status?.isKind(SyntaxKind.PropertyAssignment)
  ) {
    return null;
  }
  const messageText = message.getInitializer()?.getText();
  const statusText = status.getInitializer()?.getText();
  const literal = messageText && /^(['"`])([\s\S]*)\1$/.exec(messageText);
  if (!literal?.[2] || !statusText || !/^\d+$/.test(statusText)) return null;
  return {
    signature: `${statusText}|${literal[2]}`,
    label: literal[2],
  };
}

const NETWORK_CALLS = new Set([
  'fetch',
  '$fetch',
  'useFetch',
  'useAsyncData',
  'query',
]);

function networkCallHandled(call: Node): boolean {
  for (const ancestor of call.getAncestors()) {
    if (ancestor.isKind(SyntaxKind.TryStatement)) {
      const tryBlock = ancestor.getTryBlock();
      if (
        call.getStart() >= tryBlock.getStart() &&
        call.getEnd() <= tryBlock.getEnd() &&
        ancestor.getCatchClause()
      ) {
        return true;
      }
    }
    if (ancestor.isKind(SyntaxKind.CallExpression)) {
      const expression = ancestor.getExpression();
      if (
        expression.isKind(SyntaxKind.PropertyAccessExpression) &&
        expression.getName() === 'catch'
      ) {
        return true;
      }
    }
    if (ancestor.isKind(SyntaxKind.VariableDeclaration)) {
      const name = ancestor.getNameNode();
      if (
        name.isKind(SyntaxKind.ObjectBindingPattern) &&
        name
          .getElements()
          .some((element) => element.getNameNode().getText() === 'error')
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Reduce a parsed file to {@link FileFacts} in a single walk.
 *
 * @param scope Narrows the walk to one subtree — the handler function, for a
 * framework that registers many routes in one file. Imports are always read
 * from the whole file: that is where they are.
 */
export function buildFileFacts(
  source: SourceFile,
  scope?: Node | readonly Node[],
): FileFacts {
  const imports = new Map<string, string>();
  const importedNames = new Map<string, string>();
  const modules = new Set<string>();

  for (const declaration of source.getImportDeclarations()) {
    const specifier = declaration.getModuleSpecifierValue();
    modules.add(specifier);
    const bind = (name: string, importedName = name): void => {
      imports.set(name, specifier);
      importedNames.set(name, importedName);
    };
    const defaultImport = declaration.getDefaultImport();
    if (defaultImport) bind(defaultImport.getText());
    for (const named of declaration.getNamedImports()) {
      bind(named.getAliasNode()?.getText() ?? named.getName(), named.getName());
    }
    const namespaceImport = declaration.getNamespaceImport();
    if (namespaceImport) bind(namespaceImport.getText(), '*');
  }

  const calls: CallFact[] = [];
  const throws: ThrowFact[] = [];
  const catches: CatchFact[] = [];
  const network: NetworkFact[] = [];
  const factoryBindings = new Map<string, string>();
  const names = new Set<string>();

  const visit = (node: Node): void => {
    if (node.isKind(SyntaxKind.Identifier)) {
      names.add(node.getText());
      return;
    }
    if (node.isKind(SyntaxKind.CallExpression)) {
      const { member, root } = calleeParts(node.getExpression());
      const fact = {
        text: node.getExpression().getText(),
        member,
        root,
        line: node.getStartLineNumber(),
        args: node.getArguments().length,
      };
      calls.push(fact);
      if (NETWORK_CALLS.has(member)) {
        network.push({
          name: member,
          line: fact.line,
          handled: networkCallHandled(node),
        });
      }
      return;
    }
    if (node.isKind(SyntaxKind.ThrowStatement)) {
      const identity = structuredIdentity(node.getExpression());
      const fact: ThrowFact = {
        kind: classifyImportedThrow(
          node.getExpression(),
          imports,
          importedNames,
        ),
        line: node.getStartLineNumber(),
        props: structuredProps(node.getExpression()),
      };
      if (identity) {
        fact.signature = identity.signature;
        fact.label = identity.label;
      }
      throws.push(fact);
      return;
    }
    if (node.isKind(SyntaxKind.VariableDeclaration)) {
      const initializer = node.getInitializer();
      const call = initializer?.asKind(SyntaxKind.CallExpression);
      const name = node.getNameNode();
      if (call && name.isKind(SyntaxKind.Identifier)) {
        factoryBindings.set(
          name.getText(),
          calleeParts(call.getExpression()).member,
        );
      }
    }
    if (node.isKind(SyntaxKind.CatchClause)) {
      const block = node.getBlock();
      catches.push({
        line: node.getStartLineNumber(),
        isEmpty: isEmptyBlock(block),
        handled: catchHandles(block),
      });
    }
  };

  const roots: readonly Node[] = Array.isArray(scope)
    ? scope
    : [scope ?? source];
  for (const root of roots) root.forEachDescendant(visit);

  const byName = new Map<string, CallFact[]>();
  const byMember = new Map<string, CallFact[]>();
  for (const call of calls) {
    if (call.root !== null && call.text === call.root) {
      const bucket = byName.get(call.text);
      if (bucket) bucket.push(call);
      else byName.set(call.text, [call]);
    }
    const memberBucket = byMember.get(call.member);
    if (memberBucket) memberBucket.push(call);
    else byMember.set(call.member, [call]);
  }

  const callsTo = (name: string): readonly CallFact[] => byName.get(name) ?? [];
  const memberCalls = (member: string): readonly CallFact[] =>
    byMember.get(member) ?? [];

  return {
    imports,
    importedNames,
    modules,
    calls,
    throws,
    catches,
    network,
    factoryBindings,
    names,
    callsTo,
    memberCalls,
  };
}

/** Repo-relative POSIX path — the spelling used everywhere in the map file. */
export function relativeFile(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join('/');
}

/** The source line at `line` (1-indexed), trimmed, for evidence snippets. */
export function lineSnippet(
  source: SourceFile,
  line: number,
): string | undefined {
  const text = source.getFullText().split('\n')[line - 1];
  return text?.trim() || undefined;
}
