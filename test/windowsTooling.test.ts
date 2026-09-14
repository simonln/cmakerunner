import * as assert from 'assert';
import childProcess = require('child_process');
import * as fs from 'fs';
import * as path from 'path';

describe('windows tooling', () => {
  const loadWindowsToolingModule = () => {
    const modulePath = require.resolve('../src/services/windowsTooling');
    delete require.cache[modulePath];
    return require('../src/services/windowsTooling') as typeof import('../src/services/windowsTooling');
  };

  const setPlatform = (platform: NodeJS.Platform): (() => void) => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: platform });
    return () => {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    };
  };

  it('findVsWherePath returns the installer path from ProgramFiles(x86)', () => {
    const originalProgramFilesX86 = process.env['ProgramFiles(x86)'];
    const fakeRoot = path.join(__dirname, 'fixtures', 'programfiles-x86');
    const vswherePath = path.join(fakeRoot, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
    fs.mkdirSync(path.dirname(vswherePath), { recursive: true });
    fs.writeFileSync(vswherePath, 'binary');
    process.env['ProgramFiles(x86)'] = fakeRoot;

    try {
      const { findVsWherePath } = loadWindowsToolingModule();
      assert.strictEqual(findVsWherePath(), vswherePath);
    } finally {
      if (originalProgramFilesX86 === undefined) {
        delete process.env['ProgramFiles(x86)'];
      } else {
        process.env['ProgramFiles(x86)'] = originalProgramFilesX86;
      }
    }
  });

  it('findVsWhereMatchSync returns the first non-empty output line', () => {
    const restorePlatform = setPlatform('win32');
    const originalProgramFilesX86 = process.env['ProgramFiles(x86)'];
    const execFileSyncDescriptor = Object.getOwnPropertyDescriptor(childProcess, 'execFileSync')!;
    const fakeRoot = path.join(__dirname, 'fixtures', 'programfiles-sync');
    const vswherePath = path.join(fakeRoot, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
    fs.mkdirSync(path.dirname(vswherePath), { recursive: true });
    fs.writeFileSync(vswherePath, 'binary');
    process.env['ProgramFiles(x86)'] = fakeRoot;

    Object.defineProperty(childProcess, 'execFileSync', {
      value: () => '\n  C:\\VS\\VC\\Auxiliary\\Build\\vcvarsall.bat  \n\n',
      configurable: true,
    });

    try {
      const { findVsWhereMatchSync } = loadWindowsToolingModule();
      assert.strictEqual(findVsWhereMatchSync(['-latest']), 'C:\\VS\\VC\\Auxiliary\\Build\\vcvarsall.bat');
    } finally {
      Object.defineProperty(childProcess, 'execFileSync', execFileSyncDescriptor);
      if (originalProgramFilesX86 === undefined) {
        delete process.env['ProgramFiles(x86)'];
      } else {
        process.env['ProgramFiles(x86)'] = originalProgramFilesX86;
      }
      restorePlatform();
    }
  });

  it('findVsWhereMatch returns undefined when execFile fails', async () => {
    const restorePlatform = setPlatform('win32');
    const originalProgramFilesX86 = process.env['ProgramFiles(x86)'];
    const execFileDescriptor = Object.getOwnPropertyDescriptor(childProcess, 'execFile')!;
    const fakeRoot = path.join(__dirname, 'fixtures', 'programfiles-async');
    const vswherePath = path.join(fakeRoot, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
    fs.mkdirSync(path.dirname(vswherePath), { recursive: true });
    fs.writeFileSync(vswherePath, 'binary');
    process.env['ProgramFiles(x86)'] = fakeRoot;

    Object.defineProperty(childProcess, 'execFile', {
      value: (_file: string, _args: string[], _options: unknown, callback: Function) => {
        callback(new Error('spawn failed'));
      },
      configurable: true,
    });

    try {
      const { findVsWhereMatch } = loadWindowsToolingModule();
      const result = await findVsWhereMatch(['-latest']);
      assert.strictEqual(result, undefined);
    } finally {
      Object.defineProperty(childProcess, 'execFile', execFileDescriptor);
      if (originalProgramFilesX86 === undefined) {
        delete process.env['ProgramFiles(x86)'];
      } else {
        process.env['ProgramFiles(x86)'] = originalProgramFilesX86;
      }
      restorePlatform();
    }
  });
});
