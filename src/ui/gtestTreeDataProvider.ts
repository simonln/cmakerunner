import * as path from 'path';
import * as vscode from 'vscode';
import { GTestCaseInfo, TargetInfo } from '../models';
import { normalizePath } from '../utils';

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
  ) {
    super(testCase.name, vscode.TreeItemCollapsibleState.None);
    this.description = testCase.suite;
    this.tooltip = testCase.filter;
    this.contextValue = 'gtestCase';
    this.iconPath = new vscode.ThemeIcon('testing-passed-icon');
  }
}

type Node = GTestTargetTreeItem | GTestCaseTreeItem;

export class GTestTreeDataProvider implements vscode.TreeDataProvider<Node> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<Node | undefined | void>();
  private targets: TargetInfo[] = [];
  private targetItems = new Map<string, GTestTargetTreeItem>();
  private testCasesByTargetId = new Map<string, GTestCaseInfo[]>();
  private filterText = '';
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

  public setFilterText(filterText: string): void {
    this.filterText = filterText.trim();
    this.onDidChangeTreeDataEmitter.fire();
  }

  public getFilterText(): string {
    return this.filterText;
  }

  public async getVisibleTargetCount(): Promise<number> {
    return (await this.getVisibleTargets()).length;
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
      const testCases = await this.getTestCases(element.target);
      return this.getVisibleTestCases(element.target, testCases)
        .map((testCase) => new GTestCaseTreeItem(element.target, testCase));
    }

    return [];
  }

  public getParent(element: Node): vscode.ProviderResult<Node> {
    if (element instanceof GTestCaseTreeItem) {
      return this.targetItems.get(element.target.id);
    }

    return undefined;
  }

  private async getTestCases(target: TargetInfo): Promise<GTestCaseInfo[]> {
    if (this.testCasesByTargetId.has(target.id)) {
      return this.testCasesByTargetId.get(target.id) as GTestCaseInfo[];
    }

    const testCases = await this.discoverTestCases(target);
    const cachedTestCases = testCases ?? [];
    this.testCasesByTargetId.set(target.id, cachedTestCases);
    return cachedTestCases;
  }

  private async getVisibleTargets(): Promise<TargetInfo[]> {
    const selectedTarget = this.getSelectedTarget();
    if (!selectedTarget || !this.selectedTargetBuilt) {
      return [];
    }

    const query = this.normalizeFilterQuery(this.filterText);
    if (!query) {
      return [selectedTarget];
    }

    const visibleTargets: TargetInfo[] = [];
    for (const target of [selectedTarget]) {
      if (this.matchesTarget(target, query)) {
        visibleTargets.push(target);
        continue;
      }

      const testCases = await this.getTestCases(target);
      if (testCases.some((testCase) => this.matchesTestCase(testCase, query))) {
        visibleTargets.push(target);
      }
    }

    return visibleTargets;
  }

  private getSelectedTarget(): TargetInfo | undefined {
    if (!this.selectedTargetId) {
      return undefined;
    }

    return this.targets.find((target) => target.id === this.selectedTargetId);
  }

  private getVisibleTestCases(target: TargetInfo, testCases: GTestCaseInfo[]): GTestCaseInfo[] {
    const query = this.normalizeFilterQuery(this.filterText);
    if (!query || this.matchesTarget(target, query)) {
      return testCases;
    }

    return testCases.filter((testCase) => this.matchesTestCase(testCase, query));
  }

  private matchesTarget(target: TargetInfo, query: string): boolean {
    return this.normalizeFilterQuery(target.displayName).includes(query)
      || this.normalizeFilterQuery(target.name).includes(query)
      || this.normalizeFilterQuery(path.basename(target.guessedExecutablePath)).includes(query);
  }

  private matchesTestCase(testCase: GTestCaseInfo, query: string): boolean {
    return this.normalizeFilterQuery(testCase.suite).includes(query)
      || this.normalizeFilterQuery(testCase.name).includes(query)
      || this.normalizeFilterQuery(testCase.filter).includes(query);
  }

  private normalizeFilterQuery(value: string): string {
    const trimmed = value.trim();
    return trimmed ? normalizePath(trimmed).replace(/\\/g, '/').toLowerCase() : '';
  }
}
