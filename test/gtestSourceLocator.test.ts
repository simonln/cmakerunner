import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findGTestSourceLocation } from '../src/services/gtestSourceLocator';

describe('gtest source locator', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cmakerunner-gtest-source-'));

  after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('finds a concrete GoogleTest macro in target sources', async () => {
    const sourcePath = path.join(tempRoot, 'math_test.cpp');
    fs.writeFileSync(sourcePath, [
      '#include <gtest/gtest.h>',
      '',
      'TEST_F(MathTest, Adds) {',
      '  ASSERT_EQ(2, 1 + 1);',
      '}',
    ].join('\n'));

    const location = await findGTestSourceLocation(
      { suite: 'MathTest', name: 'Adds', filter: 'MathTest.Adds' },
      [sourcePath],
    );

    assert.deepStrictEqual(location, {
      filePath: sourcePath,
      line: 2,
      character: 0,
    });
  });

  it('matches typed and parameterized suite names reported with suffixes', async () => {
    const sourcePath = path.join(tempRoot, 'typed_test.cc');
    fs.writeFileSync(sourcePath, [
      '#include <gtest/gtest.h>',
      '',
      'TYPED_TEST(',
      '  TypedSuite,',
      '  Works',
      ') {',
      '  SUCCEED();',
      '}',
    ].join('\n'));

    const location = await findGTestSourceLocation(
      { suite: 'TypedSuite/0', name: 'Works', filter: 'TypedSuite/0.Works' },
      [sourcePath],
    );

    assert.strictEqual(location?.filePath, sourcePath);
    assert.strictEqual(location?.line, 2);
  });

  it('matches value-parameterized test names reported with instance suffixes', async () => {
    const sourcePath = path.join(tempRoot, 'parameterized_test.cpp');
    fs.writeFileSync(sourcePath, [
      '#include <gtest/gtest.h>',
      '',
      'TEST_P(MathFixture, Adds) {',
      '  ASSERT_TRUE(true);',
      '}',
    ].join('\n'));

    const location = await findGTestSourceLocation(
      { suite: 'AllInputs/MathFixture', name: 'Adds/0', filter: 'AllInputs/MathFixture.Adds/0' },
      [sourcePath],
    );

    assert.strictEqual(location?.filePath, sourcePath);
    assert.strictEqual(location?.line, 2);
  });

  it('finds macros in GBK encoded source files', async () => {
    const sourcePath = path.join(tempRoot, 'gbk_test.cpp');
    const gbkComment = Buffer.from([0x2f, 0x2f, 0x20, 0xd6, 0xd0, 0xce, 0xc4, 0x0a]);
    const asciiSource = Buffer.from([
      'TEST(MathTest, Adds) {',
      '  ASSERT_TRUE(true);',
      '}',
    ].join('\n'));
    fs.writeFileSync(sourcePath, Buffer.concat([gbkComment, asciiSource]));

    const location = await findGTestSourceLocation(
      { suite: 'MathTest', name: 'Adds', filter: 'MathTest.Adds' },
      [sourcePath],
    );

    assert.strictEqual(location?.filePath, sourcePath);
    assert.strictEqual(location?.line, 1);
  });

  it('ignores missing files and non-C/C++ sources', async () => {
    const notesPath = path.join(tempRoot, 'notes.txt');
    fs.writeFileSync(notesPath, 'TEST(MathTest, Adds) {}\n');

    const location = await findGTestSourceLocation(
      { suite: 'MathTest', name: 'Adds', filter: 'MathTest.Adds' },
      [path.join(tempRoot, 'missing.cpp'), notesPath],
    );

    assert.strictEqual(location, undefined);
  });
});
