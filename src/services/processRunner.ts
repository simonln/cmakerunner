import { spawn } from 'child_process';
import * as vscode from 'vscode';

export interface ProcessResult {
  readonly exitCode: number | undefined;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly error?: Error;
}

export interface ProcessOptions {
  readonly cwd: string;
  readonly timeoutMs?: number;
  readonly token?: vscode.CancellationToken;
  readonly maxBuffer?: number;
  readonly killGraceMs?: number;
}

const DEFAULT_MAX_BUFFER = 8 * 1024 * 1024;
const DEFAULT_KILL_GRACE_MS = 2000;

export function runProcess(file: string, args: readonly string[], options: ProcessOptions): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const timeoutMs = options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : undefined;
    const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
    const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutLength = 0;
    let stderrLength = 0;
    let settled = false;
    let timedOut = false;
    let cancelled = false;
    let timeoutHandle: NodeJS.Timeout | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    let cancellationListener: vscode.Disposable | undefined;

    const child = spawn(file, [...args], {
      cwd: options.cwd,
      windowsHide: true,
      detached: process.platform !== 'win32',
    });

    const cleanup = (): void => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      if (killTimer) {
        clearTimeout(killTimer);
      }
      cancellationListener?.dispose();
    };

    const finish = (exitCode: number | undefined, error?: Error): void => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve({
        exitCode,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        timedOut,
        cancelled,
        error,
      });
    };

    const appendChunk = (chunks: Buffer[], chunk: Buffer, length: number): number => {
      if (length >= maxBuffer) {
        return length;
      }

      const remaining = maxBuffer - length;
      if (chunk.length <= remaining) {
        chunks.push(chunk);
        return length + chunk.length;
      }

      chunks.push(chunk.subarray(0, remaining));
      return maxBuffer;
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutLength = appendChunk(stdoutChunks, chunk, stdoutLength);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrLength = appendChunk(stderrChunks, chunk, stderrLength);
    });
    child.on('error', (error: Error) => finish(undefined, error));
    child.on('close', (exitCode: number | null) => finish(exitCode ?? undefined));

    const killProcessTree = (signal: NodeJS.Signals): void => {
      if (!child.pid) {
        return;
      }

      if (process.platform === 'win32') {
        try {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
        } catch {
          // The process may have already exited.
        }
        return;
      }

      try {
        process.kill(-child.pid, signal);
      } catch {
        try {
          child.kill(signal);
        } catch {
          // The process may have already exited.
        }
      }
    };

    const terminate = (): void => {
      killProcessTree('SIGTERM');
      killTimer = setTimeout(() => killProcessTree('SIGKILL'), killGraceMs);
    };

    if (timeoutMs !== undefined) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        terminate();
      }, timeoutMs);
    }

    if (options.token) {
      if (options.token.isCancellationRequested) {
        cancelled = true;
        terminate();
      } else {
        cancellationListener = options.token.onCancellationRequested(() => {
          cancelled = true;
          terminate();
        });
      }
    }
  });
}
