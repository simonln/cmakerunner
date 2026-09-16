import * as assert from 'assert';
import * as vscode from 'vscode';
import { runProcess } from '../src/services/processRunner';

describe('process runner', () => {
  const nodeArgs = (script: string): string[] => ['-e', script];

  it('resolves stdout and a zero exit code', async () => {
    const result = await runProcess(process.execPath, nodeArgs('console.log("hello")'), { cwd: process.cwd() });

    assert.strictEqual(result.exitCode, 0);
    assert.ok(result.stdout.includes('hello'));
    assert.strictEqual(result.timedOut, false);
    assert.strictEqual(result.cancelled, false);
  });

  it('reports non-zero exit codes', async () => {
    const result = await runProcess(process.execPath, nodeArgs('process.exit(3)'), { cwd: process.cwd() });

    assert.strictEqual(result.exitCode, 3);
    assert.strictEqual(result.timedOut, false);
  });

  it('kills the process when the timeout elapses', async () => {
    const result = await runProcess(process.execPath, nodeArgs('setTimeout(() => {}, 60000)'), {
      cwd: process.cwd(),
      timeoutMs: 300,
      killGraceMs: 200,
    });

    assert.strictEqual(result.timedOut, true);
    assert.strictEqual(result.cancelled, false);
  });

  it('kills the process when the cancellation token fires', async () => {
    let cancel: (() => void) | undefined;
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: (listener: () => void) => {
        cancel = listener;
        return { dispose: () => { cancel = undefined; } };
      },
    } as unknown as vscode.CancellationToken;

    const pending = runProcess(process.execPath, nodeArgs('setTimeout(() => {}, 60000)'), {
      cwd: process.cwd(),
      token,
      killGraceMs: 200,
    });

    setTimeout(() => {
      (token as { isCancellationRequested: boolean }).isCancellationRequested = true;
      cancel?.();
    }, 100);

    const result = await pending;
    assert.strictEqual(result.cancelled, true);
    assert.strictEqual(result.timedOut, false);
  });
});
