import * as vscode from 'vscode';
import { MappingIndex, PresetInfo, TargetInfo, createEmptyMapping } from '../models';
import { OutputLogger } from '../services/outputLogger';
import { normalizePath } from '../utils';

const SELECTED_PRESET_KEY = 'cmakerunner.selectedPreset';

export class SessionStore implements vscode.Disposable {
  private readonly onDidChangePresetsEmitter = new vscode.EventEmitter<void>();
  private readonly onDidChangeTargetsEmitter = new vscode.EventEmitter<void>();
  private readonly onDidChangeActiveSourceEmitter = new vscode.EventEmitter<void>();

  public readonly onDidChangePresets = this.onDidChangePresetsEmitter.event;
  public readonly onDidChangeTargets = this.onDidChangeTargetsEmitter.event;
  public readonly onDidChangeActiveSource = this.onDidChangeActiveSourceEmitter.event;

  private presets: PresetInfo[] = [];
  private currentPreset: PresetInfo | undefined;
  private mapping: MappingIndex = createEmptyMapping();
  private activeSourcePath: string | undefined;

  public constructor(
    private readonly workspaceState: vscode.Memento,
    private readonly logger: OutputLogger,
  ) {}

  public getPresets(): readonly PresetInfo[] {
    return this.presets;
  }

  public getCurrentPreset(): PresetInfo | undefined {
    return this.currentPreset;
  }

  public getActiveSourcePath(): string | undefined {
    return this.activeSourcePath;
  }

  public getTargets(): TargetInfo[] {
    return Array.from(this.mapping.targets.values()).sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  public findTargetsBySource(sourcePath: string): TargetInfo[] {
    const targetIds = this.mapping.sourceToTargets.get(normalizePath(sourcePath)) ?? [];
    return targetIds
      .map((targetId) => this.mapping.targets.get(targetId))
      .filter((target): target is TargetInfo => !!target);
  }

  public async setPresets(presets: readonly PresetInfo[], preferredPresetName?: string): Promise<void> {
    this.presets = [...presets];
    const storedPresetName = preferredPresetName ?? this.workspaceState.get<string>(SELECTED_PRESET_KEY);
    this.currentPreset = this.presets.find((preset) => preset.name === storedPresetName) ?? this.presets[0];
    this.logger.info(`Loaded ${this.presets.length} preset(s). current=${this.currentPreset?.name ?? 'none'}`);

    if (this.currentPreset) {
      await this.workspaceState.update(SELECTED_PRESET_KEY, this.currentPreset.name);
    }

    this.mapping = createEmptyMapping();
    this.onDidChangePresetsEmitter.fire();
    this.onDidChangeTargetsEmitter.fire();
  }

  public async selectPreset(preset: PresetInfo): Promise<void> {
    this.logger.info(`Selecting preset: ${preset.name}`);
    this.currentPreset = preset;
    await this.workspaceState.update(SELECTED_PRESET_KEY, preset.name);
    this.mapping = createEmptyMapping();
    this.onDidChangePresetsEmitter.fire();
    this.onDidChangeTargetsEmitter.fire();
  }

  public setMapping(mapping: MappingIndex): void {
    this.mapping = mapping;
    this.onDidChangeTargetsEmitter.fire();
  }

  public setActiveSourcePath(activeSourcePath: string | undefined): void {
    if (this.activeSourcePath === activeSourcePath) {
      return;
    }

    this.activeSourcePath = activeSourcePath;
    this.onDidChangeActiveSourceEmitter.fire();
  }

  public dispose(): void {
    this.onDidChangePresetsEmitter.dispose();
    this.onDidChangeTargetsEmitter.dispose();
    this.onDidChangeActiveSourceEmitter.dispose();
  }
}
