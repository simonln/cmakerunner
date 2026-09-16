import { createEmptyMapping } from '../models';
import { MappingEngine } from '../services/mappingEngine';
import { OutputLogger } from '../services/outputLogger';
import { PresetProvider } from '../services/presetProvider';
import { SessionStore } from './sessionStore';

export class SessionLoader {
  private initializationPromise?: Promise<void>;
  private targetGeneration = 0;

  public constructor(
    private readonly store: SessionStore,
    private readonly presetProvider: PresetProvider,
    private readonly mappingEngine: MappingEngine,
    private readonly logger: OutputLogger,
  ) {}

  public async ensureInitialized(): Promise<void> {
    if (!this.initializationPromise) {
      this.initializationPromise = this.refresh().catch((error) => {
        this.initializationPromise = undefined;
        throw error;
      });
    }

    return this.initializationPromise;
  }

  public async refresh(preferredPresetName?: string): Promise<void> {
    const presets = await this.presetProvider.loadPresets();
    await this.store.setPresets(presets, preferredPresetName);
    await this.updateTargets();
  }

  public async updateTargets(): Promise<void> {
    const preset = this.store.getCurrentPreset();
    if (!preset) {
      this.logger.warn('Skipping target update because no preset is selected');
      this.store.setMapping(createEmptyMapping());
      return;
    }

    this.logger.info(
      `Updating targets. preset=${preset.name}, activeSource=${this.store.getActiveSourcePath() ?? 'none'}`,
    );
    const generation = ++this.targetGeneration;
    const mapping = await this.mappingEngine.build(preset);

    if (generation !== this.targetGeneration || this.store.getCurrentPreset()?.name !== preset.name) {
      this.logger.info(`Discarding stale target mapping result for preset ${preset.name}`);
      return;
    }

    this.store.setMapping(mapping);
  }
}
