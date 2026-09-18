import fs from 'node:fs';
import path from 'node:path';
import pino, { type Logger as PinoLogger } from 'pino';
import type { LogEntry } from '@sevenvid/ipc';

export type Logger = PinoLogger;

export interface LogFields {
  module?: string;
  operation?: string;
  taskId?: string | null;
  model?: string | null;
  durationMs?: number | null;
  status?: string | null;
  errorId?: string | null;
}

export interface LoggerOptions {
  dir: string;
  level?: string;
  maxFileBytes?: number;
  maxFiles?: number;
  console?: boolean;
  onEntry?: (entry: LogEntry) => void;
}

/**
 * Structured JSON logger writing to a size-rotated file in the logs directory.
 * A ring buffer keeps the most recent entries for the diagnostics panel and the `log` event.
 */
export class LogHub {
  readonly logger: Logger;
  private readonly ring: LogEntry[] = [];
  private readonly ringSize = 3000;
  private readonly file: string;
  private readonly rotator: RotatingFile;

  constructor(private readonly opts: LoggerOptions) {
    fs.mkdirSync(opts.dir, { recursive: true });
    this.file = path.join(opts.dir, 'sevenvid.log');
    this.rotator = new RotatingFile(this.file, opts.maxFileBytes ?? 5 * 1024 * 1024, opts.maxFiles ?? 5);
    const stream = {
      write: (line: string) => {
        this.rotator.write(line);
        const entry = parseLine(line);
        if (entry) {
          this.ring.push(entry);
          if (this.ring.length > this.ringSize) this.ring.shift();
          this.opts.onEntry?.(entry);
        }
        if (this.opts.console) process.stderr.write(line);
      },
    };
    this.logger = pino({ level: opts.level ?? 'info', base: { pid: process.pid }, timestamp: pino.stdTimeFunctions.isoTime }, stream);
  }

  child(fields: LogFields): Logger {
    return this.logger.child(fields);
  }

  /** Returns the most recent entries (newest last), optionally filtered. */
  tail(opts: { limit?: number; level?: string; module?: string; errorId?: string } = {}): LogEntry[] {
    const min = opts.level ? levelValue(opts.level) : 0;
    let entries = this.ring.filter((e) => levelValue(e.level) >= min);
    if (opts.module) entries = entries.filter((e) => e.module === opts.module);
    if (opts.errorId) entries = entries.filter((e) => e.errorId === opts.errorId || JSON.stringify(e.raw).includes(opts.errorId!));
    return entries.slice(-(opts.limit ?? 500));
  }

  get filePath(): string {
    return this.file;
  }

  flush(): void {
    this.rotator.flush();
  }
}

class RotatingFile {
  private fd: number | null = null;
  private size = 0;
  constructor(private readonly file: string, private readonly maxBytes: number, private readonly maxFiles: number) {
    this.open();
  }
  private open(): void {
    this.fd = fs.openSync(this.file, 'a');
    this.size = fs.fstatSync(this.fd).size;
  }
  write(line: string): void {
    if (this.fd == null) this.open();
    if (this.size + line.length > this.maxBytes) this.rotate();
    try {
      fs.writeSync(this.fd!, line);
      this.size += line.length;
    } catch {
      /* logging must never throw */
    }
  }
  private rotate(): void {
    try {
      if (this.fd != null) fs.closeSync(this.fd);
      for (let i = this.maxFiles - 1; i >= 1; i--) {
        const from = `${this.file}.${i}`;
        const to = `${this.file}.${i + 1}`;
        if (fs.existsSync(from)) fs.renameSync(from, to);
      }
      if (fs.existsSync(this.file)) fs.renameSync(this.file, `${this.file}.1`);
    } catch {
      /* ignore */
    }
    this.open();
  }
  flush(): void {
    try {
      if (this.fd != null) fs.fsyncSync(this.fd);
    } catch {
      /* ignore */
    }
  }
}

const LEVELS: Record<string, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };

function levelValue(level: string | number): number {
  if (typeof level === 'number') return level;
  return LEVELS[level] ?? 30;
}

function levelName(level: number): string {
  return Object.entries(LEVELS).find(([, v]) => v === level)?.[0] ?? String(level);
}

export function parseLine(line: string): LogEntry | null {
  try {
    const raw = JSON.parse(line) as Record<string, unknown>;
    const err = raw.err as { errorId?: string } | undefined;
    return {
      time: String(raw.time ?? new Date().toISOString()),
      level: typeof raw.level === 'number' ? levelName(raw.level) : String(raw.level ?? 'info'),
      module: (raw.module as string) ?? null,
      operation: (raw.operation as string) ?? null,
      taskId: (raw.taskId as string) ?? null,
      model: (raw.model as string) ?? null,
      durationMs: typeof raw.durationMs === 'number' ? raw.durationMs : null,
      status: (raw.status as string) ?? null,
      msg: String(raw.msg ?? ''),
      errorId: (raw.errorId as string) ?? err?.errorId ?? null,
      raw,
    };
  } catch {
    return null;
  }
}
