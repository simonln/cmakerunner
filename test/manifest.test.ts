import * as assert from 'assert';

const packageJson = require('../package.json') as {
  activationEvents?: string[];
};

describe('package manifest', () => {
  it('activates for both CMake preset entry files and after startup', () => {
    const activationEvents = packageJson.activationEvents ?? [];

    assert.ok(activationEvents.includes('onWorkspaceContains:CMakePresets.json'));
    assert.ok(activationEvents.includes('onWorkspaceContains:CMakeUserPresets.json'));
    assert.ok(activationEvents.includes('onStartupFinished'));
  });
});
