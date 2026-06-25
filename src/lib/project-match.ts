// Robust project-name matching for voice control. Substring/subsequence fuzzy
// alone is brittle against the two things speech-to-text does: homophones
// ("tales" vs "tails") and word-splitting ("OwlTales" → "owl tales"). We combine
// three signals and take the best:
//   1. fuzzyScore        — substring/subsequence (great for partial names)
//   2. Levenshtein       — on space/punct-stripped strings (spacing + spelling)
//   3. double-metaphone  — phonetic equality (homophones)
// and expose a confidence flag so the caller can disambiguate instead of guessing.

import { doubleMetaphone } from "double-metaphone";
import { fuzzyScore } from "./file-fuzzy";

export type ScoredMatch<T> = { item: T; score: number };
export type MatchResult<T> = {
  best: ScoredMatch<T> | null;
  candidates: ScoredMatch<T>[];
  /** True when `best` clearly wins — safe to act without asking. */
  confident: boolean;
};

const CONFIDENT_SCORE = 0.82;
const CONFIDENT_MARGIN = 0.12;
const MIN_CANDIDATE_SCORE = 0.45;
const PHONETIC_SCORE = 0.88;

function squash(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function lettersOnly(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, "");
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

function levSim(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  return max === 0 ? 0 : 1 - levenshtein(a, b) / max;
}

function phoneticEqual(a: string, b: string): boolean {
  const la = lettersOnly(a);
  const lb = lettersOnly(b);
  if (!la || !lb) return false;
  const [ap, as_] = doubleMetaphone(la);
  const [bp, bs] = doubleMetaphone(lb);
  return ap === bp || ap === bs || as_ === bp;
}

function scoreOne(query: string, name: string): number {
  const fuzzy = Math.min(1, fuzzyScore(query, name) / 1000);
  const lev = levSim(squash(query), squash(name));
  const phon = phoneticEqual(query, name) ? PHONETIC_SCORE : 0;
  return Math.max(fuzzy, lev, phon);
}

export function matchProjects<T>(
  query: string,
  items: T[],
  keyFn: (item: T) => string,
): MatchResult<T> {
  const q = query.trim();
  if (!q || items.length === 0) return { best: null, candidates: [], confident: false };

  const scored = items
    .map((item) => ({ item, score: scoreOne(q, keyFn(item)) }))
    .filter((s) => s.score >= MIN_CANDIDATE_SCORE)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return keyFn(a.item).length - keyFn(b.item).length;
    });

  const best = scored[0] ?? null;
  const second = scored[1];
  const confident =
    !!best &&
    best.score >= CONFIDENT_SCORE &&
    (!second || best.score - second.score >= CONFIDENT_MARGIN);

  return { best, candidates: scored.slice(0, 4), confident };
}
