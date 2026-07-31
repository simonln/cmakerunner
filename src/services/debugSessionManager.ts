import * as vscode from 'vscode';

export class DebugSessionManager implements vscode.Disposable {
  private readonly trackedSessions = new Map<vscode.DebugSession, vscode.Terminal[]>();
  private pendingSessionCount = 0;
  private readonly disposables: vscode.Disposable[] = [];

  public constructor() {
    this.disposables.push(
      vscode.debug.onDidStartDebugSession((session) => {
        if (this.pendingSessionCount <= 0) {
          return;
        }
        this.pendingSessionCount -= 1;
        this.trackedSessions.set(session, []);
      }),
      vscode.window.onDidOpenTerminal((terminal) => {
        let target: vscode.DebugSession | undefined;
        let fewest = Number.MAX_SAFE_INTEGER;
        for (const [session, terminals] of this.trackedSessions) {
          if (terminals.length < fewest) {
            fewest = terminals.length;
            target = session;
          }
        }
        if (target) {
          this.trackedSessions.get(target)!.push(terminal);
        }
      }),
      vscode.debug.onDidTerminateDebugSession((session) => {
        const terminals = this.trackedSessions.get(session);
        if (!terminals) {
          return;
        }
        this.trackedSessions.delete(session);
        for (const terminal of terminals) {
          try {
            terminal.dispose();
          } catch {
            // The terminal may have already been closed by the user.
          }
        }
      }),
    );
  }

  public async startDebugging(
    folder: vscode.WorkspaceFolder | undefined,
    config: vscode.DebugConfiguration,
  ): Promise<boolean> {
    this.pendingSessionCount += 1;
    const started = await vscode.debug.startDebugging(folder, config);
    if (!started) {
      this.pendingSessionCount -= 1;
    }
    return started;
  }

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}
