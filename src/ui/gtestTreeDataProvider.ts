import * as path from 'path';
import * as vscode from 'vscode';
import { GTestCaseInfo, GTestRunResult, GTestRunStatus, TargetInfo } from '../models';
import { normalizePath } from '../utils';
import { FilterMatcher, createFilterMatcher } from './filterMatcher';

export class GTestTargetTreeItem extends vscode.TreeItem {
  public constructor(public readonly target: TargetInfo) {
    super(target.displayName, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = path.basename(target.guessedExecutablePath);
    this.tooltip = `${target.displayName}\n${target.guessedExecutablePath}`;
    this.contextValue = 'gtestTarget';
    this.iconPath = new vscode.ThemeIcon('beaker');
  }
}

export class GTestCaseTreeItem extends vscode.TreeItem {
  public constructor(
    public readonly target: TargetInfo,
    public readonly testCase: GTestCaseInfo,
    public readonly runStatus?: GTestRunStatus,
  ) {
    super(testCase.name, vscode.TreeItemCollapsibleState.None);
    this.description = testCase.suite;
    this.tooltip = runStatus ? `${testCase.filter}\nLast run: ${runStatus}` : testCase.filter;
    this.contextValue = 'gtestCase';
    this.iconPath = getGTestCaseIcon(runStatus);
    this.command = {
      command: 'cmakerunner.openGTestCaseSource',
      title: 'Open GTest Source',
      arguments: [this],
    };
  }
}

function getGTestCaseIcon(runStatus: GTestRunStatus | undefined): vscode.ThemeIcon {
  if (runStatus === 'passed') {
    return new vscode.ThemeIcon('testing-passed-icon');
  }

  if (runStatus === 'failed') {
    return new vscode.ThemeIcon('testing-failed-icon');
  }

  return new vscode.ThemeIcon('testing-unset-icon');
}

type Node = GTestTargetTreeItem | GTestCaseTreeItem;

export class GTestTreeDataProvider implements vscode.TreeDataProvider<Node> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<Node | undefined | void>();
  private targets: TargetInfo[] = [];
  private targetItems = new Map<string, GTestTargetTreeItem>();
  private testCasesByTargetId = new Map<string, GTestCaseInfo[]>();
  private runStatusByTargetId = new Map<string, Map<string, GTestRunStatus>>();
  private filterText = '';
  private filterIsRegex = false;
  private selectedTargetId?: string;
  private selectedTargetBuilt = false;

  public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  public constructor(
    private readonly discoverTestCases: (target: TargetInfo) => Promise<GTestCaseInfo[] | undefined>,
  ) {}

  public setTargets(targets: TargetInfo[]): void {
    this.targets = targets;
    if (this.selectedTargetId && !targets.some((target) => target.id === this.selectedTargetId)) {
      this.selectedTargetId = undefined;
      this.selectedTargetBuilt = false;
    }
    this.testCasesByTargetId.clear();
    this.removeRunResultsForMissingTargets(targets);
    this.targetItems = new Map(targets.map((target) => [target.id, new GTestTargetTreeItem(target)]));
    this.onDidChangeTreeDataEmitter.fire();
  }

  public setSelectedTarget(target: TargetInfo | undefined, isBuilt: boolean): void {
    const nextTargetId = target?.id;
    const selectionChanged = this.selectedTargetId !== nextTargetId || this.selectedTargetBuilt !== isBuilt;
    this.selectedTargetId = nextTargetId;
    this.selectedTargetBuilt = !!target && isBuilt;
    if (!selectionChanged) {
      return;
    }

    this.onDidChangeTreeDataEmitter.fire();
  }

  public refresh(): void {
    this.testCasesByTargetId.clear();
    this.onDidChangeTreeDataEmitter.fire();
  }

  public clearRunResults(target: TargetInfo, testCases?: readonly GTestCaseInfo[]): void {
    const targetResults = this.runStatusByTargetId.get(target.id);
    if (!targetResults) {
      return;
    }

    if (!testCases) {
      this.runStatusByTargetId.delete(target.id);
      this.onDidChangeTreeDataEmitter.fire();
      return;
    }

    for (const testCase of testCases) {
      targetResults.delete(testCase.filter);
    }

    if (targetResults.size === 0) {
      this.runStatusByTargetId.delete(target.id);
    }

    this.onDidChangeTreeDataEmitter.fire();
  }

  public recordRunResults(target: TargetInfo, results: readonly GTestRunResult[]): void {
    if (results.length === 0) {
      return;
    }

    const targetResults = this.getOrCreateRunResults(target.id);
    for (const result of results) {
      targetResults.set(result.testCase.filter, result.status);
    }

    this.onDidChangeTreeDataEmitter.fire();
  }

  public setFilterText(filterText: string, options?: { isRegex?: boolean }): void {
    this.filterText = filterText.trim();
    this.filterIsRegex = !!this.filterText && options?.isRegex === true;
    this.onDidChangeTreeDataEmitter.fire();
  }

  public getFilterText(): string {
    return this.filterText;
  }

