import * as vscode from 'vscode';
import { SessionStore } from '../app/sessionStore';
import { OutputLogger } from '../services/outputLogger';
import { SourceTreeItem, TargetTreeDataProvider, TargetTreeItem } from './targetTreeDataProvider';

export class TargetsView implements vscode.Disposable {
  private readonly provider = new TargetTreeDataProvider();
  private readonly view: vscode.TreeView<TargetTreeItem | SourceTreeItem>;
  private readonly disposables: vscode.Disposable[] = [];

  public constructor(
    private readonly store: SessionStore,
    private readonly workspaceRoot: string,
    private readonly logger: OutputLogger,
  ) {
    this.view = vscode.window.createTreeView('cmakerunner.targets', {
      treeDataProvider: this.provider,
      showCollapseAll: true,
    });
    this.refreshTargets();
    this.disposables.push(
      store.onDidChangeTargets(() => this.refreshTargets()),
      store.onDidChangeActiveSource(() => {
        this.provider.setActiveSourcePath(store.getActiveSourcePath());
        void this.revealActiveSource(store.getActiveSourcePath());
      }),
      this.view,
    );
  }

  public get visible(): boolean {
    return this.view.visible;
  }

  public onDidChangeVisibility(listener: () => void): vscode.Disposable | undefined {
    if (!('onDidChangeVisibility' in this.view)) {
      return undefined;
    }

    return this.view.onDidChangeVisibility(() => listener());
  }

  public getFilterText(): string {
    return this.provider.getFilterText();
  }

  public getVisibleTargetCount(): number {
    return this.provider.getVisibleTargetCount();
  }

  public async applyFilter(filterText: string, options?: { isRegex?: boolean }): Promise<void> {
    this.provider.setFilterText(filterText, options);
    await this.updateViewState();
  }

  public async revealTarget(targetId: string): Promise<void> {
    const item = this.provider.findTargetItem(targetId);
    if (!item) {
      return;
    }

    try {
      await this.view.reveal(item, { select: true, focus: false, expand: false });
    } catch {
      // Ignore reveal failures when the view is not ready.
    }
  }

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private refreshTargets(): void {
    this.provider.setTargets(
      this.store.getTargets(),
      this.store.getCurrentPreset()?.sourceDir ?? this.workspaceRoot,
      this.store.getActiveSourcePath(),
    );
    void this.updateViewState();
  }

  private async revealActiveSource(filePath: string | undefined): Promise<void> {
    if (!filePath || !this.view.visible) {
      return;
    }

    const sourceItem = this.provider.findFirstSourceItemByFile(filePath);
    if (!sourceItem) {
      this.logger.info(`Active file is not present in target tree: ${filePath}`);
      return;
    }

    try {
      await this.view.reveal(sourceItem, {
        select: false,
        focus: false,
        expand: false,
      });
    } catch (error) {
      this.logger.warn(`Unable to reveal active source ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async updateViewState(): Promise<void> {
    const filterText = this.provider.getFilterText();
    this.view.description = filterText
      ? `${this.provider.isFilterRegex() ? 'Regex' : 'Filter'}: ${filterText}`
      : undefined;
    this.view.message = filterText && this.provider.getVisibleTargetCount() === 0
      ? 'No executable target matches the current filter.'
      : undefined;
    await vscode.commands.executeCommand('setContext', 'cmakerunner.targetsFilterActive', !!filterText);
  }
}
