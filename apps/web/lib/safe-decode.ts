/** Route params may arrive percent-encoded; malformed sequences are kept as-is. */
export function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
