import * as assert from 'assert';
import * as vscode from 'vscode';
import { SessionLoader } from '../src/app/sessionLoader';
import { SessionStore } from '../src/app/sessionStore';
import { MappingIndex, PresetInfo, TargetInfo } from '../src/models';
import { MappingEngine } from '../src/services/mappingEngine';
import { OutputLogger } from '../src/services/outputLogger';
import { PresetProvider } from '../src/services/presetProvider';
import { createMockOutputChannel } from './helpers';

describe('session loader', () => {
  const presetA: PresetInfo = { name: 'a', displayName: 'A', binaryDir: '/b/a', sourceDir: '/src' };
  const presetB: PresetInfo = { name: 'b', displayName: 'B', binaryDir: '/b/b', sourceDir: '/src' };

  function createMemento(): vscode.Memento {
    const state = new Map<string, string>();
    return {
      get: (key: string) => state.get(key),
      update: async (key: string, value: string) => {
        state.set(key, value);
      },
      keys: () => [...state.keys()],
      setKeysForSync: () => {},
    } as unknown as vscode.Memento;
  }

  function createMapping(target?: TargetInfo): MappingIndex {
    return {
      targets: target ? new Map([[target.id, target]]) : new Map(),
      sourceToTargets: new Map(),
    };
  }

  function createTarget(id: string, name: string): TargetInfo {
    return {
      id,
      name,
      displayName: name,
      type: 'EXECUTABLE',
      sourceFiles: [],
      guessedExecutablePath: `/b/${name}`,
    };
  }

  function createLoader(
    store: SessionStore,
    presetProvider: PresetProvider,
    mappingEngine: MappingEngine,
  ): SessionLoader {
    return new SessionLoader(store, presetProvider, mappingEngine, new OutputLogger(createMockOutputChannel()));
  }

  it('loads presets only once for concurrent ensureInitialized calls', async () => {
    let loadCount = 0;
    const presetProvider = {
      loadPresets: async () => {
        loadCount += 1;
        return [presetA];
      },
    } as unknown as PresetProvider;
    const mappingEngine = { build: async () => createMapping() } as unknown as MappingEngine;
    const loader = createLoader(new SessionStore(createMemento(), new OutputLogger(createMockOutputChannel())), presetProvider, mappingEngine);

    await Promise.all([loader.ensureInitialized(), loader.ensureInitialized()]);

    assert.strictEqual(loadCount, 1);
  });

  it('clears targets when no preset is selected', async () => {
    const presetProvider = { loadPresets: async () => [] } as unknown as PresetProvider;
    const mappingEngine = { build: async () => createMapping(createTarget('unused', 'unused')) } as unknown as MappingEngine;
    const store = new SessionStore(createMemento(), new OutputLogger(createMockOutputChannel()));
    const loader = createLoader(store, presetProvider, mappingEngine);

    await loader.ensureInitialized();

    assert.strictEqual(store.getCurrentPreset(), undefined);
    assert.deepStrictEqual(store.getTargets(), []);
  });

  it('discards stale build results after a newer update starts', async () => {
    let resolveFirstBuild: ((mapping: MappingIndex) => void) | undefined;
    const mappingEngine = {
      build: (preset: PresetInfo) => preset.name === 'a'
        ? new Promise<MappingIndex>((resolve) => {
          resolveFirstBuild = resolve;
        })
        : Promise.resolve(createMapping(createTarget('b-app', 'app'))),
    } as unknown as MappingEngine;
    const presetProvider = { loadPresets: async () => [presetA, presetB] } as unknown as PresetProvider;
    const store = new SessionStore(createMemento(), new OutputLogger(createMockOutputChannel()));
    const loader = createLoader(store, presetProvider, mappingEngine);

    await store.setPresets([presetA, presetB], 'a');
    const firstUpdate = loader.updateTargets();
    await store.selectPreset(presetB);
    await loader.updateTargets();
    resolveFirstBuild?.(createMapping(createTarget('a-app', 'app')));
    await firstUpdate;

    assert.deepStrictEqual(store.getTargets().map((target) => target.id), ['b-app']);
  });
});
