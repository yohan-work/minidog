import { randomBytes } from 'node:crypto';

// Crockford-style base32 without ambiguous characters. 256 % 32 === 0, so the
// modulo below does not bias the distribution.
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

export function createId(prefix: string, length = 16): string {
  let id = '';
  for (const byte of randomBytes(length)) id += ALPHABET.charAt(byte % 32);
  return `${prefix}_${id}`;
}
