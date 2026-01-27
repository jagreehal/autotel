import ora, { type Ora } from 'ora';

/**
 * Spinner wrapper for consistent usage
 */
export interface SpinnerInstance {
  start: (text?: string) => void;
  stop: () => void;
  succeed: (text?: string) => void;
  fail: (text?: string) => void;
  warn: (text?: string) => void;
  info: (text?: string) => void;
  text: (text: string) => void;
}

/**
 * Create a spinner
 */
export function createSpinner(text?: string): SpinnerInstance {
  const spinner: Ora = ora({
    text,
    spinner: 'dots',
  });

  return {
    start: (newText?: string) => {
      if (newText) spinner.text = newText;
      spinner.start();
    },
    stop: () => spinner.stop(),
    succeed: (newText?: string) => spinner.succeed(newText),
    fail: (newText?: string) => spinner.fail(newText),
    warn: (newText?: string) => spinner.warn(newText),
    info: (newText?: string) => spinner.info(newText),
    text: (newText: string) => {
      spinner.text = newText;
    },
  };
}

/**
 * Run async function with spinner
 */
export async function withSpinner<T>(
  text: string,
  fn: () => Promise<T>,
  options?: {
    successText?: string | ((result: T) => string);
    failText?: string;
  }
): Promise<T> {
  const spinner = createSpinner(text);
  spinner.start();

  try {
    const result = await fn();
    const successText =
      typeof options?.successText === 'function'
        ? options.successText(result)
        : options?.successText;
    spinner.succeed(successText);
    return result;
  } catch (error) {
    spinner.fail(options?.failText ?? `Failed: ${text}`);
    throw error;
  }
}

/**
 * No-op spinner for quiet mode or CI
 */
export function createNoopSpinner(): SpinnerInstance {
  return {
    start: () => {},
    stop: () => {},
    succeed: () => {},
    fail: () => {},
    warn: () => {},
    info: () => {},
    text: () => {},
  };
}

/**
 * Check if running in CI environment
 */
export function isCI(): boolean {
  return !!(
    process.env['CI'] ||
    process.env['CONTINUOUS_INTEGRATION'] ||
    process.env['BUILD_NUMBER'] ||
    process.env['GITHUB_ACTIONS'] ||
    process.env['GITLAB_CI'] ||
    process.env['CIRCLECI'] ||
    process.env['TRAVIS']
  );
}
