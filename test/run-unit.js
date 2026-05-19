const path = require('path');
const projectRoot = path.join(__dirname, '..');
const mockPath = path.join(__dirname, 'vscode-mock.js');

const { spawn } = require('child_process');

const testFiles = [
  'out/test/utils.test.js',
  'out/test/models.test.js',
  'out/test/services.test.js',
  'out/test/gtestSourceLocator.test.js',
  'out/test/ui.test.js',
  'out/test/integration.test.js',
  'out/test/workflow.test.js',
  'out/test/extension.test.js',
];

const child = spawn(process.execPath, ['-r', mockPath, 'node_modules/mocha/bin/mocha', '--timeout', '10000', ...testFiles], {
  stdio: 'inherit',
  cwd: projectRoot
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
