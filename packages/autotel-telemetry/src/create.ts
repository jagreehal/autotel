import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { resolveConsent } from './consent';
import {
  composeDrains,
  createDebugDrain,
  createHttpDrain,
  createNoopDrain,
  resolveEndpoint,
} from './drain';
import { TelemetryOutbox } from './outbox';
import { sanitizeCustom, sanitizeFlags } from './sanitize';
import type {
  RunEvent,
  RunOutcome,
  SanitizedField,
  TelemetryHandle,
  TelemetryOptions,
} from './types';

interface RunContext {
  command: string;
  startedAt: number;
  custom: Record<string, boolean | number | { present: true }>;
  flags: Record<string, SanitizedField>;
}

const runStorage = new AsyncLocalStorage<RunContext>();
let activeHandle: InternalTelemetry | null = null;

class InternalTelemetry implements TelemetryHandle {
  readonly enabled: boolean;
  private readonly outbox: TelemetryOutbox;
  private readonly drain: ReturnType<typeof composeDrains>;
  private readonly options: TelemetryOptions;

  constructor(options: TelemetryOptions, enabled: boolean) {
    this.options = options;
    this.enabled = enabled;
    this.outbox = new TelemetryOutbox({ toolName: options.name });
    const endpoint = resolveEndpoint(options.endpoint);
    const drains = [
      createDebugDrain(),
      endpoint ? createHttpDrain(endpoint) : createNoopDrain(),
    ];
    this.drain = composeDrains(...drains);
  }

  set(fields: Record<string, boolean | number>): void {
    const ctx = runStorage.getStore();
    if (!ctx || !this.enabled) return;
    ctx.custom = sanitizeCustom({ ...ctx.custom, ...fields });
  }

  async finish(outcome: RunOutcome): Promise<void> {
    if (!this.enabled || !resolveConsent(this.options.name)) return;
    const ctx = runStorage.getStore();
    if (!ctx) return;

    const event: RunEvent = {
      tool: this.options.name,
      version: this.options.version,
      command: ctx.command,
      outcome,
      durationMs: Date.now() - ctx.startedAt,
      flags: ctx.flags,
      custom: Object.keys(ctx.custom).length > 0 ? ctx.custom : undefined,
      ci: Boolean(process.env.CI),
      machineId: hashMachineId(),
    };

    try {
      await this.outbox.append(event);
      const pending = await this.outbox.readAll();
      await this.drain(pending);
      await this.outbox.purge();
    } catch {
      // never throw into host CLI
    }
  }

  async flush(): Promise<void> {
    if (!this.enabled || !resolveConsent(this.options.name)) return;
    await Promise.race([
      (async () => {
        const pending = await this.outbox.readAll();
        await this.drain(pending);
        await this.outbox.purge();
      })(),
      new Promise((resolve) => setTimeout(resolve, 500)),
    ]);
  }
}

function hashMachineId(): string {
  const seed = `${process.platform}:${process.arch}:${process.env.USER ?? 'unknown'}`;
  return createHash('sha256').update(seed).digest('hex').slice(0, 16);
}

export function createTelemetry(options: TelemetryOptions): TelemetryHandle {
  const enabled = resolveConsent(options.name);
  activeHandle = new InternalTelemetry(options, enabled);
  return activeHandle;
}

export function getActiveTelemetry(): TelemetryHandle | null {
  return activeHandle;
}

export async function runWithTelemetry<T>(
  options: TelemetryOptions,
  command: string,
  argv: string[],
  fn: () => Promise<T>,
): Promise<T> {
  const handle = createTelemetry(options);
  const ctx: RunContext = {
    command,
    startedAt: Date.now(),
    custom: {},
    flags: sanitizeFlags(argv, options.allowlistedStringFlags),
  };

  return runStorage.run(ctx, async () => {
    let outcome: RunOutcome = 'success';
    try {
      return await fn();
    } catch (error) {
      outcome = 'failure';
      throw error;
    } finally {
      if (handle.enabled) {
        await handle.finish(outcome);
      }
    }
  });
}

export const telemetry = {
  set(fields: Record<string, boolean | number>) {
    activeHandle?.set(fields);
  },
};

export function withCommanderTelemetry(
  program: {
    name: () => string;
    version: () => string;
    parseAsync: (argv: string[]) => Promise<unknown>;
  },
  options?: Partial<TelemetryOptions>,
): typeof program {
  const originalParse = program.parseAsync.bind(program);
  program.parseAsync = async (argv: string[]) => {
    const command = argv[2] ?? 'help';
    return runWithTelemetry(
      {
        name: options?.name ?? program.name(),
        version: options?.version ?? program.version(),
        ...options,
      },
      command,
      argv.slice(3),
      () => originalParse(argv) as Promise<unknown>,
    ) as Promise<unknown>;
  };
  return program;
}
