import * as path from 'node:path';
import { Project, type SourceFile, type Node, SyntaxKind } from 'ts-morph';

export interface TransformResult {
  modified: string;
  changed: boolean;
  wrappedCount: number;
  skipped: { name: string; reason: string }[];
}

export interface TransformOptions {
  namePattern?: string;
  skip?: RegExp[];
}

const TRACE_IMPORT_MODULE = 'autotel';

function hasTraceImport(sourceFile: SourceFile): boolean {
  for (const imp of sourceFile.getImportDeclarations()) {
    if (imp.getModuleSpecifierValue() !== TRACE_IMPORT_MODULE) continue;
    for (const spec of imp.getNamedImports()) {
      const name = spec.getName();
      if (name === 'trace') return true;
      const alias = spec.getAliasNode()?.getText();
      if (alias === 'trace' || name === 'trace') return true;
    }
  }
  return false;
}

function addTraceImport(sourceFile: SourceFile): void {
  if (hasTraceImport(sourceFile)) return;
  sourceFile.insertImportDeclaration(0, {
    moduleSpecifier: TRACE_IMPORT_MODULE,
    namedImports: ['trace'],
  });
}

function expandNamePattern(
  pattern: string,
  name: string,
  filePath: string,
  cwd: string
): string {
  const file = path.basename(filePath, path.extname(filePath));
  const relPath = path.relative(cwd, filePath).replaceAll('\\', '/');
  return pattern
    .replaceAll('{name}', name)
    .replaceAll('{file}', file)
    .replaceAll('{path}', relPath);
}

function getSpanName(
  name: string,
  filePath: string,
  options: TransformOptions
): string {
  if (options.namePattern) {
    return expandNamePattern(options.namePattern, name, filePath, process.cwd());
  }
  return name;
}

function shouldSkipName(name: string, options: TransformOptions): boolean {
  if (!options.skip?.length) return false;
  return options.skip.some((re) => re.test(name));
}

function isAlreadyWrapped(node: Node): boolean {
  const text = node.getText();
  const trimmed = text.trimStart();
  return trimmed.startsWith('trace(');
}

function bodyContainsSuper(body: Node): boolean {
  let found = false;
  body.forEachDescendant((desc) => {
    if (desc.getKind() === SyntaxKind.SuperKeyword) found = true;
  });
  return found;
}

function isGenerator(method: { isGenerator(): boolean }): boolean {
  return method.isGenerator?.() ?? false;
}

function isInsideTraceCall(node: Node): boolean {
  let current: Node | undefined = node.getParent();
  while (current) {
    if (current.getKind() === SyntaxKind.CallExpression) {
      const expr = (current as Node & { getExpression(): Node }).getExpression?.();
      if (expr?.getText() === 'trace') return true;
    }
    current = current.getParent();
  }
  return false;
}

/**
 * Transform a single file: wrap eligible functions in trace(), add import if needed.
 * No-op if no eligible functions or all skipped (no file change, no import added).
 */
