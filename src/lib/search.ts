export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (!max) return 0;
  return 1 - levenshtein(a, b) / max;
}

/** Score of a query term against a haystack. 0 = no match, higher = better. */
function termScore(haystack: string, term: string): number {
  if (!term) return 0;
  if (haystack.startsWith(term)) return 100;
  const idx = haystack.indexOf(term);
  if (idx >= 0) return 85 - Math.min(idx, 40) / 10;

  let best = 0;
  for (const word of haystack.split(" ")) {
    if (!word) continue;
    if (word.startsWith(term)) {
      best = Math.max(best, 92);
      continue;
    }
    if (term.length >= 3 && word.includes(term)) {
      best = Math.max(best, 78);
      continue;
    }
    // typo tolerance on the whole word
    const sim = similarity(word, term);
    if (sim >= 0.6) best = Math.max(best, 40 + sim * 30);
    // typo tolerance on a prefix of the word (partial typing)
    const tolerance = term.length <= 4 ? 1 : term.length <= 7 ? 2 : 3;
    const dist = levenshtein(word.slice(0, term.length + tolerance), term);
    if (dist <= tolerance) best = Math.max(best, 65 - dist * 8);
  }
  return best;
}

/**
 * Fuzzy/similar search: tolerates typos, partial words and missing terms.
 * Missing terms reduce the score instead of discarding the product, so
 * "similar" products always show up.
 */
export function fuzzyScore(text: string, query: string): number {
  const hay = normalize(text);
  const terms = normalize(query).split(" ").filter(Boolean);
  if (terms.length === 0) return 1;
  let total = 0;
  let matched = 0;
  for (const t of terms) {
    const s = termScore(hay, t);
    if (s > 0) matched++;
    total += s;
  }
  if (matched === 0) return 0;
  const coverage = matched / terms.length;
  return (total / terms.length) * (0.5 + 0.5 * coverage);
}

/** Threshold above which a result is considered a strong (non-suggestion) match. */
export const STRONG_MATCH = 55;
