// Lightweight fuzzy file-path scorer.
// Higher scores rank earlier. 0 means "no match".

/** Upper bound for basename-substring scores; used to normalize into 0–1 elsewhere. */
export const FUZZY_SCORE_MAX = 1000;

const BASENAME_PREFIX_BONUS = 50;
const BASENAME_EXACT_MATCH_BONUS = 200;
const PATH_SUBSTRING_SCORE_BASE = 500;
const BASENAME_SUBSEQ_SCORE_BASE = 200;
const PATH_SUBSEQ_SCORE_BASE = 50;

export type Scored = { path: string; score: number };

export function fuzzyScore(query: string, target: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  // Exact substring of basename ranks highest.
  const slash = t.lastIndexOf("/");
  const base = slash >= 0 ? t.slice(slash + 1) : t;
  const baseIdx = base.indexOf(q);
  if (baseIdx >= 0) {
    // Earlier match in basename = higher. Treat a leading dot (hidden file)
    // as if the basename started at the dot — `.env` should beat `environment.ts`.
    const effectiveIdx = baseIdx === 1 && base.startsWith(".") ? 0 : baseIdx;
    let score =
      FUZZY_SCORE_MAX - effectiveIdx + (effectiveIdx === 0 ? BASENAME_PREFIX_BONUS : 0);
    // Whole-basename match bumps the score above any longer file with an early match.
    if (q.length === base.length || (baseIdx === 1 && q.length + 1 === base.length)) {
      score += BASENAME_EXACT_MATCH_BONUS;
    }
    return score;
  }

  // Substring anywhere in path.
  const pathIdx = t.indexOf(q);
  if (pathIdx >= 0) return PATH_SUBSTRING_SCORE_BASE - pathIdx;

  // Subsequence match in basename, then in full path.
  const baseSub = subseq(q, base);
  if (baseSub > 0) return BASENAME_SUBSEQ_SCORE_BASE + baseSub;
  const pathSub = subseq(q, t);
  if (pathSub > 0) return PATH_SUBSEQ_SCORE_BASE + pathSub;

  return 0;
}

// Returns 0 if not a subsequence; otherwise a score that prefers tighter clusters.
function subseq(q: string, t: string): number {
  let qi = 0;
  let lastIdx = -1;
  let score = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t.charCodeAt(ti) === q.charCodeAt(qi)) {
      const gap = lastIdx < 0 ? 0 : ti - lastIdx - 1;
      score += Math.max(1, 10 - gap);
      lastIdx = ti;
      qi++;
    }
  }
  return qi === q.length ? score : 0;
}

export function rankFiles(query: string, files: string[], limit = 200): Scored[] {
  if (!query) return files.slice(0, limit).map((p) => ({ path: p, score: 1 }));
  const out: Scored[] = [];
  for (const p of files) {
    const s = fuzzyScore(query, p);
    if (s > 0) out.push({ path: p, score: s });
  }
  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.path.length - b.path.length;
  });
  if (out.length > limit) out.length = limit;
  return out;
}
