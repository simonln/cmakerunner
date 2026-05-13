import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { PresetProvider } from '../src/services/presetProvider';
import { MappingEngine } from '../src/services/mappingEngine';
import { OutputLogger } from '../src/services/outputLogger';

describe('integration', () => {
  const testWorkspaceDir = path.join(__dirname, 'fixtures', 'workspace');
  const inheritedWorkspaceDir = path.join(__dirname, 'fixtures', 'workspace-inherited');
  const mappingWorkspaceDir = path.join(__dirname, 'fixtures', 'workspace-mapping');
  const mappingEmptyWorkspaceDir = path.join(__dirname, 'fixtures', 'workspace-mapping-empty');
  const mappingNoCodemodelWorkspaceDir = path.join(__dirname, 'fixtures', 'workspace-mapping-no-codemodel');
  const mappingMultiConfigWorkspaceDir = path.join(__dirname, 'fixtures', 'workspace-mapping-multi-config');
  const invalidPresetWorkspaceDir = path.join(__dirname, 'fixtures', 'workspace-invalid-presets');
  const mockOutputChannel = {
    name: 'test',
    append: () => {},
    appendLine: () => {},
    clear: () => {},
    show: () => {},
    hide: () => {},
    dispose: () => {},
  } as unknown as vscode.OutputChannel;

  const logger = new OutputLogger(mockOutputChannel);

  before(() => {
    const fixturesDir = path.join(__dirname, 'fixtures');
    if (!fs.existsSync(fixturesDir)) {
      fs.mkdirSync(fixturesDir, { recursive: true });
    }

    const testDir = path.join(fixturesDir, 'workspace');
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }

    const cmakePresets = {
      version: 3,
      configurePresets: [
        {
          name: 'debug',
          displayName: 'Debug',
          description: 'Debug build',
          binaryDir: '${sourceDir}/build/debug',
        },
        {
          name: 'release',
          displayName: 'Release',
          hidden: true,
          binaryDir: '${sourceDir}/build/release',
        },
      ],
    };
    fs.writeFileSync(
      path.join(testDir, 'CMakePresets.json'),
      JSON.stringify(cmakePresets, null, 2),
    );

    fs.mkdirSync(inheritedWorkspaceDir, { recursive: true });
    fs.writeFileSync(
      path.join(inheritedWorkspaceDir, 'CMakePresets.json'),
      JSON.stringify({
        version: 3,
        include: ['shared-presets.json'],
        configurePresets: [
          {
            name: 'dev',
            inherits: 'base',
            binaryDir: '${sourceDir}/build/dev',
          },
        ],
        buildPresets: [
          {
            name: 'dev-build',
            configurePreset: 'dev',
            configuration: 'Debug',
          },
        ],
      }, null, 2),
    );
    fs.writeFileSync(
      path.join(inheritedWorkspaceDir, 'shared-presets.json'),
      JSON.stringify({
        version: 3,
        configurePresets: [
          {
            name: 'base',
            displayName: 'Base',
            description: 'Shared base',
            binaryDir: '${sourceDir}/build/base',
          },
        ],
      }, null, 2),
    );

    const replyDir = path.join(mappingWorkspaceDir, 'build', 'debug', '.cmake', 'api', 'v1', 'reply');
    fs.mkdirSync(replyDir, { recursive: true });
    fs.writeFileSync(
      path.join(replyDir, 'index-001.json'),
      JSON.stringify({
        objects: [{ kind: 'codemodel', jsonFile: 'codemodel-v2.json' }],
      }, null, 2),
    );
    fs.writeFileSync(
      path.join(replyDir, 'codemodel-v2.json'),
      JSON.stringify({
        configurations: [
          {
            name: 'Debug',
            targets: [
              { name: 'app', id: 'app', jsonFile: 'target-app.json' },
              { name: 'helper', id: 'helper', jsonFile: 'target-helper.json' },
            ],
          },
        ],
      }, null, 2),
    );
    fs.writeFileSync(
      path.join(replyDir, 'target-app.json'),
      JSON.stringify({
        name: 'app',
        type: 'EXECUTABLE',
        artifacts: [{ path: path.join(mappingWorkspaceDir, 'bin', 'app') }],
        sources: [
          { path: path.join(mappingWorkspaceDir, 'src', 'main.cpp') },
          { path: path.join(mappingWorkspaceDir, 'src', 'generated.cpp'), isGenerated: true },
        ],
      }, null, 2),
    );
    fs.writeFileSync(
      path.join(replyDir, 'target-helper.json'),
      JSON.stringify({
        name: 'helper',
        type: 'STATIC_LIBRARY',
        sources: [{ path: path.join(mappingWorkspaceDir, 'src', 'helper.cpp') }],
      }, null, 2),
    );

    fs.mkdirSync(path.join(mappingEmptyWorkspaceDir, 'build', 'debug', '.cmake', 'api', 'v1', 'reply'), { recursive: true });

    const noCodemodelReplyDir = path.join(mappingNoCodemodelWorkspaceDir, 'build', 'debug', '.cmake', 'api', 'v1', 'reply');
    fs.mkdirSync(noCodemodelReplyDir, { recursive: true });
    fs.writeFileSync(
      path.join(noCodemodelReplyDir, 'index-001.json'),
      JSON.stringify({
        objects: [{ kind: 'cache', jsonFile: 'cache.json' }],
      }, null, 2),
    );

    const multiConfigReplyDir = path.join(mappingMultiConfigWorkspaceDir, 'build', 'debug', '.cmake', 'api', 'v1', 'reply');
    fs.mkdirSync(multiConfigReplyDir, { recursive: true });
    fs.writeFileSync(
      path.join(multiConfigReplyDir, 'index-001.json'),
      JSON.stringify({
        reply: {
          codemodel: { kind: 'codemodel', jsonFile: 'codemodel-v2.json' },
        },
      }, null, 2),
    );
    fs.writeFileSync(
      path.join(multiConfigReplyDir, 'codemodel-v2.json'),
      JSON.stringify({
        configurations: [
          {
            name: 'Debug',
            targets: [{ name: 'app', id: 'app-debug', jsonFile: 'target-app-debug.json' }],
          },
          {
            name: 'Release',
            targets: [{ name: 'app', id: 'app-release', jsonFile: 'target-app-release.json' }],
          },
        ],
      }, null, 2),
    );
    fs.writeFileSync(
      path.join(multiConfigReplyDir, 'target-app-debug.json'),
      JSON.stringify({
        name: 'app',
        type: 'EXECUTABLE',
        sources: [{ path: path.join(mappingMultiConfigWorkspaceDir, 'src', 'main.cpp') }],
      }, null, 2),
    );
    fs.writeFileSync(
      path.join(multiConfigReplyDir, 'target-app-release.json'),
      JSON.stringify({
        name: 'app',
        type: 'EXECUTABLE',
        artifacts: [{ path: path.join(mappingMultiConfigWorkspaceDir, 'bin', 'release', 'app') }],
        sources: [{ path: path.join(mappingMultiConfigWorkspaceDir, 'src', 'main.cpp') }],
      }, null, 2),
    );

    fs.mkdirSync(invalidPresetWorkspaceDir, { recursive: true });
    fs.writeFileSync(path.join(invalidPresetWorkspaceDir, 'CMakePresets.json'), '{ invalid json');
  });

  describe('PresetProvider', () => {
    it('should load presets from CMakePresets.json', async () => {
      const provider = new PresetProvider(testWorkspaceDir, logger);
      const presets = await provider.loadPresets();
      assert.ok(presets.length > 0);
      const debugPreset = presets.find((p) => p.name === 'debug');
      assert.ok(debugPreset);
      assert.strictEqual(debugPreset.displayName, 'Debug');
    });

    it('should resolve binary directory with template variables', async () => {
      const provider = new PresetProvider(testWorkspaceDir, logger);
      const presets = await provider.loadPresets();
      const debugPreset = presets.find((p) => p.name === 'debug');
      assert.ok(debugPreset);
      assert.ok(debugPreset.binaryDir.includes('build'));
    });

    it('should filter hidden presets by default', async () => {
      const provider = new PresetProvider(testWorkspaceDir, logger);
      const presets = await provider.loadPresets();
      const hiddenPreset = presets.find((p) => p.name === 'release');
      assert.strictEqual(hiddenPreset, undefined);
    });

    it('should merge inherited presets and attach build preset metadata', async () => {
      const provider = new PresetProvider(inheritedWorkspaceDir, logger);
      const presets = await provider.loadPresets();
      const devPreset = presets.find((preset) => preset.name === 'dev');
      assert.ok(devPreset);
      assert.strictEqual(devPreset.buildPresetName, 'dev-build');
      assert.strictEqual(devPreset.configuration, 'Debug');
      assert.strictEqual(devPreset.description, 'Shared base');
    });

    it('should return an empty list when preset files are invalid and CMake listing fails', async () => {
      const provider = new PresetProvider(invalidPresetWorkspaceDir, logger);
      const presets = await provider.loadPresets();
      assert.deepStrictEqual(presets, []);
    });
  });

  describe('MappingEngine', () => {
    it('should create empty index when no build directory exists', async () => {
      const engine = new MappingEngine(logger);
      const preset = {
        name: 'debug',
        displayName: 'Debug',
        binaryDir: '/nonexistent/build/debug',
        sourceDir: testWorkspaceDir,
      };
      await engine.rebuild(preset);
      const targets = engine.getTargets();
      assert.strictEqual(targets.length, 0);
    });

    it('should return empty array for non-existent source mapping', async () => {
      const engine = new MappingEngine(logger);
      const targets = engine.findTargetsBySource('/nonexistent/file.cpp');
      assert.strictEqual(targets.length, 0);
    });

    it('should build executable target index from file api reply', async () => {
      const engine = new MappingEngine(logger);
      await engine.rebuild({
        name: 'debug',
        displayName: 'Debug',
        binaryDir: path.join(mappingWorkspaceDir, 'build', 'debug'),
        sourceDir: mappingWorkspaceDir,
      });
      const targets = engine.getTargets();
      assert.strictEqual(targets.length, 1);
      assert.strictEqual(targets[0].name, 'app');
      assert.strictEqual(targets[0].configuration, 'Debug');
      assert.strictEqual(targets[0].sourceFiles.length, 1);
      assert.ok(targets[0].guessedExecutablePath.includes('bin'));
    });

    it('should find target by normalized source path after rebuild', async () => {
      const engine = new MappingEngine(logger);
      const sourcePath = path.join(mappingWorkspaceDir, 'src', 'main.cpp');
      await engine.rebuild({
        name: 'debug',
        displayName: 'Debug',
        binaryDir: path.join(mappingWorkspaceDir, 'build', 'debug'),
        sourceDir: mappingWorkspaceDir,
      });
      const targets = engine.findTargetsBySource(sourcePath);
      assert.strictEqual(targets.length, 1);
      assert.strictEqual(targets[0].name, 'app');
    });

    it('should keep empty target index when reply has no index files', async () => {
      const engine = new MappingEngine(logger);
      await engine.rebuild({
        name: 'debug',
        displayName: 'Debug',
        binaryDir: path.join(mappingEmptyWorkspaceDir, 'build', 'debug'),
        sourceDir: mappingEmptyWorkspaceDir,
      });
      assert.deepStrictEqual(engine.getTargets(), []);
    });

    it('should keep empty target index when codemodel reference is missing', async () => {
      const engine = new MappingEngine(logger);
      await engine.rebuild({
        name: 'debug',
        displayName: 'Debug',
        binaryDir: path.join(mappingNoCodemodelWorkspaceDir, 'build', 'debug'),
        sourceDir: mappingNoCodemodelWorkspaceDir,
      });
      assert.deepStrictEqual(engine.getTargets(), []);
    });

    it('should build per-configuration executable targets and map one source to multiple targets', async () => {
      const engine = new MappingEngine(logger);
      const sourcePath = path.join(mappingMultiConfigWorkspaceDir, 'src', 'main.cpp');
      await engine.rebuild({
        name: 'debug',
        displayName: 'Debug',
        binaryDir: path.join(mappingMultiConfigWorkspaceDir, 'build', 'debug'),
        sourceDir: mappingMultiConfigWorkspaceDir,
      });

      const targets = engine.getTargets();
      const mappedTargets = engine.findTargetsBySource(sourcePath);
      const defaultExecutableName = process.platform === 'win32' ? 'app.exe' : 'app';
      assert.strictEqual(targets.length, 2);
      assert.deepStrictEqual(targets.map((target) => target.displayName), ['app [Debug]', 'app [Release]']);
      assert.deepStrictEqual(mappedTargets.map((target) => target.id), ['app::debug', 'app::release']);
      assert.ok(mappedTargets.some((target) => target.guessedExecutablePath.endsWith(path.join('build', 'debug', defaultExecutableName))));
      assert.ok(mappedTargets.some((target) => target.guessedExecutablePath.endsWith(path.join('bin', 'release', 'app'))));
    });
  });
});
