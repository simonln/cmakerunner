import * as assert from 'assert';
import * as path from 'path';
import * as utils from '../src/utils';

describe('utils', () => {
  describe('normalizePath', () => {
    it('should normalize path separators', () => {
      assert.strictEqual(utils.normalizePath('foo/bar\\baz'), path.join('foo', 'bar', 'baz'));
    });

    it('should lowercase on Windows', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32' });
      try {
        assert.strictEqual(utils.normalizePath('FOO/BAR'), path.join('foo', 'bar'));
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
      }
    });

    it('should preserve case on Unix', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux' });
      try {
        assert.strictEqual(utils.normalizePath('Foo/Bar'), path.join('Foo', 'Bar'));
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
      }
    });
  });

  describe('toAbsolutePath', () => {
    it('should return absolute path unchanged', () => {
      const absPath = process.platform === 'win32' ? 'C:\\foo\\bar' : '/foo/bar';
      assert.strictEqual(utils.toAbsolutePath(absPath, '/base'), absPath);
    });

    it('should resolve relative path from base dir', () => {
      const result = utils.toAbsolutePath('../foo', '/base/bar');
      const expected = path.resolve('/base', 'foo');
      assert.strictEqual(result, expected);
    });

    it('should handle mixed separators', () => {
      const result = utils.toAbsolutePath('foo/bar', '/base');
      assert.strictEqual(result, path.resolve('/base', path.join('foo', 'bar')));
    });
  });

  describe('uniqueSorted', () => {
    it('should deduplicate and sort', () => {
      const result = utils.uniqueSorted(['c', 'a', 'b', 'a']);
      assert.deepStrictEqual(result, ['a', 'b', 'c']);
    });

    it('should handle empty', () => {
      assert.deepStrictEqual(utils.uniqueSorted([]), []);
    });

    it('should handle single item', () => {
      assert.deepStrictEqual(utils.uniqueSorted(['a']), ['a']);
    });
  });

  describe('basenameWithoutExecutableExtension', () => {
    it('should strip .exe', () => {
      assert.strictEqual(utils.basenameWithoutExecutableExtension('app.exe'), 'app');
    });

    it('should strip .EXE', () => {
      assert.strictEqual(utils.basenameWithoutExecutableExtension('app.EXE'), 'app');
    });

    it('should preserve other extensions', () => {
      assert.strictEqual(utils.basenameWithoutExecutableExtension('app.dll'), 'app.dll');
    });

    it('should return base without extension', () => {
      assert.strictEqual(utils.basenameWithoutExecutableExtension('libfoo'), 'libfoo');
    });
  });

  describe('replaceTemplateVariables', () => {
    it('should replace single variable', () => {
      const result = utils.replaceTemplateVariables('${name}', { name: 'value' });
      assert.strictEqual(result, 'value');
    });

    it('should replace multiple variables', () => {
      const result = utils.replaceTemplateVariables('${a}_${b}', { a: 'foo', b: 'bar' });
      assert.strictEqual(result, 'foo_bar');
    });

    it('should leave missing variables empty', () => {
      const result = utils.replaceTemplateVariables('${missing}', {});
      assert.strictEqual(result, '');
    });

    it('should handle object with all keys', () => {
      const result = utils.replaceTemplateVariables('${x}', { x: undefined });
      assert.strictEqual(result, '');
    });
  });

  describe('getDefaultExecutablePath', () => {
    it('should use target name as-is on Unix', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux' });
      try {
        assert.strictEqual(utils.getDefaultExecutablePath('/build', 'myapp'), path.join('/build', 'myapp'));
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
      }
    });

    it('should add .exe on Windows without extension', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32' });
      try {
        assert.strictEqual(utils.getDefaultExecutablePath('C:\\build', 'myapp'), path.join('C:\\build', 'myapp.exe'));
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
      }
    });

    it('should preserve existing extension on Windows', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32' });
      try {
        assert.strictEqual(utils.getDefaultExecutablePath('C:\\build', 'myapp.exe'), path.join('C:\\build', 'myapp.exe'));
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
      }
    });
  });

  describe('extractProgramPath', () => {
    it('should return empty string for empty input', () => {
      assert.strictEqual(utils.extractProgramPath(''), '');
    });

    it('should return whitespace-trimmed input', () => {
      assert.strictEqual(utils.extractProgramPath('  app  '), 'app');
    });

    it('should extract quoted path', () => {
      assert.strictEqual(utils.extractProgramPath('"my app" arg'), 'my app');
    });

    it('should extract path before first space', () => {
      assert.strictEqual(utils.extractProgramPath('myapp arg1 arg2'), 'myapp');
    });

    it('should handle path without args', () => {
      assert.strictEqual(utils.extractProgramPath('myapp'), 'myapp');
    });

    it('should handle empty quoted path', () => {
      assert.strictEqual(utils.extractProgramPath('"" extra'), '" extra');
    });
  });

  describe('quoteForShell', () => {
    it('should quote path with space', () => {
      assert.strictEqual(utils.quoteForShell('my app'), '"my app"');
    });

    it('should not quote path without space', () => {
      assert.strictEqual(utils.quoteForShell('myapp'), 'myapp');
    });
  });

  describe('relativeDisplayPath', () => {
    it('should return relative path within source dir', () => {
      assert.strictEqual(utils.relativeDisplayPath('/src/foo/bar.cpp', '/src'), path.join('foo', 'bar.cpp'));
    });

    it('should return absolute path outside source dir', () => {
      assert.strictEqual(utils.relativeDisplayPath('/other/bar.cpp', '/src'), '/other/bar.cpp');
    });

    it('should handle same directory', () => {
      assert.strictEqual(utils.relativeDisplayPath('/src/main.cpp', '/src'), 'main.cpp');
    });
  });

  describe('parseJsonBuffer', () => {
    it('should parse valid UTF-8 JSON', () => {
      const buffer = new TextEncoder().encode(JSON.stringify({ foo: 'bar' }));
      const result = utils.parseJsonBuffer<{ foo: string }>(buffer);
      assert.strictEqual(result.value.foo, 'bar');
      assert.strictEqual(result.encoding, 'utf8');
    });

    it('should parse UTF-8 with BOM', () => {
      const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
      const json = new TextEncoder().encode('{"foo":"bar"}');
      const buffer = Uint8Array.from([...bom, ...json]);
      const result = utils.parseJsonBuffer<{ foo: string }>(buffer);
      assert.strictEqual(result.value.foo, 'bar');
    });

    it('should throw on invalid JSON', () => {
      const buffer = new TextEncoder().encode('not json');
      assert.throws(() => utils.parseJsonBuffer(buffer));
    });
  });
});
