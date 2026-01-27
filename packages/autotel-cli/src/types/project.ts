/**
 * Supported package managers
 */
export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun';

/**
 * Package.json structure (partial)
 */
export interface PackageJson {
  name?: string;
  version?: string;
  type?: 'module' | 'commonjs';
  main?: string;
  exports?: Record<string, unknown>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  workspaces?: string[] | { packages: string[] };
  scripts?: Record<string, string>;
}

/**
 * Workspace information
 */
export interface WorkspaceInfo {
  isMonorepo: boolean;
  workspaceRoot: string | null;
  packageRoot: string;
  workspaceType: 'pnpm' | 'yarn' | 'npm' | 'lerna' | null;
}

/**
 * Project context discovered by CLI
 */
export interface ProjectContext {
  cwd: string;
  packageRoot: string;
  packageJson: PackageJson;
  packageJsonPath: string;
  packageManager: PackageManager;
  lockfilePath: string | null;
  workspace: WorkspaceInfo;
  hasTypeScript: boolean;
  isEsm: boolean;
}

/**
 * Existing instrumentation file detection
 */
export interface InstrumentationFile {
  path: string;
  isCliOwned: boolean;
  sections: InstrumentationSection[];
}

/**
 * Section markers in instrumentation file
 */
export type InstrumentationSection =
  | 'BACKEND'
  | 'PLUGINS'
  | 'SUBSCRIBERS'
  | 'BACKEND_CONFIG'
  | 'SUBSCRIBERS_CONFIG'
  | 'PLUGIN_INIT';

/**
 * Configuration detection result
 */
export interface ConfigDetection {
  found: boolean;
  type: 'cli-owned' | 'user-created' | 'autotel-yaml' | 'none';
  path: string | null;
  instrumentationFile: InstrumentationFile | null;
}

/**
 * Global CLI options
 */
export interface GlobalOptions {
  cwd: string;
  dryRun: boolean;
  noInstall: boolean;
  printInstallCmd: boolean;
  verbose: boolean;
  quiet: boolean;
  workspaceRoot: boolean;
}

/**
 * Init command options
 */
export interface InitOptions extends GlobalOptions {
  yes: boolean;
  preset?: string;
  force: boolean;
}

/**
 * Doctor command options
 */
export interface DoctorOptions extends GlobalOptions {
  json: boolean;
  fix: boolean;
  listChecks: boolean;
  envFile?: string;
}

/**
 * Add command options
 */
export interface AddOptions extends GlobalOptions {
  list: boolean;
  yes: boolean;
  force: boolean;
  json: boolean;
}
