import * as path from 'path';

type JsonEncoding = 'utf8' | 'utf16le' | 'utf16be';
type TextEncoding = JsonEncoding | 'gb18030' | 'gbk' | 'gb2312';

interface ParsedJsonBuffer<T> {
  readonly value: T;
  readonly encoding: JsonEncoding;
}

interface DecodedTextBuffer {
  readonly text: string;
  readonly encoding: TextEncoding;
}

export function normalizePath(filePath: string): string {
  const normalized = path.normalize(filePath.replace(/[\\/]+/g, path.sep));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function toAbsolutePath(candidatePath: string, baseDir: string): string {
  const normalizedCandidate = candidatePath.replace(/\\/g, path.sep).replace(/\//g, path.sep);
  return path.isAbsolute(normalizedCandidate)
    ? path.normalize(normalizedCandidate)
    : path.resolve(baseDir, normalizedCandidate);
}

export function uniqueSorted(items: Iterable<string>): string[] {
  return Array.from(new Set(items)).sort((left, right) => left.localeCompare(right));
}

export function basenameWithoutExecutableExtension(targetName: string): string {
  const parsed = path.parse(targetName);
  if (parsed.ext.toLowerCase() === '.exe') {
    return parsed.name;
  }

  return parsed.base;
}

export interface TemplateOptions {
  readonly quoteSpacedValues?: boolean;
}

export function replaceTemplateVariables(template: string, variables: Record<string, string | undefined> | object, options: TemplateOptions = {}): string {
  const valueMap = variables as Record<string, string | undefined>;
  return template.replace(/\$\{([^}]+)\}/g, (_, key: string) => {
    const value = valueMap[key] ?? '';
    if (!options.quoteSpacedValues) {
      return value;
    }

    // Quote bare values that contain spaces, but skip prebuilt command
    // fragments that already carry their own formatting (leading whitespace,
    // an already-quoted path, or the PowerShell call operator).
    return /^[^"&\s]/.test(value) ? quoteForShell(value) : value;
  });
}

export function getDefaultExecutablePath(buildDir: string, targetName: string): string {
  const hasExtension = path.extname(targetName).length > 0;
  const executableName = process.platform === 'win32' && !hasExtension
    ? `${targetName}.exe`
    : targetName;

  return path.join(buildDir, executableName);
}

export function extractProgramPath(commandOrPath: string): string {
  const trimmed = commandOrPath.trim().replace(/^&\s+/, '');
  if (!trimmed) {
    return trimmed;
  }

  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    const quote = trimmed[0];
    const closingQuoteIndex = trimmed.indexOf(quote, 1);
    return closingQuoteIndex > 1 ? trimmed.slice(1, closingQuoteIndex) : trimmed.slice(1);
  }

  const firstSpace = trimmed.search(/\s/);
  return firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
}

export function quoteForShell(commandPart: string): string {
  return commandPart.includes(' ') ? `"${commandPart}"` : commandPart;
}

export function quoteForPowerShell(commandPart: string): string {
  return `'${commandPart.replace(/'/g, "''")}'`;
}

export function relativeDisplayPath(filePath: string, sourceDir: string): string {
  const relative = path.relative(sourceDir, filePath);
  return relative && !relative.startsWith('..') ? relative : filePath;
}

export function parseJsonBuffer<T>(content: Uint8Array): ParsedJsonBuffer<T> {
  const buffer = Buffer.from(content);
  let lastError: unknown;

  for (const encoding of getJsonEncodingCandidates(buffer)) {
    try {
      const text = decodeJsonBuffer(buffer, encoding).replace(/^\uFEFF/, '');
      return {
        value: JSON.parse(text) as T,
        encoding,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Unable to parse JSON content with supported encodings');
}

export function decodeTextBuffer(content: Uint8Array): DecodedTextBuffer {
  const [decoded] = decodeTextBufferCandidates(content);
  if (decoded) {
    return decoded;
  }

  throw new Error('Unable to decode text content with supported encodings');
}

export function decodeTextBufferCandidates(content: Uint8Array): DecodedTextBuffer[] {
  const buffer = Buffer.from(content);
  const candidates: DecodedTextBuffer[] = [];

  for (const encoding of getTextEncodingCandidates(buffer)) {
    try {
      candidates.push({
        text: decodeBuffer(buffer, encoding).replace(/^\uFEFF/, ''),
        encoding,
      });
    } catch {
      // Unsupported or incompatible encodings are skipped.
    }
  }

  return candidates;
}

function getJsonEncodingCandidates(buffer: Buffer): JsonEncoding[] {
  const candidates: JsonEncoding[] = [];

  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    candidates.push('utf8');
  } else if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    candidates.push('utf16le');
  } else if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    candidates.push('utf16be');
  }

  for (const encoding of ['utf8', 'utf16le', 'utf16be'] as const) {
    if (!candidates.includes(encoding)) {
      candidates.push(encoding);
    }
  }

  return candidates;
}

function decodeJsonBuffer(buffer: Buffer, encoding: JsonEncoding): string {
  return decodeBuffer(buffer, encoding);
}

function getTextEncodingCandidates(buffer: Buffer): TextEncoding[] {
  const candidates: TextEncoding[] = [];
  const [bomEncoding] = getJsonEncodingCandidates(buffer);
  if (bomEncoding && hasEncodingBom(buffer, bomEncoding)) {
    candidates.push(bomEncoding);
  }

  for (const encoding of ['utf8', 'gb18030', 'gbk', 'gb2312', 'utf16le', 'utf16be'] as const) {
    if (!candidates.includes(encoding)) {
      candidates.push(encoding);
    }
  }

  return candidates;
}

function hasEncodingBom(buffer: Buffer, encoding: JsonEncoding): boolean {
  return (encoding === 'utf8' && buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf)
    || (encoding === 'utf16le' && buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe)
    || (encoding === 'utf16be' && buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff);
}

function decodeBuffer(buffer: Buffer, encoding: TextEncoding): string {
  if (encoding === 'utf8') {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  }

  if (encoding === 'utf16le') {
    return new TextDecoder('utf-16le', { fatal: true }).decode(buffer);
  }

  if (encoding === 'gb18030' || encoding === 'gbk' || encoding === 'gb2312') {
    return new TextDecoder(encoding, { fatal: true }).decode(buffer);
  }

  const swapped = Buffer.from(buffer);
  for (let index = 0; index + 1 < swapped.length; index += 2) {
    const first = swapped[index];
    swapped[index] = swapped[index + 1];
    swapped[index + 1] = first;
  }

  return new TextDecoder('utf-16le', { fatal: true }).decode(swapped);
}
