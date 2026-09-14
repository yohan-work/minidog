export type StatusMatcher = ReadonlyArray<readonly [min: number, max: number]>;

/**
 * Parses accepted status codes such as `200-399` or `200, 301-302`.
 * Returns null for invalid input.
 */
export function parseExpectedStatus(input: string): StatusMatcher | null {
  const parts = input
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0 || parts.length > 10) return null;

  const ranges: (readonly [number, number])[] = [];
  for (const part of parts) {
    const match = /^(\d{3})(?:\s*-\s*(\d{3}))?$/.exec(part);
    if (!match) return null;
    const min = Number(match[1]);
    const max = match[2] === undefined ? min : Number(match[2]);
    if (min < 100 || max > 599 || min > max) return null;
    ranges.push([min, max]);
  }
  return ranges;
}

/** Canonical form stored in the database, e.g. `200-299,301`. */
export function formatExpectedStatus(matcher: StatusMatcher): string {
  return matcher.map(([min, max]) => (min === max ? `${min}` : `${min}-${max}`)).join(',');
}

export function matchesStatus(matcher: StatusMatcher, code: number): boolean {
  return matcher.some(([min, max]) => code >= min && code <= max);
}
