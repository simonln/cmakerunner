import * as assert from 'assert';
import { parseGTestListOutput } from '../src/services/gtestParser';

describe('gtest parser', () => {
  it('parses suites, tests, and comments', () => {
    const parsed = parseGTestListOutput([
      'MathTest.',
      '  Adds',
      '  Divides # GetParam() = 1',
      'TypedSuite/0.  # TypeParam = int',
      '  Works',
    ].join('\n'));

    assert.deepStrictEqual(parsed, [
      { suite: 'MathTest', name: 'Adds', filter: 'MathTest.Adds' },
      { suite: 'MathTest', name: 'Divides', filter: 'MathTest.Divides' },
      { suite: 'TypedSuite/0', name: 'Works', filter: 'TypedSuite/0.Works' },
    ]);
  });

  it('returns an empty list for empty output', () => {
    assert.deepStrictEqual(parseGTestListOutput(''), []);
  });
});
