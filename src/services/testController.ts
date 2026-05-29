import * as fs from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
import * as vscode from 'vscode';
import { GTestCaseInfo, PresetInfo, TargetInfo } from '../models';
import { normalizePath } from '../utils';
import { findGTestSourceLocation } from './gtestSourceLocator';
import { OutputLogger } from './outputLogger';
import { parseGTestListOutput } from './workflowManager';
import { ConfigurationManager } from './configurationManager';

interface TestExecutable {
  readonly path: string;
  readonly cwd: string;
  readonly target?: TargetInfo;
}

interface ExecutableNode {
  readonly kind: 'executable';
  readonly executable: TestExecutable;
}

interface SuiteNode {
  readonly kind: 'suite';
  readonly executable: TestExecutable;
  readonly suite: string;
}

interface CaseNode {
  readonly kind: 'case';
  readonly executable: TestExecutable;
  readonly testCase: GTestCaseInfo;
}

type Node = ExecutableNode | SuiteNode | CaseNode;

interface ExecResult {
  readonly exitCode: number | undefined;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: Error;
}

export class GTestTestController implements vscode.Disposable {
  private readonly controller: vscode.TestController;
  private readonly nodes = new Map<string, Node>();
  private preset?: PresetInfo;
  private targets: TargetInfo[] = [];
  private discoverInProgress?: Promise<void>;

  public constructor(
    private readonly configurationManager: ConfigurationManager,
    private readonly logger: OutputLogger,
  ) {
    this.controller = vscode.tests.createTestController('cmakerunner.gtests', 'CMake Runner GTests');
    this.controller.refreshHandler = async () => this.discover();
    this.controller.createRunProfile('Run', vscode.TestRunProfileKind.Run, (request, token) => this.run(request, token), true);
    this.controller.createRunProfile('Debug', vscode.TestRunProfileKind.Debug, (request, token) => this.debug(request, token), true);
  }

  public dispose(): void {
    this.controller.dispose();
  }

  public setPreset(preset: PresetInfo | undefined): void {
    this.preset = preset;
  }

  public setTargets(targets: readonly TargetInfo[]): void {
    this.targets = [...targets];
  }

  public async discover(): Promise<void> {
    if (this.discoverInProgress) {
      return this.discoverInProgress;
    }

    this.discoverInProgress = this.discoverExecutables().finally(() => {
      this.discoverInProgress = undefined;
    });
    return this.discoverInProgress;
  }

  private async discoverExecutables(): Promise<void> {
    this.controller.items.replace([]);
    this.nodes.clear();

    const preset = this.preset;
    if (!preset) {
      return;
    }

    const executablePaths = await findExecutableFiles(preset.binaryDir);
    let discoveredCount = 0;

    for (const executablePath of executablePaths) {
      const listResult = await execFileResult(executablePath, ['--gtest_list_tests'], preset.binaryDir, 15000);
      if (listResult.exitCode !== 0) {
        continue;
      }

      const testCases = parseGTestListOutput(listResult.stdout);
      if (testCases.length === 0) {
        continue;
      }

      await this.addExecutable(preset, executablePath, testCases);
      discoveredCount += testCases.length;
    }

    this.logger.info(`Registered ${discoveredCount} GoogleTest case(s) from ${executablePaths.length} executable candidate(s) in ${preset.binaryDir}`);
  }

