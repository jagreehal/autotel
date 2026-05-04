export type Awaitable<T> = T | Promise<T>;

export interface PluginHookContexts<
  TSetup = unknown,
  TEnrich = unknown,
  TDrain = unknown,
  TKeep = unknown,
  TRequestStart = unknown,
  TRequestFinish = unknown,
  TClientLog = unknown,
  TLogger = unknown,
> {
  setup: TSetup;
  enrich: TEnrich;
  drain: TDrain;
  keep: TKeep;
  requestStart: TRequestStart;
  requestFinish: TRequestFinish;
  clientLog: TClientLog;
  logger: TLogger;
}

export type DefaultPluginContexts = PluginHookContexts;

export interface EdgePlugin<
  Ctx extends PluginHookContexts = DefaultPluginContexts,
> {
  name: string;
  setup?: (ctx: Ctx['setup']) => Awaitable<void>;
  enrich?: (ctx: Ctx['enrich']) => Awaitable<void>;
  drain?: (ctx: Ctx['drain']) => Awaitable<void>;
  keep?: (ctx: Ctx['keep']) => Awaitable<void>;
  onRequestStart?: (ctx: Ctx['requestStart']) => void;
  onRequestFinish?: (ctx: Ctx['requestFinish']) => void;
  onClientLog?: (ctx: Ctx['clientLog']) => void;
  extendLogger?: (logger: Ctx['logger']) => void;
}

export interface PluginRunner<
  Ctx extends PluginHookContexts = DefaultPluginContexts,
> {
  readonly plugins: readonly EdgePlugin<Ctx>[];
  readonly hasEnrich: boolean;
  readonly hasDrain: boolean;
  readonly hasKeep: boolean;
  readonly hasRequestLifecycle: boolean;
  readonly hasClientLog: boolean;
  readonly hasExtendLogger: boolean;
  applyExtendLogger: (logger: Ctx['logger']) => void;
  runOnRequestStart: (ctx: Ctx['requestStart']) => void;
  runOnRequestFinish: (ctx: Ctx['requestFinish']) => void;
  runOnClientLog: (ctx: Ctx['clientLog']) => void;
  runSetup: (ctx: Ctx['setup']) => Promise<void>;
  runEnrich: (ctx: Ctx['enrich']) => Promise<void>;
  runDrain: (ctx: Ctx['drain']) => Promise<void>;
  runKeep: (ctx: Ctx['keep']) => Promise<void>;
}

export interface PluginRunnerOptions {
  logger?: Pick<Console, 'error'>;
}

function logPluginError(
  logger: Pick<Console, 'error'>,
  name: string,
  hook: string,
  error: unknown,
): void {
  logger.error(`[autotel-edge/${name}] ${hook} failed:`, error);
}

export function definePlugin<
  Ctx extends PluginHookContexts = DefaultPluginContexts,
>(plugin: EdgePlugin<Ctx>): EdgePlugin<Ctx> {
  return plugin;
}

export function createPluginRunner<
  Ctx extends PluginHookContexts = DefaultPluginContexts,
>(
  plugins: EdgePlugin<Ctx>[] = [],
  options: PluginRunnerOptions = {},
): PluginRunner<Ctx> {
  const errorLogger = options.logger ?? console;
  const byName = new Map<string, EdgePlugin<Ctx>>();

  // De-duplicate by plugin name while preserving registration order semantics.
  // The last plugin with a given name wins.
  for (const plugin of plugins) {
    byName.set(plugin.name, plugin);
  }

  const list = Array.from(byName.values());

  const hasEnrich = list.some((p) => typeof p.enrich === 'function');
  const hasDrain = list.some((p) => typeof p.drain === 'function');
  const hasKeep = list.some((p) => typeof p.keep === 'function');
  const hasRequestLifecycle = list.some(
    (p) =>
      typeof p.onRequestStart === 'function' ||
      typeof p.onRequestFinish === 'function',
  );
  const hasClientLog = list.some((p) => typeof p.onClientLog === 'function');
  const hasExtendLogger = list.some(
    (p) => typeof p.extendLogger === 'function',
  );

  return {
    plugins: list,
    hasEnrich,
    hasDrain,
    hasKeep,
    hasRequestLifecycle,
    hasClientLog,
    hasExtendLogger,

    applyExtendLogger(logger) {
      for (const plugin of list) {
        if (!plugin.extendLogger) continue;
        try {
          plugin.extendLogger(logger);
        } catch (err) {
          logPluginError(errorLogger, plugin.name, 'extendLogger', err);
        }
      }
    },

    runOnRequestStart(ctx) {
      for (const plugin of list) {
        if (!plugin.onRequestStart) continue;
        try {
          plugin.onRequestStart(ctx);
        } catch (err) {
          logPluginError(errorLogger, plugin.name, 'onRequestStart', err);
        }
      }
    },

    runOnRequestFinish(ctx) {
      for (const plugin of list) {
        if (!plugin.onRequestFinish) continue;
        try {
          plugin.onRequestFinish(ctx);
        } catch (err) {
          logPluginError(errorLogger, plugin.name, 'onRequestFinish', err);
        }
      }
    },

    runOnClientLog(ctx) {
      for (const plugin of list) {
        if (!plugin.onClientLog) continue;
        try {
          plugin.onClientLog(ctx);
        } catch (err) {
          logPluginError(errorLogger, plugin.name, 'onClientLog', err);
        }
      }
    },

    async runSetup(ctx) {
      for (const plugin of list) {
        if (!plugin.setup) continue;
        try {
          await plugin.setup(ctx);
        } catch (err) {
          logPluginError(errorLogger, plugin.name, 'setup', err);
        }
      }
    },

    async runEnrich(ctx) {
      for (const plugin of list) {
        if (!plugin.enrich) continue;
        try {
          await plugin.enrich(ctx);
        } catch (err) {
          logPluginError(errorLogger, plugin.name, 'enrich', err);
        }
      }
    },

    async runDrain(ctx) {
      const drains = list.filter((p) => typeof p.drain === 'function');
      if (drains.length === 0) return;

      await Promise.allSettled(
        drains.map(async (plugin) => {
          try {
            await plugin.drain!(ctx);
          } catch (err) {
            logPluginError(errorLogger, plugin.name, 'drain', err);
          }
        }),
      );
    },

    async runKeep(ctx) {
      for (const plugin of list) {
        if (!plugin.keep) continue;
        try {
          await plugin.keep(ctx);
        } catch (err) {
          logPluginError(errorLogger, plugin.name, 'keep', err);
        }
      }
    },
  };
}

const emptyRunner = createPluginRunner([]);

export function getEmptyPluginRunner(): PluginRunner {
  return emptyRunner;
}
