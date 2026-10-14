import * as path from 'path';
import * as vscode from 'vscode';
import { PresetInfo, TargetInfo } from '../models';
import { formatDuration, quoteForPowerShell, quoteForShell } from '../utils';
import { ConfigurationManager } from './configurationManager';
import { DebugSessionManager } from './debugSessionManager';
import { OutputLogger } from './outputLogger';
import { TaskExecutionEngine } from './taskExecutionEngine';

interface BuildStepResult {
  readonly succeeded: boolean;
  readonly durationMs: number;
}

export class WorkflowManager {
  public constructor(
    private readonly configurationManager: ConfigurationManager,
    private readonly taskExecutionEngine: TaskExecutionEngine,
    private readonly logger: OutputLogger,
    private readonly debugSessionManager: DebugSessionManager,
    private readonly onTargetBuilt?: (preset: PresetInfo, target: TargetInfo) => Thenable<void> | void,
  ) {}

  public async buildPreset(preset: PresetInfo): Promise<BuildStepResult> {
    await this.ensureCMakeFileApiQuery(preset);
    const variables = this.createPresetVariables(preset);
    const command = this.configurationManager.getPresetConfigureCommand(variables);
    return this.executeBuildStep({
      command,
      label: `Configure [${preset.name}]`,
      reveal: vscode.TaskRevealKind.Never,
      logName: preset.name,
      displayName: preset.displayName,
      failureVerb: 'Configure',
    });
  }

  public async buildTarget(preset: PresetInfo, target: TargetInfo): Promise<void> {
    const buildResult = await this.buildTargetStep(preset, target, vscode.TaskRevealKind.Never);

    if (!buildResult.succeeded) {
      return;
    }

    const action = await vscode.window.showInformationMessage(
      `Target ${target.displayName} built successfully in ${formatDuration(buildResult.durationMs)}.`,
      'Run',
      'Debug',
    );

    if (action === 'Run') {
      await this.runTarget(preset, target, false);
    }

    if (action === 'Debug') {
      await this.prepareDebugging(preset, target);
    }
  }

  public async runTarget(preset: PresetInfo, target: TargetInfo, buildFirst = true): Promise<void> {
    if (buildFirst && !(await this.buildTargetStep(preset, target)).succeeded) {
      return;
    }

    const runVariables = this.createVariables(preset, target);
    const runCommand = this.configurationManager.getRunCommand(runVariables);
    const runLabel = `Run ${target.displayName} [${preset.name}]`;
    this.logger.info(`Launching run task for target ${target.name}`);
    const runResult = await this.taskExecutionEngine.executeRun(runCommand, runLabel, preset.binaryDir);

    if (typeof runResult.exitCode === 'number' && runResult.exitCode !== 0) {
      this.reportRunFailure(target, runResult.exitCode);
    }
  }

  public async debugTarget(preset: PresetInfo, target: TargetInfo): Promise<void> {
    if ((await this.buildTargetStep(preset, target)).succeeded) {
      await this.prepareDebugging(preset, target);
    }
  }

  private async prepareDebugging(preset: PresetInfo, target: TargetInfo): Promise<void> {
    const variables = this.createVariables(preset, target);
    const program = this.configurationManager.resolveDebugProgram(variables);
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    if (!workspaceFolder) {
      this.logger.warn(`Unable to start debugger because no workspace folder is available for ${target.name}`);
      void vscode.window.showWarningMessage(`Unable to debug ${target.displayName} because no workspace folder is open.`);
      return;
    }

    const configurationName = `Debug ${target.displayName}`;
    const launchConfiguration = this.configurationManager.createDebugConfiguration({
      name: configurationName,
      program,
      cwd: path.dirname(program || target.guessedExecutablePath),
      args: [],
    });

    this.logger.info(`Starting debugger for ${target.name}. configuration=${JSON.stringify(launchConfiguration)}`);

    const started = await this.debugSessionManager.startDebugging(workspaceFolder, launchConfiguration);
    if (!started) {
      void vscode.window.showErrorMessage(`Unable to start debugger for ${target.displayName}.`);
    }
  }

  private createPresetVariables(preset: PresetInfo): { buildDir: string; preset: string; sourceDir: string } {
    return {
      buildDir: preset.binaryDir,
      preset: preset.name,
      sourceDir: preset.sourceDir,
    };
  }

