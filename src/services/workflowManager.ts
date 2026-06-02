import * as path from 'path';
import { execFile } from 'child_process';
import * as vscode from 'vscode';
import { GTestCaseInfo, GTestRunResult, GTestRunSummary, PresetInfo, TargetInfo } from '../models';
import { quoteForShell } from '../utils';
import { ConfigurationManager } from './configurationManager';
import { OutputLogger } from './outputLogger';
import { TaskExecutionEngine } from './taskExecutionEngine';

interface GTestRunFailure {
  readonly filter: string;
  readonly exitCode: number;
}

interface BuildStepResult {
  readonly succeeded: boolean;
  readonly durationMs: number;
}

export class WorkflowManager {
  public constructor(
    private readonly configurationManager: ConfigurationManager,
    private readonly taskExecutionEngine: TaskExecutionEngine,
    private readonly logger: OutputLogger,
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
    await this.taskExecutionEngine.executeRun(runCommand, runLabel, preset.binaryDir);
  }

  public async runGTestCase(
    preset: PresetInfo,
    target: TargetInfo,
    buildFirst = true,
    selectedTestCase?: GTestCaseInfo,
    onCaseResult?: (result: GTestRunResult) => void,
  ): Promise<GTestRunSummary | undefined> {
    if (buildFirst && !(await this.buildTargetStep(preset, target)).succeeded) {
      return undefined;
    }

    const testCases = selectedTestCase ? [selectedTestCase] : await this.listGTestCases(preset, target);
    if (!testCases) {
      return undefined;
    }

    if (!selectedTestCase && testCases.length === 0) {
      void vscode.window.showWarningMessage(`No GoogleTest cases were found in ${target.displayName}.`);
      return undefined;
    }

    const testCase = selectedTestCase ?? await this.pickGTestCase(testCases);
    if (!testCase) {
      return undefined;
    }

    const runVariables = this.createVariables(preset, target);
    const gtestFilterArgument = `--gtest_filter=${quoteForShell(testCase.filter)}`;
    const runCommand = `${this.configurationManager.getRunCommand(runVariables)} ${gtestFilterArgument}`;
    const runLabel = `Run ${testCase.filter} [${preset.name}]`;
    this.logger.info(`Launching GoogleTest case ${testCase.filter} for target ${target.name}`);
    const result = await this.taskExecutionEngine.executeRun(runCommand, runLabel, preset.binaryDir);
    if (typeof result.exitCode !== 'number') {
      this.logger.warn(`GoogleTest run stopped after ${testCase.filter} because no exit code was reported.`);
      void vscode.window.showWarningMessage(`GoogleTest run stopped after ${testCase.filter}; no exit code was reported.`);
      return { target, results: [], stopped: true };
    }

    const runResult = this.createGTestRunResult(testCase, result.exitCode);
    onCaseResult?.(runResult);
    return { target, results: [runResult] };
  }

  public async runGTestCases(
    preset: PresetInfo,
    target: TargetInfo,
    testCases: readonly GTestCaseInfo[],
    buildFirst = true,
    onCaseResult?: (result: GTestRunResult) => void,
  ): Promise<GTestRunSummary | undefined> {
    const uniqueTestCases = this.getUniqueGTestCases(testCases);
    if (uniqueTestCases.length === 0) {
      void vscode.window.showWarningMessage(`No GoogleTest cases were selected in ${target.displayName}.`);
      return undefined;
    }

    if (buildFirst && !(await this.buildTargetStep(preset, target)).succeeded) {
      return undefined;
    }

    return this.runGTestCasesSequentially(preset, target, uniqueTestCases, onCaseResult);
  }

  public async runAllGTestCases(
    preset: PresetInfo,
    target: TargetInfo,
    buildFirst = true,
    onCaseResult?: (result: GTestRunResult) => void,
  ): Promise<GTestRunSummary | undefined> {
    if (buildFirst && !(await this.buildTargetStep(preset, target)).succeeded) {
      return undefined;
    }

    const testCases = await this.listGTestCases(preset, target);
    if (!testCases) {
      return undefined;
    }

    if (testCases.length === 0) {
      void vscode.window.showWarningMessage(`No GoogleTest cases were found in ${target.displayName}.`);
      return undefined;
    }

    return this.runGTestCasesSequentially(preset, target, testCases, onCaseResult);
  }

