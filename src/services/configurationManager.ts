import * as vscode from 'vscode';
import { TaskVariables } from '../models';
import { extractProgramPath, getDefaultExecutablePath, replaceTemplateVariables } from '../utils';

type PresetTaskVariables = Pick<TaskVariables, 'buildDir' | 'preset' | 'sourceDir'>;

export class ConfigurationManager {
  public getPresetConfigureCommand(variables: PresetTaskVariables): string {
    return replaceTemplateVariables(this.settings().get<string>('tasks.presetConfigureCommandTemplate', ''), variables, { quoteSpacedValues: true });
  }

  public getBuildCommand(variables: TaskVariables): string {
    return replaceTemplateVariables(this.settings().get<string>('tasks.buildCommandTemplate', ''), variables, { quoteSpacedValues: true });
  }

  public getRunCommand(variables: TaskVariables): string {
    return replaceTemplateVariables(this.settings().get<string>('tasks.runCommandTemplate', ''), variables, { quoteSpacedValues: true });
  }

  public shouldClearTerminalBeforeRun(): boolean {
    return this.settings().get<boolean>('tasks.clearTerminalBeforeRun', true);
  }

  public resolveDebugProgram(variables: TaskVariables): string {
    const runCommand = this.getRunCommand(variables);
    const inferredProgram = extractProgramPath(runCommand);
    return inferredProgram || variables.executablePath || getDefaultExecutablePath(variables.buildDir, variables.target);
  }

  public createDebugConfiguration(options: {
    readonly name: string;
    readonly program: string;
    readonly cwd: string;
    readonly args: readonly string[];
    readonly env?: Record<string, string>;
  }): vscode.DebugConfiguration {
    const template = this.getDebugConfigurationTemplate();
    return applyPlatformOverrides({
      ...template,
      name: options.name,
      request: 'launch',
      program: options.program,
      args: [...options.args],
      cwd: options.cwd,
      env: options.env
    });
  }

  private getDebugConfigurationTemplate(): vscode.DebugConfiguration {
    const launchConfiguration = this.findLaunchConfigurationTemplate();
    if (launchConfiguration) {
      return launchConfiguration;
    }

    if (hasExtension('vadimcn.vscode-lldb')) {
      return {
        name: 'Debug',
        type: 'lldb',
        expressions: 'native',
        request: 'launch',
      };
    }

    if (hasExtension('webfreak.debug')) {
      const template: vscode.DebugConfiguration = {
        name: 'Debug',
        type: process.platform === 'darwin' ? 'lldb-mi' : 'gdb',
        request: 'launch',
        valuesFormatting: 'prettyPrinters',
      };
      if (process.platform === 'darwin') {
        template.lldbmipath = '/Applications/Xcode.app/Contents/Developer/usr/bin/lldb-mi';
      }
      return template;
    }

    if (hasExtension('ms-vscode.cpptools')) {
      return {
        name: 'Debug',
        type: 'cppvsdbg',
        request: 'launch',
        linux: { type: 'cppdbg', MIMode: 'gdb' },
        darwin: { type: 'cppdbg', MIMode: 'lldb' },
        windows: { type: 'cppvsdbg' },
      };
    }

    throw new Error('No supported C/C++ debugger extension is installed. Install CodeLLDB, Native Debug, or Microsoft C/C++ to debug tests.');
  }

  private findLaunchConfigurationTemplate(): vscode.DebugConfiguration | undefined {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const launchSettings = vscode.workspace.getConfiguration('launch', workspaceFolder?.uri);
    const configurations = launchSettings.get<vscode.DebugConfiguration[]>('configurations', []);
    return configurations.find((configuration) => {
      if (configuration.request !== 'launch') {
        return false;
      }

      const platformConfiguration = getPlatformConfiguration(configuration);
      const type = typeof platformConfiguration?.type === 'string'
        ? platformConfiguration.type
        : typeof configuration.type === 'string'
          ? configuration.type
          : undefined;
      return !!type && /^(cpp|lldb|gdb)/.test(type);
    });
  }

  private settings(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('cmakerunner');
  }
}

function hasExtension(extensionId: string): boolean {
  return vscode.extensions.all.some((extension) => extension.id === extensionId);
}

function applyPlatformOverrides(configuration: vscode.DebugConfiguration): vscode.DebugConfiguration {
  const platformConfiguration = getPlatformConfiguration(configuration);
  if (!platformConfiguration) {
    return configuration;
  }

  return {
    ...configuration,
    ...platformConfiguration,
  };
}

function getPlatformConfiguration(configuration: vscode.DebugConfiguration): vscode.DebugConfiguration | undefined {
  const key = process.platform === 'win32' ? 'windows' : process.platform;
  const value = configuration[key];
  return typeof value === 'object' && value !== null ? value as vscode.DebugConfiguration : undefined;
}

function quoteArguments(args: readonly string[]): string {
  return args.map((arg) => `"${arg.replace(/"/g, '\\"')}"`).join(' ');
}

function toEnvironmentArray(env: Record<string, string> | undefined): Array<{ name: string; value: string }> | undefined {
  if (!env) {
    return undefined;
  }

  return Object.entries(env).map(([name, value]) => ({ name, value }));
}
