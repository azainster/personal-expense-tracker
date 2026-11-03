/** String similarity helpers used by merchant matching and fuzzy deduplication. */

/** Jaro similarity, 0..1. */
export function jaro(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const matchWindow = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatched = new Array<boolean>(a.length).fill(false);
  const bMatched = new Array<boolean>(b.length).fill(false);

  let matches = 0;
  for (let i = 0; i < a.length; i += 1) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, b.length);
    for (let j = start; j < end; j += 1) {
      if (bMatched[j] || a[i] !== b[j]) continue;
      aMatched[i] = true;
      bMatched[j] = true;
      matches += 1;
      break;
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (!aMatched[i]) continue;
    while (!bMatched[k]) k += 1;
    if (a[i] !== b[k]) transpositions += 1;
    k += 1;
  }

  const t = transpositions / 2;
  return (matches / a.length + matches / b.length + (matches - t) / matches) / 3;
}

/** Jaro-Winkler similarity, 0..1. The architecture's dedupe threshold is 0.85. */
export function jaroWinkler(a: string, b: string, prefixScale = 0.1): number {
  const base = jaro(a, b);
  if (base === 0) return 0;
  let prefix = 0;
  const max = Math.min(4, a.length, b.length);
  while (prefix < max && a[prefix] === b[prefix]) prefix += 1;
  return base + prefix * prefixScale * (1 - base);
}

/** Token-level containment: does every token of `needle` appear in `haystack`? */
export function tokenSubset(needle: string, haystack: string): boolean {
  const hay = new Set(haystack.split(/\s+/).filter(Boolean));
  const tokens = needle.split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((t) => hay.has(t));
}
