const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');

const preferredOrder = [
  'utils.test.js',
  'models.test.js',
  'services.test.js',
  'gtestSourceLocator.test.js',
  'gtestParser.test.js',
  'testController.test.js',
  'ui.test.js',
  'integration.test.js',
  'workflow.test.js',
  'taskExecutionEngine.test.js',
  'windowsTooling.test.js',
  'manifest.test.js',
  'extension.test.js',
];

function discoverTestSuites() {
  const outTestDir = path.join(projectRoot, 'out', 'test');
  if (!fs.existsSync(outTestDir)) {
    throw new Error(`Compiled test directory not found: ${outTestDir}. Run "npm run compile" first.`);
  }
  const discovered = fs.readdirSync(outTestDir).filter((file) => file.endsWith('.test.js'));
  if (discovered.length === 0) {
    throw new Error(`No compiled test suites found in ${outTestDir}. Run "npm run compile" first.`);
  }
  const ordered = [
    ...preferredOrder.filter((file) => discovered.includes(file)),
    ...discovered.filter((file) => !preferredOrder.includes(file)).sort(),
  ];

  return {
    testFiles: ordered.map((file) => path.join('out', 'test', file)),
    appended: ordered.filter((file) => !preferredOrder.includes(file)),
  };
}

module.exports = { discoverTestSuites };
