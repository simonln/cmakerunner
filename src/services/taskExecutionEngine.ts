import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { TaskExecutionResult } from '../models';
import { ConfigurationManager } from './configurationManager';
import { OutputLogger } from './outputLogger';

interface ShellExecutionSpec {
  readonly command?: string;
  readonly options: vscode.ShellExecutionOptions;
}

export class TaskExecutionEngine {
  private readonly vcvarsallPath = findVcvarsall();

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
    const shellExecution = this.createShellExecution(command);
    const task = new vscode.Task(
      {
        type: 'shell',
        task: label,
      },
      vscode.TaskScope.Workspace,
      label,
      'psgmrunner',
      shellExecution,
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

  private createShellExecution(command: string): vscode.ShellExecution {
    const spec = this.createShellExecutionSpec(command);
    return new vscode.ShellExecution(spec.command ?? command, spec.options);
  }

  private createShellExecutionSpec(command: string): ShellExecutionSpec {
    const options: vscode.ShellExecutionOptions = { cwd: this.workspaceRoot };
    if (!shouldWrapWithVcvarsall(command) || !this.vcvarsallPath) {
      return { command, options };
    }

    const wrappedCommand = `call "${this.vcvarsallPath}" ${getVcvarsallArchitecture()} >nul 2>&1 && ${command}`;
    options.executable = process.env.comspec ?? 'cmd.exe';
    options.shellArgs = ['/d', '/s', '/c'];
    this.logger.info(`use vcvarsall, wrappedCommand: ${wrappedCommand}`);
    return {
      command: wrappedCommand,
      options,
    };
  }
}

function shouldWrapWithVcvarsall(command: string): boolean {
  return process.platform === 'win32' && /^\s*cmake(?:\.exe)?(?:\s|$)/i.test(command);
}

function findVcvarsall(): string | undefined {
  if (process.platform !== 'win32') {
    return undefined;
  }

  const fromEnv = process.env.VSINSTALLDIR
    ? path.join(process.env.VSINSTALLDIR, 'VC', 'Auxiliary', 'Build', 'vcvarsall.bat')
    : undefined;
  if (fromEnv && fs.existsSync(fromEnv)) {
    return fromEnv;
  }

  const programFilesX86 = process.env['ProgramFiles(x86)'] ?? process.env.ProgramFiles;
  if (!programFilesX86) {
    return undefined;
  }

  const vswherePath = path.join(programFilesX86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  if (!fs.existsSync(vswherePath)) {
    return undefined;
  }

  try {
    const output = execFileSync(vswherePath, [
      '-latest',
      '-products',
      '*',
      '-requires',
      'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
      '-find',
      'VC\\Auxiliary\\Build\\vcvarsall.bat',
    ], {
      encoding: 'utf8',
      windowsHide: true,
    }).trim();

    return output || undefined;
  } catch {
    return undefined;
  }
}

function getVcvarsallArchitecture(): string {
  switch (process.arch) {
    case 'ia32':
      return 'x86';
    case 'arm64':
      return 'x64_arm64';
    default:
      return 'x64';
  }
}
