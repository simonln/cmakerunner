import * as path from 'path';
import * as vscode from 'vscode';
import { SessionStore } from '../app/sessionStore';
import { TargetInfo } from '../models';
import { OutputLogger } from '../services/outputLogger';
import { relativeDisplayPath } from '../utils';
import { getRegexFilterError } from './filterMatcher';

export interface TargetQuickPickItem extends vscode.QuickPickItem {
  readonly target?: TargetInfo;
}

interface RegexFilterQuickPickItem extends vscode.QuickPickItem {
  readonly regexText: string;
}

export type RegexFilterPick<T extends vscode.QuickPickItem> =
  | { readonly type: 'item'; readonly item: T }
  | { readonly type: 'regex'; readonly filterText: string };

export class TargetPicker {
  public constructor(
    private readonly store: SessionStore,
    private readonly logger: OutputLogger,
    private readonly workspaceRoot: string,
  ) {}

  public async pickTarget(options?: { userActiveFile?: boolean }): Promise<TargetQuickPickItem | undefined> {
    const targets = this.getAutoFilteredTargets(options?.userActiveFile == true);
    if (!this.ensureDiscoveredTargets(targets)) {
      return undefined;
    }

    const items = this.createTargetQuickPickItems(targets);

    if (options?.userActiveFile && items.length === 1) {
      return items[0];
    }

    const prompt = 'Filter targets by executable name or C/C++ source file name';
    const placeHolder = 'Example: app, main.cpp, demo.exe, src/test.cpp';
    return vscode.window.showQuickPick(items, {
      prompt,
      placeHolder,
      matchOnDescription: true,
      matchOnDetail: true,
    });
  }

  public async pickTargetFilter(): Promise<RegexFilterPick<TargetQuickPickItem> | undefined> {
    const targets = this.getAutoFilteredTargets(false);
    if (!this.ensureDiscoveredTargets(targets)) {
      return undefined;
    }

    const items = this.createTargetQuickPickItems(targets);

    return this.pickRegexFilter(items, {
      title: 'Filter Targets',
      placeHolder: 'Example: app, main\\.cpp, ^Test.*',
      regexDetail: 'Match target names, executable names, and source paths',
      matchOnDescription: true,
      matchOnDetail: true,
    });
  }

  private getAutoFilteredTargets(userActiveFile: boolean): TargetInfo[] {
    const targets = this.store.getTargets();
    if (!userActiveFile) {
      return targets;
    }

    const activeFilePath = this.getActiveEditorFilePath();
    if (!activeFilePath) {
      return targets;
    }

    const mappedTargets = this.store.findTargetsBySource(activeFilePath);
    return mappedTargets.length > 0 ? mappedTargets : targets;
  }

  private getActiveEditorFilePath(): string | undefined {
    const documentUri = vscode.window.activeTextEditor?.document.uri;
    return documentUri?.scheme === 'file' ? documentUri.fsPath : undefined;
  }

  private ensureDiscoveredTargets(targets: TargetInfo[]): boolean {
    if (targets.length > 0) {
      return true;
    }

    const preset = this.store.getCurrentPreset();
    const message = preset
      ? `No executable targets are available for preset ${preset.displayName}. Run Build on the preset first.`
      : 'No executable targets are available. Select and build a preset first.';
    void vscode.window.showWarningMessage(message);
    return false;
  }

  private createTargetQuickPickItems(targets: readonly TargetInfo[]): TargetQuickPickItem[] {
    const quickPickSourceDir = this.store.getCurrentPreset()?.sourceDir ?? this.workspaceRoot;
    return targets.map((target) => ({
      label: target.displayName,
      description: path.basename(target.guessedExecutablePath),
      detail: `${target.sourceFiles.length} source file${target.sourceFiles.length === 1 ? '' : 's'}: ${target.sourceFiles
        .map((sourcePath) => relativeDisplayPath(sourcePath, quickPickSourceDir))
        .join(', ')}`,
      target,
    }));
  }

  private async pickRegexFilter<T extends vscode.QuickPickItem>(
    items: readonly T[],
    options: {
      readonly title: string;
      readonly placeHolder: string;
      readonly regexDetail: string;
      readonly matchOnDescription?: boolean;
      readonly matchOnDetail?: boolean;
    },
  ): Promise<RegexFilterPick<T> | undefined> {
    return new Promise((resolve) => {
      const quickPick = vscode.window.createQuickPick<T | RegexFilterQuickPickItem>();
      let settled = false;

      const finish = (result: RegexFilterPick<T> | undefined): void => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(result);
        quickPick.hide();
        quickPick.dispose();
      };

      const createRegexItem = (regexText: string): RegexFilterQuickPickItem => ({
        label: `$(regex) Apply regex: ${regexText}`,
        description: 'Press Enter to show all matches',
        detail: options.regexDetail,
        alwaysShow: true,
        regexText,
      });

      const updateItems = (value: string): void => {
        const regexText = value.trim();
        if (!regexText) {
          quickPick.items = [...items];
          return;
        }

        const regexItem = createRegexItem(regexText);
        quickPick.items = [regexItem, ...items];
        quickPick.activeItems = [regexItem];
      };

      quickPick.title = options.title;
      quickPick.value = '';
      quickPick.placeholder = options.placeHolder;
      quickPick.ignoreFocusOut = true;
      quickPick.matchOnDescription = options.matchOnDescription ?? false;
      quickPick.matchOnDetail = options.matchOnDetail ?? false;
      quickPick.items = [...items];
      quickPick.onDidChangeValue(updateItems);
      quickPick.onDidAccept(() => {
        const pickedItem = quickPick.selectedItems[0] ?? quickPick.activeItems[0];
        if (!pickedItem) {
          finish(undefined);
          return;
        }

        if ('regexText' in pickedItem) {
          const error = getRegexFilterError(pickedItem.regexText);
          if (error) {
            void vscode.window.showWarningMessage(`Invalid regular expression: ${error}`);
            finish(undefined);
            return;
          }

          finish({
            type: 'regex',
            filterText: pickedItem.regexText,
          });
          return;
        }

        finish({
          type: 'item',
          item: pickedItem as T,
        });
      });
      quickPick.onDidHide(() => finish(undefined));
      quickPick.show();
    });
  }
}