  private async addExecutable(preset: PresetInfo, executablePath: string, testCases: readonly GTestCaseInfo[]): Promise<void> {
    const target = this.findTargetForExecutable(executablePath);
    const executable: TestExecutable = {
      path: executablePath,
      cwd: preset.binaryDir,
      target,
    };
    const executableId = createExecutableId(executablePath);
    const executableItem = this.controller.createTestItem(executableId, target?.displayName ?? path.basename(executablePath), vscode.Uri.file(executablePath));
    executableItem.description = path.relative(preset.binaryDir, executablePath) || path.basename(executablePath);
    executableItem.canResolveChildren = false;
    this.nodes.set(executableId, { kind: 'executable', executable });

    const suites = new Map<string, vscode.TestItem>();
    for (const testCase of testCases) {
      let suiteItem = suites.get(testCase.suite);
      if (!suiteItem) {
        const suiteId = createSuiteId(executableId, testCase.suite);
        suiteItem = this.controller.createTestItem(suiteId, testCase.suite, vscode.Uri.file(executablePath));
        suites.set(testCase.suite, suiteItem);
        executableItem.children.add(suiteItem);
        this.nodes.set(suiteId, { kind: 'suite', executable, suite: testCase.suite });
      }

      const caseId = createCaseId(executableId, testCase.filter);
      const location = await this.findCaseLocation(executable, testCase);
      const caseItem = this.controller.createTestItem(
        caseId,
        testCase.name,
        vscode.Uri.file(location?.filePath ?? executablePath),
      );
      caseItem.description = testCase.suite;
      if (location) {
        const position = new vscode.Position(location.line, location.character);
        caseItem.range = new vscode.Range(position, position);
      }
      suiteItem.children.add(caseItem);
      this.nodes.set(caseId, { kind: 'case', executable, testCase });
    }

    this.controller.items.add(executableItem);
  }

  private async findCaseLocation(executable: TestExecutable, testCase: GTestCaseInfo): Promise<{ filePath: string; line: number; character: number } | undefined> {
    const sourceFiles = executable.target?.sourceFiles ?? [];
    if (sourceFiles.length === 0) {
      return undefined;
    }

    return findGTestSourceLocation(testCase, sourceFiles);
  }

  private async run(request: vscode.TestRunRequest, token: vscode.CancellationToken): Promise<void> {
    await this.discover();
    const run = this.controller.createTestRun(request);
    const cases = this.collectRequestedCases(request);

    for (const entry of cases) {
      if (token.isCancellationRequested) {
        run.skipped(entry.item);
        continue;
      }

      run.enqueued(entry.item);
      run.started(entry.item);
      const startedAt = Date.now();
      const result = await execFileResult(entry.node.executable.path, [`--gtest_filter=${entry.node.testCase.filter}`], entry.node.executable.cwd, 0);
      const duration = Date.now() - startedAt;
      appendProcessOutput(run, result);

      if (token.isCancellationRequested) {
        run.skipped(entry.item);
      } else if (result.exitCode === 0) {
        run.passed(entry.item, duration);
      } else {
        const message = result.stderr.trim() || result.stdout.trim() || result.error?.message || `Exited with code ${result.exitCode ?? 'unknown'}`;
        run.failed(entry.item, new vscode.TestMessage(message), duration);
      }
    }

    run.end();
  }

  private async debug(request: vscode.TestRunRequest, token: vscode.CancellationToken): Promise<void> {
    await this.discover();
    const run = this.controller.createTestRun(request);
    const groupedCases = groupCasesByExecutable(this.collectRequestedCases(request));
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    for (const group of groupedCases) {
      if (token.isCancellationRequested) {
        for (const entry of group.cases) {
          run.skipped(entry.item);
        }
        continue;
      }

      for (const entry of group.cases) {
        run.enqueued(entry.item);
        run.started(entry.item);
      }

      const filter = group.cases.map((entry) => entry.node.testCase.filter).join(':');
      const launchConfiguration = this.configurationManager.createDebugConfiguration({
        name: `Debug ${path.basename(group.executable.path)} ${filter}`,
        program: group.executable.path,
        cwd: group.executable.cwd,
        args: [`--gtest_filter=${filter}`],
        env: {
          ASAN_OPTIONS: 'detect_leaks=0',
          LSAN_OPTIONS: 'detect_leaks=0',
        },
      });

      this.logger.info(`launchConfiguration=${JSON.stringify(launchConfiguration)}`)
      const started = await vscode.debug.startDebugging(workspaceFolder, launchConfiguration);
      for (const entry of group.cases) {
        if (started) {
          run.passed(entry.item);
        } else {
          run.failed(entry.item, new vscode.TestMessage('Debugger launch was rejected.'));
        }
      }
    }

    run.end();
  }

