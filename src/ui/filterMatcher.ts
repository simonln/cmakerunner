export interface FilterMatcher {
  readonly text: string;
  readonly isRegex: boolean;
  matches(value: string): boolean;
}

export function createFilterMatcher(
  filterText: string,
  isRegex: boolean,
  normalizeValue: (value: string) => string,
): FilterMatcher | undefined {
  const trimmed = filterText.trim();
  if (!trimmed) {
    return undefined;
  }

  if (isRegex) {
    const regex = new RegExp(trimmed, 'i');
    return {
      text: trimmed,
      isRegex: true,
      matches: (value) => regex.test(normalizeValue(value)),
    };
  }

  const query = normalizeValue(trimmed);
  return {
    text: trimmed,
    isRegex: false,
    matches: (value) => normalizeValue(value).toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  };
}

export function getRegexFilterError(filterText: string): string | undefined {
  try {
    new RegExp(filterText.trim());
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
