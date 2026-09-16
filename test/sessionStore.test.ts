import * as assert from 'assert';
import * as vscode from 'vscode';
import { SessionStore } from '../src/app/sessionStore';
import { MappingIndex, PresetInfo, TargetInfo } from '../src/models';
import { OutputLogger } from '../src/services/outputLogger';
import { createMockOutputChannel } from './helpers';

describe('session store', () => {
  const presetA: PresetInfo = { name: 'a', displayName: 'A', binaryDir: '/b/a', sourceDir: '/src' };
  const presetB: PresetInfo = { name: 'b', displayName: 'B', binaryDir: '/b/b', sourceDir: '/src' };
  const target: TargetInfo = {
    id: 'app',
    name: 'app',
    displayName: 'app',
    type: 'EXECUTABLE',
    sourceFiles: ['/src/main.cpp'],
    guessedExecutablePath: '/b/a/app',
  };

  function createMemento(initial?: string): vscode.Memento {
    const state = new Map<string, string>();
    if (initial) {
      state.set('cmakerunner.selectedPreset', initial);
    }

    return {
      get: (key: string) => state.get(key),
      update: async (key: string, value: string) => {
        state.set(key, value);
      },
      keys: () => [...state.keys()],
      setKeysForSync: () => {},
    } as unknown as vscode.Memento;
  }

  function createStore(initialPresetName?: string): SessionStore {
    return new SessionStore(createMemento(initialPresetName), new OutputLogger(createMockOutputChannel()));
  }

  it('resolves the stored preset and persists the effective selection', async () => {
    const store = createStore('b');
    await store.setPresets([presetA, presetB]);
    assert.strictEqual(store.getCurrentPreset()?.name, 'b');

    await store.selectPreset(presetA);
    assert.strictEqual(store.getCurrentPreset()?.name, 'a');
  });

  it('falls back to the first preset when the stored name is unknown', async () => {
    const store = createStore('missing');
    await store.setPresets([presetA, presetB]);
    assert.strictEqual(store.getCurrentPreset()?.name, 'a');
  });

  it('clears targets when the preset changes and exposes the new mapping', async () => {
    const store = createStore();
    const targetsChanged: number[] = [];
    store.onDidChangeTargets(() => targetsChanged.push(store.getTargets().length));

    const mapping: MappingIndex = {
      targets: new Map([[target.id, target]]),
      sourceToTargets: new Map([['/src/main.cpp', [target.id]]]),
    };
    store.setMapping(mapping);
    assert.strictEqual(store.getTargets().length, 1);
    assert.strictEqual(store.findTargetsBySource('\\src\\main.cpp').length, 1);

    await store.selectPreset(presetB);
    assert.deepStrictEqual(store.getTargets(), []);
    assert.deepStrictEqual(store.findTargetsBySource('/src/main.cpp'), []);
    assert.deepStrictEqual(targetsChanged, [1, 0]);
  });

  it('fires active source events only when the path changes', () => {
    const store = createStore();
    let fired = 0;
    store.onDidChangeActiveSource(() => {
      fired += 1;
    });

    store.setActiveSourcePath('/src/main.cpp');
    store.setActiveSourcePath('/src/main.cpp');
    store.setActiveSourcePath(undefined);

    assert.strictEqual(fired, 2);
  });
});