  public async debugGTestCase(
    preset: PresetInfo,
    target: TargetInfo,
    testCase: GTestCaseInfo,
    buildFirst = true,
  ): Promise<void> {
    if (buildFirst && !(await this.buildTargetStep(preset, target)).succeeded) {
      return;
    }

    await this.prepareGTestDebugging(preset, target, testCase);
  }

  public async debugTarget(preset: PresetInfo, target: TargetInfo): Promise<void> {
    if ((await this.buildTargetStep(preset, target)).succeeded) {
      await this.prepareDebugging(preset, target);
    }
  }

  private async prepareGTestDebugging(preset: PresetInfo, target: TargetInfo, testCase: GTestCaseInfo): Promise<void> {
    const variables = this.createVariables(preset, target);
    const program = this.configurationManager.resolveDebugProgram(variables);
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    if (!workspaceFolder) {
      this.logger.warn(`Unable to start debugger because no workspace folder is available for ${target.name}`);
      void vscode.window.showWarningMessage(`Unable to debug ${testCase.filter} because no workspace folder is open.`);
      return;
    }

    const configurationName = `Debug ${testCase.filter}`;
    const launchConfiguration = this.configurationManager.createDebugConfiguration({
      name: configurationName,
      program,
      cwd: path.dirname(program || target.guessedExecutablePath),
      args: [`--gtest_filter=${testCase.filter}`],
      env: {
        ASAN_OPTIONS: 'detect_leaks=0',
        LSAN_OPTIONS: 'detect_leaks=0',
      },
    });

    this.logger.info(`Starting debugger for GoogleTest case ${testCase.filter}. configuration=${configurationName}, program=${program}`);

    const started = await vscode.debug.startDebugging(workspaceFolder, launchConfiguration);
    if (!started) {
      void vscode.window.showErrorMessage(`Unable to start debugger for ${testCase.filter}.`);
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

    const started = await vscode.debug.startDebugging(workspaceFolder, launchConfiguration);
    if (!started) {
      void vscode.window.showErrorMessage(`Unable to start debugger for ${target.displayName}.`);
    }
  }

  private async runGTestCasesSequentially(
    preset: PresetInfo,
    target: TargetInfo,
    testCases: readonly GTestCaseInfo[],
    onCaseResult?: (result: GTestRunResult) => void,
  ): Promise<GTestRunSummary> {
    const uniqueTestCases = this.getUniqueGTestCases(testCases);
    const runVariables = this.createVariables(preset, target);
    const baseRunCommand = this.configurationManager.getRunCommand(runVariables);
    const failures: GTestRunFailure[] = [];
    const results: GTestRunResult[] = [];

    for (let index = 0; index < uniqueTestCases.length; index += 1) {
      const testCase = uniqueTestCases[index];
      const gtestFilterArgument = `--gtest_filter=${quoteForShell(testCase.filter)}`;
      const runCommand = `${baseRunCommand} ${gtestFilterArgument}`;
      const runLabel = uniqueTestCases.length === 1
        ? `Run ${testCase.filter} [${preset.name}]`
        : `Run ${testCase.filter} (${index + 1}/${uniqueTestCases.length}) [${preset.name}]`;

      this.logger.info(`Launching GoogleTest case ${testCase.filter} (${index + 1}/${uniqueTestCases.length}) for target ${target.name}`);
      const result = await this.taskExecutionEngine.executeRun(runCommand, runLabel, preset.binaryDir);
      if (typeof result.exitCode !== 'number') {
        this.logger.warn(`GoogleTest run stopped after ${testCase.filter} because no exit code was reported.`);
        void vscode.window.showWarningMessage(`GoogleTest run stopped after ${testCase.filter}; no exit code was reported.`);
        return { target, results, stopped: true };
      }

      const runResult = this.createGTestRunResult(testCase, result.exitCode);
      results.push(runResult);
      onCaseResult?.(runResult);

      if (result.exitCode !== 0) {
        failures.push({ filter: testCase.filter, exitCode: result.exitCode });
        this.logger.warn(`GoogleTest case ${testCase.filter} failed with exit code ${result.exitCode}; continuing with remaining cases.`);
      }
    }

    this.reportGTestRunFailures(target, failures, uniqueTestCases.length);
    return { target, results };
  }

  private createGTestRunResult(testCase: GTestCaseInfo, exitCode: number): GTestRunResult {
    return {
      testCase,
      exitCode,
      status: exitCode === 0 ? 'passed' : 'failed',
    };
  }

  private getUniqueGTestCases(testCases: readonly GTestCaseInfo[]): GTestCaseInfo[] {
    const seen = new Set<string>();
    const uniqueTestCases: GTestCaseInfo[] = [];

    for (const testCase of testCases) {
      if (!testCase.filter || seen.has(testCase.filter)) {
        continue;
      }

      seen.add(testCase.filter);
      uniqueTestCases.push(testCase);
    }

    return uniqueTestCases;
  }

  private reportGTestRunFailures(target: TargetInfo, failures: readonly GTestRunFailure[], totalCount: number): void {
    if (failures.length === 0) {
      return;
    }

    const failureDetails = failures.map((failure) => `${failure.filter} (exit code ${failure.exitCode})`).join(', ');
    this.logger.error(`${failures.length} of ${totalCount} GoogleTest case(s) failed in ${target.name}: ${failureDetails}`);
    void vscode.window.showErrorMessage(`${failures.length} of ${totalCount} GoogleTest cases failed in ${target.displayName}. Check the terminal output for details.`);
  }

  public async listGTestCases(preset: PresetInfo, target: TargetInfo): Promise<GTestCaseInfo[] | undefined> {
    try {
      const output = await execFileText(target.guessedExecutablePath, ['--gtest_list_tests'], preset.binaryDir);
      const testCases = parseGTestListOutput(output);
      this.logger.info(`Discovered ${testCases.length} GoogleTest case(s) in ${target.name}`);
      return testCases;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Unable to list GoogleTest cases for ${target.name}: ${message}`);
      void vscode.window.showErrorMessage(`Unable to list GoogleTest cases for ${target.displayName}. ${message}`);
      return undefined;
    }
  }

  private async pickGTestCase(testCases: GTestCaseInfo[]): Promise<GTestCaseInfo | undefined> {
    const picked = await vscode.window.showQuickPick(
      testCases.map((testCase) => ({
        label: testCase.name,
        description: testCase.suite,
        detail: testCase.filter,
        testCase,
      })),
      {
        placeHolder: 'Select a GoogleTest case to run',
        matchOnDescription: true,
        matchOnDetail: true,
      },
    );

    return picked?.testCase;
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
      configurationArgument: configuration ? ` --config ${configuration}` : '',
      executablePath: target.guessedExecutablePath,
      quotedExecutablePath,
      executableCommand: process.platform === 'win32' ? `& ${quotedExecutablePath}` : quotedExecutablePath,
      buildPresetArgument: preset.buildPresetName ? ` --preset ${preset.buildPresetName}` : '',
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
    void vscode.window.showErrorMessage(`${failureVerb} failed for ${displayName}. Exit code: ${exitCode}`);
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

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  const seconds = durationMs / 1000;
  return `${seconds.toFixed(seconds >= 10 ? 0 : 1)} s`;
}

function getMonotonicNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function execFileText(file: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { cwd, timeout: 15000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const stderrText = stderr.trim();
        reject(new Error(stderrText || error.message));
        return;
      }

      resolve(stdout);
    });
  });
}

export function parseGTestListOutput(output: string): GTestCaseInfo[] {
  const testCases: GTestCaseInfo[] = [];
  let currentSuite = '';

  for (const line of output.split(/\r?\n/)) {
    const withoutComment = line.replace(/\s+#.*$/, '').trimEnd();
    if (!withoutComment.trim()) {
      continue;
    }

    if (!/^\s/.test(withoutComment) && withoutComment.endsWith('.')) {
      currentSuite = withoutComment.slice(0, -1).trim();
      continue;
    }

    const testName = withoutComment.trim();
    if (!currentSuite || !testName) {
      continue;
    }

    const filter = `${currentSuite}.${testName}`;
    testCases.push({
      suite: currentSuite,
      name: testName,
      filter,
    });
  }

  return testCases;
}
