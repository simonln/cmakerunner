import * as fs from 'fs/promises';
import * as path from 'path';
import { GTestCaseInfo } from '../models';
import { decodeTextBufferCandidates } from '../utils';

export interface GTestSourceLocation {
  readonly filePath: string;
  readonly line: number;
  readonly character: number;
}

interface MacroMatch {
  readonly index: number;
}

const sourceFileExtensions = new Set([
  '.c',
  '.cc',
  '.cpp',
  '.cxx',
  '.h',
  '.hh',
  '.hpp',
  '.hxx',
]);

const gtestMacroPattern = /\b(?:TEST|TEST_F|TEST_P|TYPED_TEST|TYPED_TEST_P)\s*\(\s*([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*)/g;

export async function findGTestSourceLocation(
  testCase: GTestCaseInfo,
  sourceFiles: readonly string[],
): Promise<GTestSourceLocation | undefined> {
  const suiteCandidates = getSuiteCandidates(testCase.suite);
  const nameCandidates = getNameCandidates(testCase.name);

  for (const sourceFile of sourceFiles) {
    if (!isCxxSourceFile(sourceFile)) {
      continue;
    }

    const contents = await readTextFileCandidates(sourceFile);
    if (contents.length === 0) {
      continue;
    }

    for (const content of contents) {
      const match = findMacroMatch(content, suiteCandidates, nameCandidates);
      if (!match) {
        continue;
      }

      const position = getLineAndCharacter(content, match.index);
      return {
        filePath: sourceFile,
        line: position.line,
        character: position.character,
      };
    }
  }

  return undefined;
}

function findMacroMatch(
  content: string,
  suiteCandidates: readonly string[],
  nameCandidates: readonly string[],
): MacroMatch | undefined {
  gtestMacroPattern.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = gtestMacroPattern.exec(content)) !== null) {
    const [, suite, name] = match;
    if (nameCandidates.includes(name) && suiteCandidates.includes(suite)) {
      return {
        index: match.index,
      };
    }
  }

  return undefined;
}

function getSuiteCandidates(suite: string): string[] {
  const candidates = new Set<string>([suite]);
  const suiteParts = suite.split('/').filter(Boolean);
  for (const suitePart of suiteParts) {
    candidates.add(suitePart);
  }

  return [...candidates];
}

function getNameCandidates(testName: string): string[] {
  const candidates = new Set<string>([testName]);
  const nameParts = testName.split('/').filter(Boolean);
  if (nameParts[0]) {
    candidates.add(nameParts[0]);
  }

  return [...candidates];
}

function isCxxSourceFile(filePath: string): boolean {
  return sourceFileExtensions.has(path.extname(filePath).toLowerCase());
}

async function readTextFileCandidates(filePath: string): Promise<string[]> {
  try {
    const content = await fs.readFile(filePath);
    return decodeTextBufferCandidates(content).map((decoded) => decoded.text);
  } catch {
    return [];
  }
}

function getLineAndCharacter(content: string, index: number): { line: number; character: number } {
  const before = content.slice(0, index);
  const lines = before.split(/\r?\n/);
  return {
    line: lines.length - 1,
    character: lines[lines.length - 1].length,
  };
}