export function transformFile(
  content: string,
  filePath: string,
  options: TransformOptions
): TransformResult {
  const skipped: { name: string; reason: string }[] = [];
  let wrappedCount = 0;

  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile(filePath, content);
  const edits: { node: Node; newText: string }[] = [];

  // Helper to record skip and return
  function skip(name: string, reason: string): boolean {
    skipped.push({ name, reason });
    return true;
  }

  // Default export function: ts-morph exposes it via getExportedDeclarations("default"), not getExportAssignment
  const defaultDecls = sourceFile.getExportedDeclarations().get('default');
  const defaultFn =
    defaultDecls?.[0] &&
    (defaultDecls[0].getKind() === SyntaxKind.FunctionDeclaration ||
      defaultDecls[0].getKind() === SyntaxKind.FunctionExpression)
      ? defaultDecls[0]
      : undefined;
  const allFns = sourceFile.getFunctions().filter((f) => !f.isOverload());
  const onlyDefaultExportFn =
    defaultFn &&
    allFns.length === 1 &&
    (allFns[0] === defaultFn || allFns[0]!.getStart() === defaultFn.getStart());

  // 1. Function declarations (including export function); skip if file has only default export fn
  for (const fn of allFns) {
    if (onlyDefaultExportFn) continue; // handle in step 2 only
    if (isInsideTraceCall(fn)) continue; // inside trace() e.g. from prior replacement
    const name = fn.getName();
    if (!name) continue; // anonymous, skip for v1
    const spanName = getSpanName(name, filePath, options);
    if (shouldSkipName(spanName, options)) {
      skip(spanName, 'name match');
      continue;
    }
    if (isAlreadyWrapped(fn)) {
      skip(spanName, 'already wrapped');
      continue;
    }
    const mod = fn.getModifiers().map((m) => m.getText()).join(' ');
    const modPrefix = mod ? mod + ' ' : '';
    const fnText = fn.getText();
    const rest = fnText.replace(/^function\s*\w*\s*/, '');
    const newText = `${modPrefix}const ${name} = trace('${spanName}', function ${name}${rest};`;
    edits.push({ node: fn, newText });
    wrappedCount += 1;
  }

  // 2. Default export function (export default function name() {})
  if (defaultFn) {
    const name = (defaultFn as { getName?: () => string }).getName?.();
    if (!name) {
      skip('(default export)', 'anonymous default export');
    } else {
      const spanName = getSpanName(name, filePath, options);
      if (shouldSkipName(spanName, options)) {
        skip(spanName, 'name match');
      } else {
        const fn = defaultFn as Node & { getParameters(): Node[]; getBody(): Node | undefined };
        const params = fn.getParameters?.() ?? [];
        const paramsText = params.map((p) => p.getText()).join(', ');
        const body = fn.getBody?.();
        const bodyText = body?.getText() ?? '{}';
        const decl = `const ${name} = trace('${spanName}', function ${name}(${paramsText}) ${bodyText};`;
        const full = decl + '\nexport default ' + name + ';';
        edits.push({ node: defaultFn, newText: full });
        wrappedCount += 1;
      }
    }
  }

  // 3. Variable declarations with arrow or function expression
  for (const stmt of sourceFile.getVariableStatements()) {
    for (const decl of stmt.getDeclarationList().getDeclarations()) {
      const init = decl.getInitializer();
      if (!init) continue;
      const kind = init.getKind();
      const isArrow = kind === SyntaxKind.ArrowFunction;
      const isFnExpr = kind === SyntaxKind.FunctionExpression;
      const isCall = kind === SyntaxKind.CallExpression;
      if (isCall) {
        const callExpr = init as Node & { getExpression(): Node };
        const exprText = callExpr.getExpression().getText();
        if (exprText === 'trace') {
          const name = decl.getName();
          if (typeof name === 'string') {
            const spanName = getSpanName(name, filePath, options);
            skipped.push({ name: spanName, reason: 'already wrapped' });
          }
          continue;
        }
      }
      if (!isArrow && !isFnExpr) continue;
      const name = decl.getName();
      if (typeof name !== 'string') continue; // array/object binding
      const spanName = getSpanName(name, filePath, options);
      if (shouldSkipName(spanName, options)) {
        skip(spanName, 'name match');
        continue;
      }
      if (isAlreadyWrapped(init)) {
        skipped.push({ name: spanName, reason: 'already wrapped' });
        continue;
      }
      const initText = init.getText();
      const newInit = `trace('${spanName}', ${initText})`;
      edits.push({ node: init, newText: newInit });
      wrappedCount += 1;
    }
  }

  // 4. Class methods
  for (const clazz of sourceFile.getClasses()) {
    const className = clazz.getName();
    if (!className) continue;
    for (const _ctor of clazz.getConstructors()) {
      skipped.push({ name: `${className}.constructor`, reason: 'constructor' });
    }
    for (const method of clazz.getMethods()) {
      const getter = method.getFirstChildByKind(SyntaxKind.GetKeyword);
      const setter = method.getFirstChildByKind(SyntaxKind.SetKeyword);
      if (getter || setter) {
        skip(method.getName() ?? '(getter/setter)', 'getter/setter');
        continue;
      }
      if (isGenerator(method)) {
        skip(`${className}.${method.getName()}`, 'generator');
        continue;
      }
      const methodName = method.getName();
      const spanName = getSpanName(`${className}.${methodName}`, filePath, options);
      if (shouldSkipName(spanName, options)) {
        skip(spanName, 'name match');
        continue;
      }
      const body = method.getBody();
      if (!body) continue;
      if (bodyContainsSuper(body)) {
        skip(spanName, 'super');
        continue;
      }
      const bodyText = body.getText();
      const innerBody = bodyText.slice(1, -1).trim();
      const isAsync = method.isAsync();
      const prefix = isAsync ? 'async ' : '';
      const newBody = `{\n  return trace('${spanName}', ${prefix}() => {\n${innerBody}\n})();\n}`;
      edits.push({ node: body, newText: newBody });
      wrappedCount += 1;
    }
  }

  // 5. Object method shorthand (const o = { method() {} })
  for (const stmt of sourceFile.getVariableStatements()) {
    for (const decl of stmt.getDeclarationList().getDeclarations()) {
      const init = decl.getInitializer();
      if (!init || init.getKind() !== SyntaxKind.ObjectLiteralExpression) continue;
      const obj = init as { getProperties(): Node[] };
      for (const prop of obj.getProperties()) {
        if (prop.getKind() !== SyntaxKind.MethodDeclaration) continue;
        const method = prop as Node & { getName(): string; getBody(): Node; isGenerator?(): boolean };
        const methodName = method.getName();
        const spanName = getSpanName(methodName, filePath, options);
        if (shouldSkipName(spanName, options)) {
          skip(spanName, 'name match');
          continue;
        }
        if (method.isGenerator?.()) {
          skip(spanName, 'generator');
          continue;
        }
        const body = method.getBody();
        if (!body) continue;
        if (bodyContainsSuper(body)) {
          skip(spanName, 'super');
          continue;
        }
        const bodyText = body.getText();
        const innerBody = bodyText.slice(1, -1).trim();
        const newBody = `{\n  return trace('${spanName}', () => {\n${innerBody}\n})();\n}`;
        edits.push({ node: body, newText: newBody });
        wrappedCount += 1;
      }
    }
  }

  // Apply edits in reverse document order so positions stay valid
  edits.sort((a, b) => b.node.getStart() - a.node.getStart());
  for (const { node, newText } of edits) {
    node.replaceWithText(newText);
  }

  if (wrappedCount > 0 && !hasTraceImport(sourceFile)) {
    addTraceImport(sourceFile);
  }

  const modified = sourceFile.getFullText();
  const changed = wrappedCount > 0;

  return {
    modified: changed ? modified : content,
    changed,
    wrappedCount,
    skipped,
  };
}
