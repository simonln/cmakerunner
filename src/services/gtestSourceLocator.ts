import * as fs from 'fs/promises';
import * as path from 'path';
import { GTestCaseInfo } from '../models';
import { decodeTextBufferCandidates } from '../utils';

export interface GTestSourceLocation {
  readonly filePath: string;
  readonly line: number;
  readonly character: number;
}

interface IndexedMacroMatch {
  readonly suite: string;
  readonly name: string;
  readonly location: GTestSourceLocation;
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
  const locations = await findGTestSourceLocations([testCase], sourceFiles);
  return locations.get(testCase.filter);
}

export async function findGTestSourceLocations(
  testCases: readonly GTestCaseInfo[],
  sourceFiles: readonly string[],
): Promise<Map<string, GTestSourceLocation>> {
  const locations = new Map<string, GTestSourceLocation>();
  if (testCases.length === 0 || sourceFiles.length === 0) {
    return locations;
  }

  const requestedMatches = new Map<string, string[]>();
  for (const testCase of testCases) {
    for (const suiteCandidate of getSuiteCandidates(testCase.suite)) {
      for (const nameCandidate of getNameCandidates(testCase.name)) {
        const key = createCandidateKey(suiteCandidate, nameCandidate);
        const filters = requestedMatches.get(key) ?? [];
        if (!filters.includes(testCase.filter)) {
          filters.push(testCase.filter);
        }
        requestedMatches.set(key, filters);
      }
    }
  }

  for (const sourceFile of sourceFiles) {
    if (!isCxxSourceFile(sourceFile)) {
      continue;
    }

    const contents = await readTextFileCandidates(sourceFile);
    if (contents.length === 0) {
      continue;
    }

    for (const content of contents) {
      for (const match of findMacroMatches(content, sourceFile)) {
        const filters = requestedMatches.get(createCandidateKey(match.suite, match.name));
        if (!filters) {
          continue;
        }

        for (const filter of filters) {
          if (!locations.has(filter)) {
            locations.set(filter, match.location);
          }
        }
      }
    }
  }

  return locations;
}

function findMacroMatches(content: string, filePath: string): IndexedMacroMatch[] {
  const matches: IndexedMacroMatch[] = [];
  gtestMacroPattern.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = gtestMacroPattern.exec(content)) !== null) {
    const [, suite, name] = match;
    const position = getLineAndCharacter(content, match.index);
    matches.push({
      suite,
      name,
      location: {
        filePath,
        line: position.line,
        character: position.character,
      },
    });
  }

  return matches;
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

function createCandidateKey(suite: string, name: string): string {
  return `${suite}\u0000${name}`;
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
