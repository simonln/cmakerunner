import * as path from 'path';
import * as vscode from 'vscode';
import { PresetInfo, TargetInfo } from '../models';
import { ConfigurationManager } from './configurationManager';
import { OutputLogger } from './outputLogger';
import { TaskExecutionEngine } from './taskExecutionEngine';

export class WorkflowManager {
  public constructor(
    private readonly configurationManager: ConfigurationManager,
    private readonly taskExecutionEngine: TaskExecutionEngine,
    private readonly logger: OutputLogger,
  ) {}

  public async buildPreset(preset: PresetInfo): Promise<boolean> {
    // this.logger.info(`Starting configure for preset ${preset.name}`);
    await this.ensureCMakeFileApiQuery(preset);
    const variables = this.createPresetVariables(preset);
    const command = this.configurationManager.getPresetConfigureCommand(variables);
    const label = `CMake Runner: Configure [${preset.name}]`;
    const result = await this.taskExecutionEngine.executeBuild(command, label, vscode.TaskRevealKind.Never);

    if (result.exitCode === 0) {
    //   this.logger.info(`Configure succeeded for preset ${preset.name}`);
      return true;
    }

    if (typeof result.exitCode === 'number') {
      this.logger.error(`Configure failed for preset ${preset.name} with exit code ${result.exitCode}`);
      void vscode.window.showErrorMessage(`Configure failed for preset ${preset.displayName}. Exit code: ${result.exitCode}`);
    }

    return false;
  }

  public async buildTarget(preset: PresetInfo, target: TargetInfo): Promise<void> {
    // this.logger.info(`Starting build for target ${target.name} with preset ${preset.name}`);
    const variables = this.createVariables(preset, target);
    const command = this.configurationManager.getBuildCommand(variables);
    const label = `CMake Runner: Build ${target.displayName} [${preset.name}]`;
    const result = await this.taskExecutionEngine.executeBuild(command, label, vscode.TaskRevealKind.Never);

    if (result.exitCode === 0) {
    //   this.logger.info(`Build succeeded for target ${target.name}`);
      const action = await vscode.window.showInformationMessage(
        `Target ${target.displayName} built successfully.`,
        'Run',
        'Debug',
      );

      if (action === 'Run') {
        await this.runTarget(preset, target, false);
      }

      if (action === 'Debug') {
        await this.startDebugging(preset, target);
      }

      return;
    }

    if (typeof result.exitCode === 'number') {
      this.logger.error(`Build failed for target ${target.name} with exit code ${result.exitCode}`);
      void vscode.window.showErrorMessage(`Build failed for target ${target.displayName}. Exit code: ${result.exitCode}`);
    }
  }

  public async runTarget(preset: PresetInfo, target: TargetInfo, buildFirst = true): Promise<void> {
    // this.logger.info(`Starting run for target ${target.name} with preset ${preset.name}. buildFirst=${buildFirst}`);
    if (buildFirst) {
      const buildVariables = this.createVariables(preset, target);
      const buildCommand = this.configurationManager.getBuildCommand(buildVariables);
      const buildLabel = `CMake Runner: Build ${target.displayName} [${preset.name}]`;
      const buildResult = await this.taskExecutionEngine.executeBuild(buildCommand, buildLabel);
      if (buildResult.exitCode !== 0) {
        if (typeof buildResult.exitCode === 'number') {
          this.logger.error(`Pre-run build failed for target ${target.name} with exit code ${buildResult.exitCode}`);
          void vscode.window.showErrorMessage(`Build failed for target ${target.displayName}. Exit code: ${buildResult.exitCode}`);
        }
        return;
      }
    }

    const runVariables = this.createVariables(preset, target);
    const runCommand = this.configurationManager.getRunCommand(runVariables);
    const runLabel = `CMake Runner: Run ${target.displayName} [${preset.name}]`;
    this.logger.info(`Launching run task for target ${target.name}`);
    await this.taskExecutionEngine.executeRun(runCommand, runLabel);
  }

  public async debugTarget(preset: PresetInfo, target: TargetInfo): Promise<void> {
    // this.logger.info(`Starting debug flow for target ${target.name} with preset ${preset.name}`);
    const buildVariables = this.createVariables(preset, target);
    const buildCommand = this.configurationManager.getBuildCommand(buildVariables);
    const buildLabel = `CMake Runner: Build ${target.displayName} [${preset.name}]`;
    const result = await this.taskExecutionEngine.executeBuild(buildCommand, buildLabel);

    if (result.exitCode === 0) {
    //   this.logger.info(`Build before debug succeeded for target ${target.name}`);
      await this.startDebugging(preset, target);
      return;
    }

    if (typeof result.exitCode === 'number') {
      this.logger.error(`Build before debug failed for target ${target.name} with exit code ${result.exitCode}`);
      void vscode.window.showErrorMessage(`Build failed for target ${target.displayName}. Exit code: ${result.exitCode}`);
    }
  }

  private async startDebugging(preset: PresetInfo, target: TargetInfo): Promise<void> {
    const variables = this.createVariables(preset, target);
    const program = this.configurationManager.resolveDebugProgram(variables);
    const debugType = process.platform === 'win32' ? 'cppvsdbg' : 'cppdbg';

    // this.logger.info(`Starting debug session for ${target.name}. type=${debugType}, program=${program}`);

    const started = await vscode.debug.startDebugging(undefined, {
      name: `Debug ${target.displayName}`,
      type: debugType,
      request: 'launch',
      program,
      cwd: path.dirname(program || target.guessedExecutablePath),
      args: [],
      stopAtEntry: false,
      externalConsole: false,
    });

    if (!started) {
      this.logger.warn(`VS Code did not start a debug session for ${target.name}`);
      void vscode.window.showWarningMessage(`Unable to start a debug session for ${target.displayName}. Make sure the C/C++ debug extension is installed and the executable exists.`);
      return;
    }

    // this.logger.info(`Debug session started for ${target.name}`);
  }

  private createPresetVariables(preset: PresetInfo): { buildDir: string; preset: string; sourceDir: string } {
    return {
      buildDir: preset.binaryDir,
      preset: preset.name,
      sourceDir: preset.sourceDir,
    };
  }

  private createVariables(preset: PresetInfo, target: TargetInfo): { buildDir: string; preset: string; target: string; sourceDir: string } {
    return {
      buildDir: preset.binaryDir,
      preset: preset.name,
      target: target.name,
      sourceDir: preset.sourceDir,
    };
  }

  private async ensureCMakeFileApiQuery(preset: PresetInfo): Promise<void> {
    const queryDir = vscode.Uri.file(path.join(preset.binaryDir, '.cmake', 'api', 'v1', 'query', 'client-psgmrunner'));
    const queryFile = vscode.Uri.file(path.join(queryDir.fsPath, 'codemodel-v2'));

    try {
      await vscode.workspace.fs.createDirectory(queryDir);
      await vscode.workspace.fs.writeFile(queryFile, new Uint8Array());
    //   this.logger.info(`Prepared CMake File API query at ${queryFile.fsPath}`);
    } catch (error) {
      this.logger.warn(`Unable to prepare CMake File API query for ${preset.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