  public isFilterRegex(): boolean {
    return this.filterIsRegex;
  }

  public async getVisibleTargetCount(): Promise<number> {
    return (await this.getVisibleTargets()).length;
  }

  public async getVisibleTestCases(target: TargetInfo): Promise<GTestCaseInfo[]> {
    const testCases = await this.getCachedTestCases(target);
    return this.filterVisibleTestCases(target, testCases);
  }

  public async getAllTestCases(target: TargetInfo): Promise<GTestCaseInfo[]> {
    return [...await this.getCachedTestCases(target)];
  }

  public getMessage(): string | undefined {
    if (!this.selectedTargetId) {
      return 'Select a target and build it to view GoogleTest cases.';
    }

    if (!this.selectedTargetBuilt) {
      return 'Build the selected target successfully to view GoogleTest cases.';
    }

    return undefined;
  }

  public getTreeItem(element: Node): vscode.TreeItem {
    return element;
  }

  public async getChildren(element?: Node): Promise<Node[]> {
    if (!element) {
      const visibleTargets = await this.getVisibleTargets();
      return visibleTargets.map((target) => this.targetItems.get(target.id) as GTestTargetTreeItem);
    }

    if (element instanceof GTestTargetTreeItem) {
      const testCases = await this.getVisibleTestCases(element.target);
      return testCases
        .map((testCase) => new GTestCaseTreeItem(
          element.target,
          testCase,
          this.getRunStatus(element.target, testCase),
        ));
    }

    return [];
  }

  public getParent(element: Node): vscode.ProviderResult<Node> {
    if (element instanceof GTestCaseTreeItem) {
      return this.targetItems.get(element.target.id);
    }

    return undefined;
  }

  private async getCachedTestCases(target: TargetInfo): Promise<GTestCaseInfo[]> {
    if (this.testCasesByTargetId.has(target.id)) {
      return this.testCasesByTargetId.get(target.id) as GTestCaseInfo[];
    }

    const testCases = await this.discoverTestCases(target);
    const cachedTestCases = testCases ?? [];
    this.testCasesByTargetId.set(target.id, cachedTestCases);
    return cachedTestCases;
  }

  private getOrCreateRunResults(targetId: string): Map<string, GTestRunStatus> {
    const existingResults = this.runStatusByTargetId.get(targetId);
    if (existingResults) {
      return existingResults;
    }

    const nextResults = new Map<string, GTestRunStatus>();
    this.runStatusByTargetId.set(targetId, nextResults);
    return nextResults;
  }

  private getRunStatus(target: TargetInfo, testCase: GTestCaseInfo): GTestRunStatus | undefined {
    return this.runStatusByTargetId.get(target.id)?.get(testCase.filter);
  }

  private removeRunResultsForMissingTargets(targets: readonly TargetInfo[]): void {
    const targetIds = new Set(targets.map((target) => target.id));
    for (const targetId of this.runStatusByTargetId.keys()) {
      if (!targetIds.has(targetId)) {
        this.runStatusByTargetId.delete(targetId);
      }
    }
  }

  private async getVisibleTargets(): Promise<TargetInfo[]> {
    const selectedTarget = this.getSelectedTarget();
    if (!selectedTarget || !this.selectedTargetBuilt) {
      return [];
    }

    const matcher = this.createFilterMatcher();
    if (!matcher) {
      return [selectedTarget];
    }

    const visibleTargets: TargetInfo[] = [];
    for (const target of [selectedTarget]) {
      if (this.matchesTarget(target, matcher)) {
        visibleTargets.push(target);
        continue;
      }

      const testCases = await this.getCachedTestCases(target);
      if (testCases.some((testCase) => this.matchesTestCase(testCase, matcher))) {
        visibleTargets.push(target);
      }
    }

    return visibleTargets;
  }

  private getSelectedTarget(): TargetInfo | undefined {
    return this.targets.find((target) => target.id === this.selectedTargetId);
  }

  private filterVisibleTestCases(target: TargetInfo, testCases: readonly GTestCaseInfo[]): GTestCaseInfo[] {
    const matcher = this.createFilterMatcher();
    if (!matcher || this.matchesTarget(target, matcher)) {
      return [...testCases];
    }

    return testCases.filter((testCase) => this.matchesTestCase(testCase, matcher));
  }

  private matchesTarget(target: TargetInfo, matcher: FilterMatcher): boolean {
    return matcher.matches(target.displayName)
      || matcher.matches(target.name)
      || matcher.matches(path.basename(target.guessedExecutablePath));
  }

  private matchesTestCase(testCase: GTestCaseInfo, matcher: FilterMatcher): boolean {
    return matcher.matches(testCase.name)
      || matcher.matches(testCase.suite)
      || matcher.matches(testCase.filter);
  }

  private createFilterMatcher(): FilterMatcher | undefined {
    return createFilterMatcher(this.filterText, this.filterIsRegex, (value) => this.normalizeFilterQuery(value));
  }

  private normalizeFilterQuery(value: string): string {
    return normalizePath(value).replace(/\\/g, '/');
  }
}
