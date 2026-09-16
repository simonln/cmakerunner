import * as vscode from 'vscode';
import { CommandContext } from './types';

export function registerViewCommands(context: CommandContext): vscode.Disposable[] {
  const { store, sessionLoader, targetsView, targetPicker, testController } = context;

  return [
    vscode.commands.registerCommand('cmakerunner.refresh', async () => {
      await sessionLoader.ensureInitialized();
      await sessionLoader.refresh(store.getCurrentPreset()?.name);
    }),
    vscode.commands.registerCommand('cmakerunner.filterTargets', async () => {
      await sessionLoader.ensureInitialized();
      const pick = await targetPicker.pickTargetFilter();
      if (!pick) {
        return;
      }

      if (pick.type === 'regex') {
        await targetsView.applyFilter(pick.filterText, { isRegex: true });
        return;
      }

      if (pick.item.target) {
        await targetsView.applyFilter(pick.item.target.displayName);
        await targetsView.revealTarget(pick.item.target.id);
      }
    }),
    vscode.commands.registerCommand('cmakerunner.clearTargetFilter', async () => {
      await sessionLoader.ensureInitialized();
      await targetsView.applyFilter('');
    }),
    vscode.commands.registerCommand('cmakerunner.refreshGTests', async () => {
      await testController.discover();
    }),
  ];
}
