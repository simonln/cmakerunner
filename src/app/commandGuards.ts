import * as vscode from 'vscode';
import { PresetInfo, TargetInfo } from '../models';
import { OutputLogger } from '../services/outputLogger';
import { SessionStore } from './sessionStore';

export function ensurePreset(store: SessionStore, logger: OutputLogger): PresetInfo | undefined {
  const preset = store.getCurrentPreset();
  if (!preset) {
    logger.warn('No preset is available when a preset-dependent command was invoked');
    void vscode.window.showWarningMessage('No available CMake Configure Preset was found. Please check CMakePresets.json.');
    return undefined;
  }

  return preset;
}

export function getTargetType(target: TargetInfo): string {
  return target.type ?? 'EXECUTABLE';
}

export function isRunnableTarget(target: TargetInfo): boolean {
  return getTargetType(target) === 'EXECUTABLE';
}

export function ensureRunnableTarget(target: TargetInfo, action: string): boolean {
  if (isRunnableTarget(target)) {
    return true;
  }

  void vscode.window.showWarningMessage(
    `Target ${target.displayName} is a ${getTargetType(target)} target and cannot be ${action}. Only EXECUTABLE targets are supported for this command.`,
  );
  return false;
}
