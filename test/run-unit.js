const path = require('path');
const { spawn } = require('child_process');
const { discoverTestSuites } = require('./test-files');

const projectRoot = path.join(__dirname, '..');
const mockPath = path.join(__dirname, 'vscode-mock.js');
const { testFiles, appended } = discoverTestSuites();

if (appended.length > 0) {
  console.warn(`[run-unit] Running test suites not listed in preferredOrder: ${appended.join(', ')}`);
}

const child = spawn(process.execPath, ['-r', mockPath, 'node_modules/mocha/bin/mocha', '--timeout', '10000', ...testFiles], {
  stdio: 'inherit',
  cwd: projectRoot,
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