  private collectRequestedCases(request: vscode.TestRunRequest): Array<{ item: vscode.TestItem; node: CaseNode }> {
    const include = request.include && request.include.length > 0 ? request.include : collectionToArray(this.controller.items);
    const exclude = new Set((request.exclude ?? []).map((item) => item.id));
    const cases: Array<{ item: vscode.TestItem; node: CaseNode }> = [];

    for (const item of include) {
      this.collectCases(item, exclude, cases);
    }

    return cases;
  }

  private collectCases(item: vscode.TestItem, exclude: ReadonlySet<string>, cases: Array<{ item: vscode.TestItem; node: CaseNode }>): void {
    if (exclude.has(item.id)) {
      return;
    }

    const node = this.nodes.get(item.id);
    if (node?.kind === 'case') {
      cases.push({ item, node });
      return;
    }

    item.children.forEach((child) => this.collectCases(child, exclude, cases));
  }

  private findTargetForExecutable(executablePath: string): TargetInfo | undefined {
    const normalizedExecutable = normalizePath(executablePath);
    return this.targets.find((target) => normalizePath(target.guessedExecutablePath) === normalizedExecutable);
  }
}

function createExecutableId(executablePath: string): string {
  return `exe:${normalizePath(executablePath)}`;
}

function createSuiteId(executableId: string, suite: string): string {
  return `${executableId}:suite:${suite}`;
}

function createCaseId(executableId: string, filter: string): string {
  return `${executableId}:case:${filter}`;
}

async function findExecutableFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  await walkExecutableFiles(root, results, 0);
  return results.sort((left, right) => left.localeCompare(right));
}

async function walkExecutableFiles(directory: string, results: string[], depth: number): Promise<void> {
  if (depth > 8) {
    return;
  }

  let entries: Array<[string, import('fs').Dirent]>;
  try {
    entries = (await fs.readdir(directory, { withFileTypes: true })).map((entry) => [entry.name, entry]);
  } catch {
    return;
  }

  for (const [name, entry] of entries) {
    const filePath = path.join(directory, name);
    if (entry.isDirectory()) {
      if (!shouldSkipDirectory(name)) {
        await walkExecutableFiles(filePath, results, depth + 1);
      }
      continue;
    }

    if (entry.isFile() && isExecutableCandidate(filePath)) {
      results.push(filePath);
    }
  }
}

function shouldSkipDirectory(name: string): boolean {
  return name === '.cmake' || name === 'CMakeFiles' || name === '_deps';
}

function isExecutableCandidate(filePath: string): boolean {
  if (process.platform === 'win32') {
    return path.extname(filePath).toLowerCase() === '.exe';
  }

  return path.extname(filePath).toLowerCase() !== '.so';
}

function execFileResult(file: string, args: string[], cwd: string, timeout: number): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(file, args, { cwd, timeout, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      const nodeError = error as NodeJS.ErrnoException | null;
      const exitCode = typeof nodeError?.code === 'number' ? nodeError.code : error ? 1 : 0;
      resolve({
        exitCode,
        stdout,
        stderr,
        error: error ?? undefined,
      });
    });
  });
}

function appendProcessOutput(run: vscode.TestRun, result: ExecResult): void {
  const output = `${result.stdout}${result.stderr}`;
  if (output) {
    run.appendOutput(output.replace(/\n/g, '\r\n'));
  }
}

function collectionToArray(collection: vscode.TestItemCollection): vscode.TestItem[] {
  const items: vscode.TestItem[] = [];
  collection.forEach((item) => items.push(item));
  return items;
}

function groupCasesByExecutable(cases: Array<{ item: vscode.TestItem; node: CaseNode }>): Array<{ executable: TestExecutable; cases: Array<{ item: vscode.TestItem; node: CaseNode }> }> {
  const groups = new Map<string, { executable: TestExecutable; cases: Array<{ item: vscode.TestItem; node: CaseNode }> }>();
  for (const entry of cases) {
    const key = normalizePath(entry.node.executable.path);
    const group = groups.get(key) ?? { executable: entry.node.executable, cases: [] };
    group.cases.push(entry);
    groups.set(key, group);
  }

  return [...groups.values()];
}
