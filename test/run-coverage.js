const path = require('path');
const { spawn } = require('child_process');
const { discoverTestSuites } = require('./test-files');

const projectRoot = path.join(__dirname, '..');
const { testFiles, appended } = discoverTestSuites();

if (appended.length > 0) {
  console.warn(`[run-coverage] Running test suites not listed in preferredOrder: ${appended.join(', ')}`);
}

const child = spawn(process.execPath, [
  'node_modules/c8/bin/c8.js',
  '--reporter=text',
  '--reporter=lcov',
  '--exclude', 'test/**',
  '--exclude', 'out/test/**',
  process.execPath,
  '-r', './test/vscode-mock.js',
  'node_modules/mocha/bin/mocha',
  '--timeout', '10000',
  ...testFiles,
], {
  stdio: 'inherit',
  cwd: projectRoot,
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
