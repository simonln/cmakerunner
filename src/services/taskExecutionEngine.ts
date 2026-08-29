import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { TaskExecutionResult } from '../models';
import { ConfigurationManager } from './configurationManager';
import { OutputLogger } from './outputLogger';
import { quoteForPowerShell } from '../utils';
import { findVsWhereMatchSync } from './windowsTooling';

interface ShellExecutionSpec {
  readonly command?: string;
  readonly args?: string[];
  readonly executable?: string;
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

  public async executeRun(command: string, label: string, runDirectory?: string): Promise<TaskExecutionResult> {
    return this.executeTask(this.wrapRunCommand(command, runDirectory), label, [], vscode.TaskRevealKind.Always);
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
      'cmakerunner',
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
    if (spec.executable) {
      return new vscode.ShellExecution(spec.executable, spec.args ?? [], spec.options);
    }

    return new vscode.ShellExecution(spec.command ?? command, spec.options);
  }

  private createShellExecutionSpec(command: string): ShellExecutionSpec {
    const options: vscode.ShellExecutionOptions = { cwd: this.workspaceRoot };
    if (process.platform !== 'win32' && /^\s*cmake(?:\s|$)/.test(command)) {
      return {
        executable: '/bin/sh',
        args: ['-c', wrapPosixBuildCommand(command)],
        options,
      };
    }

    if (!isWindowsCmakeCommand(command)) {
      return { command, options };
    }

    // for windows dev
    options.executable = process.env.comspec ?? 'cmd.exe';
    options.shellArgs = ['/d', '/s', '/c'];

    if (!this.vcvarsallPath) {
      return { command, options };
    }

    const wrappedCommand = `call "${this.vcvarsallPath}" ${getVcvarsallArchitecture()} >nul 2>&1 && %SYSTEMROOT%\\System32\\chcp.com 65001 >nul 2>&1 && ${command}`;
    this.logger.info(`use vcvarsall, wrappedCommand: ${wrappedCommand}`);
    return {
      command: wrappedCommand,
      options,
    };
  }

  private wrapRunCommand(command: string, runDirectory?: string): string {
    if (!runDirectory) {
      return command;
    }

    if (process.platform === 'win32') {
      return `Push-Location ${quoteForPowerShell(runDirectory)}; try { ${command}; $cmakerunnerExitCode = if ($LASTEXITCODE -is [int]) { $LASTEXITCODE } elseif ($?) { 0 } else { 1 } } finally { Pop-Location }; exit $cmakerunnerExitCode`;
    }

    const escapedRunDirectory = runDirectory.replace(/'/g, `'\\''`);
    return `__cmakerunner_oldpwd="$PWD"; cd '${escapedRunDirectory}' && { ${command}; __cmakerunner_status=$?; cd "$__cmakerunner_oldpwd"; exit $__cmakerunner_status; }`;
  }
}

function isWindowsCmakeCommand(command: string): boolean {
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

  return findVsWhereMatchSync([
    '-latest',
    '-products',
    '*',
    '-requires',
    'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
    '-find',
    'VC\\Auxiliary\\Build\\vcvarsall.bat',
  ]);
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

function wrapPosixBuildCommand(command: string): string {
  return `trap "exit 130" INT; ${command}`;
}
