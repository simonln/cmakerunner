import * as path from 'path';
import * as vscode from 'vscode';
import { TargetInfo } from '../models';
import { normalizePath, relativeDisplayPath } from '../utils';
import { FilterMatcher, createFilterMatcher } from './filterMatcher';

export class TargetTreeItem extends vscode.TreeItem {
  public constructor(public readonly target: TargetInfo) {
    super(target.displayName, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = path.basename(target.guessedExecutablePath);
    this.tooltip = `${target.displayName}\n${target.guessedExecutablePath}`;
    this.contextValue = 'target';
    this.iconPath = new vscode.ThemeIcon('package');
  }
}

export class SourceTreeItem extends vscode.TreeItem {
  public constructor(
    public readonly sourcePath: string,
    public readonly targetId: string,
    private readonly sourceDir: string,
    isActive: boolean,
  ) {
    super(relativeDisplayPath(sourcePath, sourceDir), vscode.TreeItemCollapsibleState.None);
    this.description = isActive ? 'Current' : undefined;
    this.tooltip = sourcePath;
    this.contextValue = 'source';
    this.iconPath = new vscode.ThemeIcon(isActive ? 'circle-filled' : 'file-code');
    this.command = {
      command: 'vscode.open',
      title: 'Open Source File',
      arguments: [vscode.Uri.file(sourcePath)],
    };
  }
}

type Node = TargetTreeItem | SourceTreeItem;

export class TargetTreeDataProvider implements vscode.TreeDataProvider<Node> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<Node | undefined | void>();
  private targets: TargetInfo[] = [];
  private filteredTargets: TargetInfo[] = [];
  private sourceDir = '';
  private activeSourcePath?: string;
  private filterText = '';
  private filterIsRegex = false;
  private targetItems = new Map<string, TargetTreeItem>();
  private sourceItems = new Map<string, SourceTreeItem>();

  public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  public setTargets(targets: TargetInfo[], sourceDir: string, activeSourcePath?: string): void {
    this.targets = targets;
    this.sourceDir = sourceDir;
    this.activeSourcePath = activeSourcePath;
    this.rebuildCache();
    this.onDidChangeTreeDataEmitter.fire();
  }

  public setActiveSourcePath(activeSourcePath: string | undefined): void {
    this.activeSourcePath = activeSourcePath;
    this.rebuildCache();
    this.onDidChangeTreeDataEmitter.fire();
  }

  public setFilterText(filterText: string, options?: { isRegex?: boolean }): void {
    this.filterText = filterText.trim();
    this.filterIsRegex = !!this.filterText && options?.isRegex === true;
    this.rebuildCache();
    this.onDidChangeTreeDataEmitter.fire();
  }

  public getFilterText(): string {
    return this.filterText;
  }

  public isFilterRegex(): boolean {
    return this.filterIsRegex;
  }

  public getVisibleTargetCount(): number {
    return this.filteredTargets.length;
  }

  public getTreeItem(element: Node): vscode.TreeItem {
    return element;
  }

  public getChildren(element?: Node): Thenable<Node[]> {
    if (!element) {
      return Promise.resolve(this.filteredTargets.map((target) => this.targetItems.get(target.id) as TargetTreeItem));
    }

    if (element instanceof TargetTreeItem) {
      const visibleSourceFiles = this.getVisibleSourceFiles(element.target);
      return Promise.resolve(
        visibleSourceFiles.map((sourcePath) => this.sourceItems.get(this.createSourceKey(element.target.id, sourcePath)) as SourceTreeItem),
      );
    }

    return Promise.resolve([]);
  }

  public getParent(element: Node): vscode.ProviderResult<Node> {
    if (element instanceof SourceTreeItem) {
      return this.targetItems.get(element.targetId);
    }

    return undefined;
  }

  public findTargetItem(targetId: string): TargetTreeItem | undefined {
    return this.targetItems.get(targetId);
  }

  public findFirstSourceItemByFile(filePath: string): SourceTreeItem | undefined {
    const normalizedFilePath = normalizePath(filePath);
    for (const target of this.targets) {
      for (const sourcePath of target.sourceFiles) {
        if (normalizePath(sourcePath) === normalizedFilePath) {
          return this.sourceItems.get(this.createSourceKey(target.id, sourcePath));
        }
      }
    }

    return undefined;
  }

  private rebuildCache(): void {
    const matcher = this.createFilterMatcher();
    this.filteredTargets = this.targets.filter((target) => this.matchesTarget(target, matcher));
    this.targetItems = new Map(this.filteredTargets.map((target) => [target.id, new TargetTreeItem(target)]));
    this.sourceItems = new Map();

    const activeSource = this.activeSourcePath ? normalizePath(this.activeSourcePath) : undefined;
    for (const target of this.filteredTargets) {
      for (const sourcePath of this.getVisibleSourceFiles(target)) {
        const key = this.createSourceKey(target.id, sourcePath);
        const isActive = !!activeSource && normalizePath(sourcePath) === activeSource;
        this.sourceItems.set(key, new SourceTreeItem(sourcePath, target.id, this.sourceDir, isActive));
      }
    }
  }

  private matchesTarget(target: TargetInfo, matcher: FilterMatcher | undefined): boolean {
    if (!matcher) {
      return true;
    }

    return this.matchesTargetName(target, matcher) || target.sourceFiles.some((sourcePath) => this.matchesSourcePath(sourcePath, matcher));
  }

  private getVisibleSourceFiles(target: TargetInfo): string[] {
    const matcher = this.createFilterMatcher();
    if (!matcher || this.matchesTargetName(target, matcher)) {
      return target.sourceFiles;
    }

    return target.sourceFiles.filter((sourcePath) => this.matchesSourcePath(sourcePath, matcher));
  }

  private matchesTargetName(target: TargetInfo, matcher: FilterMatcher): boolean {
    return matcher.matches(target.displayName)
      || matcher.matches(target.name)
      || matcher.matches(path.basename(target.guessedExecutablePath));
  }

  private matchesSourcePath(sourcePath: string, matcher: FilterMatcher): boolean {
    return matcher.matches(path.basename(sourcePath))
      || matcher.matches(relativeDisplayPath(sourcePath, this.sourceDir));
  }

  private createFilterMatcher(): FilterMatcher | undefined {
    return createFilterMatcher(this.filterText, this.filterIsRegex, (value) => this.normalizeFilterQuery(value));
  }

  private normalizeFilterQuery(value: string): string {
    return normalizePath(value).replace(/\\/g, '/');
  }

  private createSourceKey(targetId: string, sourcePath: string): string {
    return `${targetId}::${normalizePath(sourcePath)}`;
  }
}
