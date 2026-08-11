import * as assert from 'assert';
import * as path from 'path';
import { isTestNamedExecutable } from '../src/services/testController';

describe('test controller', () => {
  describe('isTestNamedExecutable', () => {
    it('accepts executables whose name starts with test in lowercase', () => {
      assert.strictEqual(isTestNamedExecutable(path.join('build', 'test_math.exe')), true);
      assert.strictEqual(isTestNamedExecutable(path.join('build', 'test_math')), true);
      assert.strictEqual(isTestNamedExecutable('test.exe'), true);
      assert.strictEqual(isTestNamedExecutable('test'), true);
    });

    it('accepts executables whose name starts with test regardless of case', () => {
      assert.strictEqual(isTestNamedExecutable(path.join('build', 'TestMath.exe')), true);
      assert.strictEqual(isTestNamedExecutable(path.join('build', 'TEST_MATH.exe')), true);
      assert.strictEqual(isTestNamedExecutable(path.join('build', 'tEsT-app.exe')), true);
    });

    it('rejects app executables that do not start with test', () => {
      assert.strictEqual(isTestNamedExecutable(path.join('build', 'myapp.exe')), false);
      assert.strictEqual(isTestNamedExecutable(path.join('build', 'main.exe')), false);
      assert.strictEqual(isTestNamedExecutable(path.join('build', 'app')), false);
    });

    it('rejects executables where test appears inside or at the end of the name', () => {
      assert.strictEqual(isTestNamedExecutable(path.join('build', 'contest.exe')), false);
      assert.strictEqual(isTestNamedExecutable(path.join('build', 'latest.exe')), false);
      assert.strictEqual(isTestNamedExecutable(path.join('build', 'mytest.exe')), false);
      assert.strictEqual(isTestNamedExecutable(path.join('build', 'test_app_helper.exe')), true);
    });
  });
});
