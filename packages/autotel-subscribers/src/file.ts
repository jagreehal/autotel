/**
 * File subscriber for autotel.
 *
 * Appends each tracked event to a file as newline-delimited JSON (NDJSON).
 * Useful for AI agents, scripts, evals, and local debugging that want
 * structured events on disk without a hosted backend. Query the file with
 * `jq`, load it into a notebook, or feed it to an agent.
 *
 * @example
 * ```typescript
 * import { Event } from 'autotel/events';
 * import { FileSubscriber } from 'autotel-subscribers/file';
 *
 * const events = new Event('worker', {
 *   subscribers: [new FileSubscriber({ path: './telemetry/events.ndjson' })],
 * });
 * ```
 */

import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { EventSubscriber, type EventPayload } from './event-subscriber-base';

export interface FileSubscriberConfig {
  /** File path to append newline-delimited JSON events to. */
  path: string;
  /** Enable or disable the subscriber. Default `true`. */
  enabled?: boolean;
  /** Pretty-print each event as indented JSON instead of one line. Default `false`. */
  pretty?: boolean;
  /** Create parent directories if they do not exist. Default `true`. */
  mkdir?: boolean;
  /**
   * Transform a payload before writing. Return `null` to skip the event.
   * Defaults to writing the normalized payload unchanged.
   */
  transform?: (payload: EventPayload) => Record<string, unknown> | null;
}

export class FileSubscriber extends EventSubscriber {
  readonly name = 'FileSubscriber';
  readonly version = '1.0.0';

  private readonly filePath: string;
  private readonly pretty: boolean;
  private readonly ensureDir: boolean;
  private readonly transform?: (
    payload: EventPayload,
  ) => Record<string, unknown> | null;

  /** Serializes writes so concurrent events never interleave on disk. */
  private writeChain: Promise<void> = Promise.resolve();
  private dirEnsured = false;

  constructor(config: FileSubscriberConfig) {
    super();
    this.filePath = config.path;
    this.enabled = config.enabled ?? true;
    this.pretty = config.pretty ?? false;
    this.ensureDir = config.mkdir ?? true;
    this.transform = config.transform;
  }

  protected async sendToDestination(payload: EventPayload): Promise<void> {
    if (!this.enabled) return;

    const record = this.transform ? this.transform(payload) : payload;
    if (record === null) return;

    const json = this.pretty
      ? JSON.stringify(record, null, 2)
      : JSON.stringify(record);
    const line = `${json}\n`;

    const run = this.writeChain.then(() => this.write(line));
    // Keep the chain ordered and alive even if one write rejects; the failed
    // write still rejects `run` so the base class can report it.
    this.writeChain = run.catch(() => {});
    await run;
  }

  private async write(line: string): Promise<void> {
    if (this.ensureDir && !this.dirEnsured) {
      const dir = path.dirname(this.filePath);
      if (dir && dir !== '.') {
        await mkdir(dir, { recursive: true });
      }
      this.dirEnsured = true;
    }
    await appendFile(this.filePath, line, 'utf8');
  }

  override async shutdown(): Promise<void> {
    await this.writeChain;
    await super.shutdown();
  }
}
