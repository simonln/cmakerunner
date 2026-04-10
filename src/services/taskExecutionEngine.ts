import * as vscode from 'vscode';
import { TaskExecutionResult } from '../models';
import { ConfigurationManager } from './configurationManager';
import { OutputLogger } from './outputLogger';

export class TaskExecutionEngine {
  public constructor(
    private readonly workspaceRoot: string,
    private readonly configurationManager: ConfigurationManager,
    private readonly logger: OutputLogger,
  ) {}

  public async executeBuild(
    command: string,
    label: string,
    reveal: vscode.TaskRevealKind = vscode.TaskRevealKind.Always,
  ): Promise<TaskExecutionResult> {
    return this.executeTask(command, label, ['$gcc', '$msCompile'], reveal, vscode.TaskGroup.Build);
  }

  public async executeRun(command: string, label: string): Promise<TaskExecutionResult> {
    return this.executeTask(command, label, [], vscode.TaskRevealKind.Always);
  }

  private async executeTask(
    command: string,
    label: string,
    problemMatchers: string[],
    reveal: vscode.TaskRevealKind,
    group?: vscode.TaskGroup,
  ): Promise<TaskExecutionResult> {
    this.logger.info(`Starting task ${label} with command: ${command}`);
    const task = new vscode.Task(
      {
        type: 'shell',
        task: label,
      },
      vscode.TaskScope.Workspace,
      label,
      'psgmrunner',
      new vscode.ShellExecution(command, { cwd: this.workspaceRoot }),
      problemMatchers,
    );

    if (group) {
      task.group = group;
    }

    task.presentationOptions = {
      reveal,
      focus: false,
      clear: this.configurationManager.shouldClearTerminalBeforeRun(),
      panel: vscode.TaskPanelKind.Shared,
    };

    const execution = await vscode.tasks.executeTask(task);

    return await new Promise<TaskExecutionResult>((resolve) => {
      let resolved = false;

      const finish = (exitCode: number | undefined): void => {
        if (resolved) {
          return;
        }

        resolved = true;
        endProcessDisposable.dispose();
        endTaskDisposable.dispose();
        // this.logger.info(`Finished task ${label} with exit code ${exitCode ?? 'unknown'}`);
        resolve({ exitCode });
      };

      const endProcessDisposable = vscode.tasks.onDidEndTaskProcess((event) => {
        if (event.execution === execution) {
          finish(event.exitCode);
        }
      });

      const endTaskDisposable = vscode.tasks.onDidEndTask((event) => {
        if (event.execution === execution) {
          finish(undefined);
        }
      });
    });
  }
}
