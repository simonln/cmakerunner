import * as path from 'path';
import * as vscode from 'vscode';
import { PresetInfo } from '../models';
import { OutputLogger } from './outputLogger';

export async function clearPresetBuildDirectory(preset: PresetInfo, logger: OutputLogger): Promise<boolean> {
  const buildDirectoryUri = vscode.Uri.file(preset.binaryDir);

  try {
    await vscode.workspace.fs.stat(buildDirectoryUri);
  } catch (error) {
    const code = (error as vscode.FileSystemError | undefined)?.code;
    if (code === 'FileNotFound') {
      logger.info(`Skipping build directory cleanup because it does not exist: ${preset.binaryDir}`);
      return true;
    }

    logger.warn(`Unable to inspect build directory ${preset.binaryDir}: ${error instanceof Error ? error.message : String(error)}`);
    void vscode.window.showErrorMessage(`Unable to access build directory for preset ${preset.displayName}.`);
    return false;
  }

  try {
    const cmakeCleanupTargets = [
      '.cmake',
      'CMakeCache.txt',
      'CMakeFiles',
    ];

    const cleanedPaths: string[] = [];

    for (const targetName of cmakeCleanupTargets) {
      const targetUri = vscode.Uri.file(path.join(preset.binaryDir, targetName));

      try {
        await vscode.workspace.fs.stat(targetUri);
      } catch (error) {
        const code = (error as vscode.FileSystemError | undefined)?.code;
        if (code === 'FileNotFound') {
          continue;
        }

        throw error;
      }

      await vscode.workspace.fs.delete(targetUri, { recursive: true, useTrash: false });
      cleanedPaths.push(targetUri.fsPath);
    }

    logger.info(
      `Cleaning CMake configure artifacts for preset ${preset.name}: ${cleanedPaths.length > 0 ? cleanedPaths.join(', ') : 'no known configure artifacts found'}`,
    );

    return true;
  } catch (error) {
    logger.warn(`Unable to clean CMake configure artifacts in ${preset.binaryDir}: ${error instanceof Error ? error.message : String(error)}`);
    void vscode.window.showErrorMessage(`Unable to clean CMake configure artifacts for preset ${preset.displayName}.`);
    return false;
  }
}
