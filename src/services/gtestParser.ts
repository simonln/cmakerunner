import { GTestCaseInfo } from '../models';

export function parseGTestListOutput(output: string): GTestCaseInfo[] {
  const testCases: GTestCaseInfo[] = [];
  let currentSuite = '';

  for (const line of output.split(/\r?\n/)) {
    const withoutComment = line.replace(/\s+#.*$/, '').trimEnd();
    if (!withoutComment.trim()) {
      continue;
    }

    if (!/^\s/.test(withoutComment) && withoutComment.endsWith('.')) {
      currentSuite = withoutComment.slice(0, -1).trim();
      continue;
    }

    const testName = withoutComment.trim();
    if (!currentSuite || !testName) {
      continue;
    }

    const filter = `${currentSuite}.${testName}`;
    testCases.push({
      suite: currentSuite,
      name: testName,
      filter,
    });
  }

  return testCases;
}
