import * as fs from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
import * as vscode from 'vscode';
import { GTestCaseInfo, PresetInfo, TargetInfo } from '../models';
import { normalizePath } from '../utils';
import { GTestSourceLocation, findGTestSourceLocations } from './gtestSourceLocator';
import { OutputLogger } from './outputLogger';
import { parseGTestListOutput } from './workflowManager';
import { ConfigurationManager } from './configurationManager';
import { DebugSessionManager } from './debugSessionManager';

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
  private readonly executableCaseGroups = new Map<string, Map<string, readonly GTestCaseInfo[]>>();
  private readonly executableLocations = new Map<string, Promise<Map<string, GTestSourceLocation>>>();
  private preset?: PresetInfo;
  private targets: TargetInfo[] = [];
  private discoverInProgress?: Promise<void>;
  private discoveryGeneration = 0;

  public constructor(
    private readonly configurationManager: ConfigurationManager,
    private readonly logger: OutputLogger,
    private readonly debugSessionManager: DebugSessionManager,
    private readonly ensureInitialized?: () => Promise<void>,
  ) {
    this.controller = vscode.tests.createTestController('cmakerunner.gtests', 'CMake Runner GTests');
    this.controller.refreshHandler = async () => this.discover();
    this.controller.resolveHandler = async (item) => {
      if (!item) {
        await this.discover();
        return;
      }

      await this.resolveItem(item);
    };
    this.controller.createRunProfile('Run', vscode.TestRunProfileKind.Run, (request, token) => this.run(request, token), true);
    this.controller.createRunProfile('Debug', vscode.TestRunProfileKind.Debug, (request, token) => this.debug(request, token), true);
  }

  public dispose(): void {
    this.controller.dispose();
  }

  public setPreset(preset: PresetInfo | undefined): void {
    this.preset = preset;
    this.reset();
  }

  public setTargets(targets: readonly TargetInfo[]): void {
    this.targets = [...targets];
    this.reset();
  }

  public async discover(): Promise<void> {
    await this.ensureInitialized?.();

    if (this.discoverInProgress) {
      return this.discoverInProgress;
    }

    this.discoverInProgress = this.discoverExecutables().finally(() => {
      this.discoverInProgress = undefined;
    });
    return this.discoverInProgress;
  }

  private async discoverExecutables(): Promise<void> {
    this.reset();

    const preset = this.preset;
    if (!preset) {
      return;
    }

    const executables = await this.getExecutableCandidates();
    const executableItems: vscode.TestItem[] = [];
    let discoveredCount = 0;
    let discoveredNodeCount = 0;

    for (const executable of executables) {
      const testCases = await this.listExecutableCases(executable);
      if (testCases.length === 0) {
        continue;
      }

      const executableId = createExecutableId(executable.path);
      const groupedCases = groupCasesBySuite(testCases);
      this.executableCaseGroups.set(executableId, groupedCases);
      const executableItem = this.controller.createTestItem(
        executableId,
        executable.target?.displayName ?? path.basename(executable.path),
        vscode.Uri.file(executable.path),
      );
      executableItem.description = path.relative(preset.binaryDir, executable.path) || path.basename(executable.path);
      const suiteItems: vscode.TestItem[] = [];

      for (const [suite, suiteTestCases] of groupedCases) {
        const suiteId = createSuiteId(executableId, suite);
        const suiteItem = this.controller.createTestItem(suiteId, suite, vscode.Uri.file(executable.path));
        const caseItems: vscode.TestItem[] = [];

        for (const testCase of suiteTestCases) {
          const caseId = createCaseId(executableId, testCase.filter);
          const caseItem = this.controller.createTestItem(caseId, testCase.name);
          caseItem.description = testCase.suite;
          caseItems.push(caseItem);
          this.nodes.set(caseId, { kind: 'case', executable, testCase });
          discoveredNodeCount += 1;
          await maybeYieldControl(discoveredNodeCount);
        }

        suiteItem.children.replace(caseItems);
        suiteItems.push(suiteItem);
        this.nodes.set(suiteId, { kind: 'suite', executable, suite });
        discoveredNodeCount += 1;
        await maybeYieldControl(discoveredNodeCount);
      }

      executableItem.children.replace(suiteItems);
      executableItems.push(executableItem);
      this.nodes.set(executableId, { kind: 'executable', executable });
      discoveredCount += testCases.length;
      discoveredNodeCount += 1;
      await maybeYieldControl(discoveredNodeCount);
    }

    this.controller.items.replace(executableItems);
    const discoveryGeneration = ++this.discoveryGeneration;
    void this.enrichDiscoveredCaseLocations(discoveryGeneration);
    this.logger.info(`Registered ${discoveredCount} GoogleTest case(s) from ${executableItems.length} executable candidate(s) in ${preset.binaryDir}`);
  }

  private async resolveItem(_item: vscode.TestItem): Promise<void> {
    // This controller eagerly registers the full test tree.
  }

  private async listExecutableCases(executable: TestExecutable): Promise<GTestCaseInfo[]> {
    const result = await execFileResult(executable.path, ['--gtest_list_tests'], executable.cwd, 15000);
    if (result.exitCode !== 0) {
      const message = result.stderr.trim() || result.stdout.trim() || result.error?.message || `Exited with code ${result.exitCode ?? 'unknown'}`;
      this.logger.warn(`Unable to list GoogleTest cases for ${executable.path}: ${message}`);
      return [];
    }

    return parseGTestListOutput(result.stdout);
  }

  private async getExecutableLocations(executable: TestExecutable): Promise<Map<string, GTestSourceLocation>> {
    const executableId = createExecutableId(executable.path);
    let locationsPromise = this.executableLocations.get(executableId);
    if (!locationsPromise) {
      const sourceFiles = executable.target?.sourceFiles ?? [];
      const allCases = flattenCaseGroups(this.executableCaseGroups.get(executableId));
      locationsPromise = findGTestSourceLocations(allCases, sourceFiles);
      this.executableLocations.set(executableId, locationsPromise);
    }

    return locationsPromise;
  }

  private reset(): void {
    this.controller.items.replace([]);
    this.nodes.clear();
    this.executableCaseGroups.clear();
    this.executableLocations.clear();
    this.discoveryGeneration += 1;
  }

  private async enrichDiscoveredCaseLocations(discoveryGeneration: number): Promise<void> {
    for (const [itemId, node] of this.nodes) {
      if (discoveryGeneration !== this.discoveryGeneration) {
        return;
      }

      if (node.kind !== 'executable') {
        continue;
      }

      const locations = await this.getExecutableLocations(node.executable);
      if (discoveryGeneration !== this.discoveryGeneration) {
        return;
      }

      this.applyExecutableCaseLocations(itemId, node.executable, locations);
      await maybeYieldControl(locations.size);
    }
  }

  private applyExecutableCaseLocations(
    executableId: string,
    executable: TestExecutable,
    locations: ReadonlyMap<string, GTestSourceLocation>,
  ): void {
    const executableItem = this.controller.items.get(executableId);
    const groupedCases = this.executableCaseGroups.get(executableId);
    if (!executableItem || !groupedCases) {
      return;
    }

    for (const [suite, suiteCases] of groupedCases) {
      const suiteItem = executableItem.children.get(createSuiteId(executableId, suite));
      if (!suiteItem) {
        continue;
      }

      for (const testCase of suiteCases) {
        const caseId = createCaseId(executableId, testCase.filter);
        const location = locations.get(testCase.filter);
        const caseItem = suiteItem.children.get(caseId);
        if (!caseItem) {
          suiteItem.children.add(createCaseItem(this.controller, caseId, testCase, location));
          continue;
        }

        if (!location) {
          continue;
        }

        suiteItem.children.delete(caseId);
        suiteItem.children.add(createCaseItem(this.controller, caseId, testCase, location));
      }
    }

    if (locations.size > 0) {
      this.logger.info(`Resolved GoogleTest source locations for ${locations.size} case(s) in ${path.basename(executable.path)}`);
    }
  }

  private async getExecutableCandidates(): Promise<TestExecutable[]> {
    const preset = this.preset;
    if (!preset) {
      return [];
    }

    const seen = new Set<string>();
    const executables: TestExecutable[] = [];
    for (const target of this.targets) {
      if (target.type !== 'EXECUTABLE') {
        continue;
      }

      const executablePath = target.guessedExecutablePath;
      if (!isExecutableCandidate(executablePath)) {
        continue;
      }

      if (!isTestNamedExecutable(executablePath)) {
        continue;
      }

      const normalizedExecutablePath = normalizePath(executablePath);
      if (seen.has(normalizedExecutablePath)) {
        continue;
      }

      if (!(await fileExists(executablePath))) {
        continue;
      }

      seen.add(normalizedExecutablePath);
      executables.push({
        path: executablePath,
        cwd: preset.binaryDir,
        target,
      });
    }

    return executables.sort((left, right) => left.path.localeCompare(right.path));
  }

  private async run(request: vscode.TestRunRequest, token: vscode.CancellationToken): Promise<void> {
    await this.ensureInitialized?.();
    if (this.controller.items.size === 0) {
      await this.discover();
    }
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
    await this.ensureInitialized?.();
    if (this.controller.items.size === 0) {
      await this.discover();
    }
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
      const started = await this.debugSessionManager.startDebugging(workspaceFolder, launchConfiguration);
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

function isExecutableCandidate(filePath: string): boolean {
  if (process.platform === 'win32') {
    return path.extname(filePath).toLowerCase() === '.exe';
  }

  return path.extname(filePath).toLowerCase() !== '.so';
}

export function isTestNamedExecutable(filePath: string): boolean {
  return path.basename(filePath, path.extname(filePath)).toLowerCase().startsWith('test');
}

function execFileResult(file: string, args: string[], cwd: string, timeout: number): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(file, args, { cwd, timeout, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
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

function groupCasesBySuite(testCases: readonly GTestCaseInfo[]): Map<string, readonly GTestCaseInfo[]> {
  const groupedCases = new Map<string, GTestCaseInfo[]>();
  for (const testCase of testCases) {
    const suiteCases = groupedCases.get(testCase.suite) ?? [];
    suiteCases.push(testCase);
    groupedCases.set(testCase.suite, suiteCases);
  }

  return groupedCases;
}

function flattenCaseGroups(groupedCases: Map<string, readonly GTestCaseInfo[]> | undefined): readonly GTestCaseInfo[] {
  if (!groupedCases) {
    return [];
  }

  return [...groupedCases.values()].flat();
}

async function maybeYieldControl(nodeCount: number): Promise<void> {
  if (nodeCount % 250 !== 0) {
    return;
  }

  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function createCaseItem(
  controller: vscode.TestController,
  caseId: string,
  testCase: GTestCaseInfo,
  location: GTestSourceLocation | undefined,
): vscode.TestItem {
  const caseItem = controller.createTestItem(
    caseId,
    testCase.name,
    location ? vscode.Uri.file(location.filePath) : undefined,
  );
  caseItem.description = testCase.suite;
  if (location) {
    const position = new vscode.Position(location.line, location.character);
    caseItem.range = new vscode.Range(position, position);
  } else {
    caseItem.range = undefined;
  }

  return caseItem;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}
