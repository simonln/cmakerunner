import * as vscode from 'vscode';
import { TaskVariables } from '../models';
import { extractProgramPath, getDefaultExecutablePath, replaceTemplateVariables } from '../utils';

type PresetTaskVariables = Pick<TaskVariables, 'buildDir' | 'preset' | 'sourceDir'>;

export class ConfigurationManager {
  public getPresetConfigureCommand(variables: PresetTaskVariables): string {
    return replaceTemplateVariables(this.settings().get<string>('tasks.presetConfigureCommandTemplate', ''), variables);
  }

  public getBuildCommand(variables: TaskVariables): string {
    return replaceTemplateVariables(this.settings().get<string>('tasks.buildCommandTemplate', ''), variables);
  }

  public getRunCommand(variables: TaskVariables): string {
    return replaceTemplateVariables(this.settings().get<string>('tasks.runCommandTemplate', ''), variables);
  }

  public shouldClearTerminalBeforeRun(): boolean {
    return this.settings().get<boolean>('tasks.clearTerminalBeforeRun', true);
  }

  public getDebugType(): string {
    const configuredDebugType = this.settings().get<string>('debug.type', '').trim();
    if (configuredDebugType) {
      return configuredDebugType;
    }

    if (process.platform === 'win32') {
      return 'cppvsdbg';
    }

    return process.platform === 'darwin' ? 'lldb' : 'cppdbg';
  }

  public resolveDebugProgram(variables: TaskVariables): string {
    const runCommand = this.getRunCommand(variables);
    const inferredProgram = extractProgramPath(runCommand);
    return inferredProgram || variables.executablePath || getDefaultExecutablePath(variables.buildDir, variables.target);
  }

  private settings(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('cmakerunner');
  }
}
