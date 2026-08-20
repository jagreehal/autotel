import { appendFile, mkdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { getTelemetryDir } from './paths';
import type { RunEvent } from './types';

export interface TelemetryOutboxOptions {
  toolName: string;
}

/**
 * The outbox as its callers use it. Named so a test - or a tool that keeps its
 * pending runs somewhere other than a file - can supply its own.
 */
export interface OutboxLike {
  append(event: RunEvent): Promise<void>;
  readAll(): Promise<RunEvent[]>;
  purge(): Promise<void>;
}

export class TelemetryOutbox implements OutboxLike {
  private readonly dir: string;
  private readonly filePath: string;

  constructor(options: TelemetryOutboxOptions) {
    this.dir = getTelemetryDir(options.toolName);
    this.filePath = path.join(this.dir, 'outbox.ndjson');
  }

  async append(event: RunEvent): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(event)}\n`, 'utf8');
  }

  async readAll(): Promise<RunEvent[]> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      // SAFETY: every line in this file was written by append() below, which
      // serializes a RunEvent; a line that fails to parse takes the catch.
      return raw
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as RunEvent);
    } catch {
      return [];
    }
  }

  async purge(): Promise<void> {
    try {
      await unlink(this.filePath);
    } catch {
      // no outbox yet
    }
  }
}
