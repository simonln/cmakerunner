import * as vscode from 'vscode';
import { SessionStore } from '../app/sessionStore';
import { PresetTreeDataProvider, PresetTreeItem } from './presetTreeDataProvider';

export class PresetsView implements vscode.Disposable {
  private readonly provider = new PresetTreeDataProvider();
  private readonly view: vscode.TreeView<PresetTreeItem>;
  private readonly disposables: vscode.Disposable[] = [];

  public constructor(private readonly store: SessionStore) {
    this.view = vscode.window.createTreeView('cmakerunner.presets', {
      treeDataProvider: this.provider,
      showCollapseAll: false,
    });
    this.refresh();
    this.disposables.push(
      store.onDidChangePresets(() => this.refresh()),
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

  public async reveal(presetName: string): Promise<void> {
    const item = this.provider.findItem(presetName);
    if (!item) {
      return;
    }

    try {
      await this.view.reveal(item, { select: true, focus: false });
    } catch {
      // Ignore reveal failures when the view is not ready.
    }
  }

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private refresh(): void {
    this.provider.setPresets([...this.store.getPresets()], this.store.getCurrentPreset()?.name);
  }
}