  private createVariables(preset: PresetInfo, target: TargetInfo): { buildDir: string; preset: string; target: string; sourceDir: string; buildPreset?: string; configuration?: string; configurationArgument: string; executablePath: string; quotedExecutablePath: string; executableCommand: string; buildPresetArgument: string} {
    const configuration = target.configuration ?? preset.configuration;
    const quotedExecutablePath = quoteForShell(target.guessedExecutablePath);
    return {
      buildDir: preset.binaryDir,
      preset: preset.name,
      target: target.name,
      sourceDir: preset.sourceDir,
      buildPreset: preset.buildPresetName,
      configuration,
      configurationArgument: configuration ? ` --config ${quoteForShell(configuration)}` : '',
      executablePath: target.guessedExecutablePath,
      quotedExecutablePath,
      executableCommand: process.platform === 'win32' ? `& ${quoteForPowerShell(target.guessedExecutablePath)}` : quotedExecutablePath,
      buildPresetArgument: preset.buildPresetName ? ` --preset ${quoteForShell(preset.buildPresetName)}` : '',
    };
  }

  private async buildTargetStep(
    preset: PresetInfo,
    target: TargetInfo,
    reveal = vscode.TaskRevealKind.Always,
  ): Promise<BuildStepResult> {
    const variables = this.createVariables(preset, target);
    const result = await this.executeBuildStep({
      command: this.configurationManager.getBuildCommand(variables),
      label: `Build ${target.displayName} [${preset.name}]`,
      reveal,
      logName: target.name,
      displayName: target.displayName,
      failureVerb: 'Build',
    });

    if (result.succeeded) {
      await this.refreshTestsAfterBuild(preset, target);
    }

    return result;
  }

  private async refreshTestsAfterBuild(preset: PresetInfo, target: TargetInfo): Promise<void> {
    if (!this.onTargetBuilt) {
      return;
    }

    try {
      await this.onTargetBuilt(preset, target);
    } catch (error) {
      this.logger.warn(`Unable to refresh tests after building ${target.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async executeBuildStep(options: {
    command: string;
    label: string;
    logName: string;
    displayName: string;
    failureVerb: string;
    reveal?: vscode.TaskRevealKind;
  }): Promise<BuildStepResult> {
    const startedAt = getMonotonicNow();
    const result = await this.taskExecutionEngine.executeBuild(
      options.command,
      options.label,
      options.reveal ?? vscode.TaskRevealKind.Always,
    );
    const durationMs = Math.max(0, Math.round(getMonotonicNow() - startedAt));
    if (result.exitCode === 0) {
      return {
        succeeded: true,
        durationMs,
      };
    }

    this.reportBuildFailure(options.failureVerb, options.logName, options.displayName, result.exitCode);
    return {
      succeeded: false,
      durationMs,
    };
  }

  private reportBuildFailure(
    failureVerb: string,
    logName: string,
    displayName: string,
    exitCode: number | undefined,
  ): void {
    if (typeof exitCode !== 'number') {
      return;
    }

    this.logger.error(`${failureVerb} failed for ${logName} with exit code ${exitCode}`);
    this.notifyFailure(`${failureVerb} failed for ${displayName}. Exit code: ${exitCode}`);
  }

  private reportRunFailure(target: TargetInfo, exitCode: number): void {
    this.logger.error(`Run failed for ${target.name} with exit code ${exitCode}`);
    this.notifyFailure(`Run failed for ${target.displayName}. Exit code: ${exitCode}`);
  }

  private notifyFailure(message: string): void {
    void vscode.window.showErrorMessage(message, SHOW_TERMINAL_ACTION).then((action) => {
      if (action === SHOW_TERMINAL_ACTION) {
        return vscode.commands.executeCommand('workbench.action.terminal.focus');
      }

      return undefined;
    });
  }

  private async ensureCMakeFileApiQuery(preset: PresetInfo): Promise<void> {
    const queryDir = vscode.Uri.file(path.join(preset.binaryDir, '.cmake', 'api', 'v1', 'query'));
    const queryFile = vscode.Uri.file(path.join(queryDir.fsPath, 'codemodel-v2'));

    try {
      await vscode.workspace.fs.createDirectory(queryDir);
      await vscode.workspace.fs.writeFile(queryFile, new Uint8Array());
    } catch (error) {
      this.logger.warn(`Unable to prepare CMake File API query for ${preset.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

const SHOW_TERMINAL_ACTION = 'Show Terminal';

function getMonotonicNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}
