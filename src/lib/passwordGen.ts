export interface GenOptions {
  length: number;
  upper: boolean;
  lower: boolean;
  digits: boolean;
  symbols: boolean;
}

const SETS = {
  upper: "ABCDEFGHJKLMNPQRSTUVWXYZ",
  lower: "abcdefghijkmnopqrstuvwxyz",
  digits: "23456789",
  symbols: "!@#$%^&*()-_=+[]{};:,.?/",
};

/** Cryptographically secure password generation (rejection sampling, no modulo bias). */
export function generatePassword(opts: GenOptions): string {
  const pools = (Object.keys(SETS) as (keyof typeof SETS)[]).filter((k) => opts[k]);
  if (pools.length === 0) return "";
  const alphabet = pools.map((k) => SETS[k]).join("");
  const length = Math.max(4, Math.min(128, opts.length));

  const randBelow = (max: number): number => {
    const limit = Math.floor(256 / max) * max;
    const buf = new Uint8Array(1);
    let v: number;
    do {
      crypto.getRandomValues(buf);
      v = buf[0];
    } while (v >= limit);
    return v % max;
  };

  // Guarantee at least one char from each selected set, fill the rest randomly.
  const chars: string[] = pools.map((k) => SETS[k][randBelow(SETS[k].length)]);
  while (chars.length < length) {
    chars.push(alphabet[randBelow(alphabet.length)]);
  }
  // Fisher–Yates shuffle with secure randomness.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randBelow(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
