// Lightweight finance-tuned sentiment scorer — pure, dependency-free, shared by
// the client (news-mood display) and the server (historical daily aggregation
// for the Forecast lab's news feature). Not a deep NLP model: a Loughran–
// McDonald-inspired polarity lexicon with simple negation + intensifier
// handling, which is a reasonable, transparent baseline for headline tone.
//
// scoreText -> a bounded polarity in [-1, 1] (0 = neutral / no signal).

// Positive / negative finance terms (lowercase stems matched on word boundaries).
const POSITIVE = [
  'beat', 'beats', 'beaten', 'surge', 'surges', 'surged', 'soar', 'soars', 'soared',
  'rally', 'rallies', 'rallied', 'gain', 'gains', 'gained', 'jump', 'jumps', 'jumped',
  'rise', 'rises', 'rose', 'climb', 'climbs', 'climbed', 'upgrade', 'upgraded', 'upgrades',
  'outperform', 'outperforms', 'outperformed', 'record', 'records', 'strong', 'stronger',
  'strength', 'robust', 'growth', 'grow', 'grows', 'grew', 'profit', 'profits', 'profitable',
  'bullish', 'boom', 'booming', 'raise', 'raised', 'raises', 'exceed', 'exceeds', 'exceeded',
  'momentum', 'breakthrough', 'expansion', 'expand', 'expands', 'expanding', 'optimistic',
  'optimism', 'upbeat', 'winning', 'wins', 'won', 'boost', 'boosts', 'boosted', 'top', 'tops',
  'topped', 'buy', 'accumulate', 'undervalued', 'dividend', 'buyback', 'buybacks',
  'approval', 'approved', 'partnership', 'expands', 'milestone', 'high', 'highs', 'rebound',
  'rebounds', 'rebounded', 'recovery', 'recover', 'recovers', 'upside', 'positive', 'gains',
];
const NEGATIVE = [
  'miss', 'misses', 'missed', 'plunge', 'plunges', 'plunged', 'plummet', 'plummets', 'plummeted',
  'slump', 'slumps', 'slumped', 'drop', 'drops', 'dropped', 'fall', 'falls', 'fell', 'sink',
  'sinks', 'sank', 'tumble', 'tumbles', 'tumbled', 'slide', 'slides', 'slid', 'downgrade',
  'downgraded', 'downgrades', 'underperform', 'underperforms', 'weak', 'weaker', 'weakness',
  'loss', 'losses', 'lose', 'loses', 'lost', 'bearish', 'crash', 'crashes', 'crashed', 'cut',
  'cuts', 'slash', 'slashes', 'slashed', 'lawsuit', 'lawsuits', 'probe', 'probes', 'investigation',
  'recall', 'recalls', 'bankruptcy', 'bankrupt', 'default', 'defaults', 'decline', 'declines',
  'declined', 'warn', 'warns', 'warning', 'halt', 'halts', 'halted', 'fraud', 'selloff',
  'sell-off', 'layoff', 'layoffs', 'fear', 'fears', 'concern', 'concerns', 'risk', 'risks',
  'downturn', 'recession', 'slowdown', 'sluggish', 'disappoint', 'disappoints', 'disappointing',
  'delay', 'delays', 'delayed', 'sue', 'sued', 'sues', 'penalty', 'fine', 'fined', 'scandal',
  'crisis', 'volatile', 'volatility', 'low', 'lows', 'downside', 'negative', 'shortfall', 'glut',
];

const NEGATORS = new Set(['not', 'no', 'never', "n't", 'without', 'less', 'lack', 'lacks']);
const INTENSIFIERS = new Set(['very', 'sharply', 'significantly', 'massively', 'strongly', 'deeply', 'huge', 'major']);

const POS = new Set(POSITIVE);
const NEG = new Set(NEGATIVE);

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9฀-๿'’-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Score a piece of text (headline + optional summary). Returns polarity in
 * [-1, 1]: (#pos − #neg) / (#pos + #neg), with each hit's sign flipped by a
 * preceding negator and its weight raised by a preceding intensifier.
 * @param {string} text
 * @returns {number}
 */
export function scoreText(text) {
  const toks = tokenize(text);
  let pos = 0;
  let neg = 0;
  for (let i = 0; i < toks.length; i += 1) {
    const w = toks[i];
    const isPos = POS.has(w);
    const isNeg = NEG.has(w);
    if (!isPos && !isNeg) continue;
    // Look back up to 2 tokens for a negator / intensifier.
    let negated = false;
    let weight = 1;
    for (let j = Math.max(0, i - 2); j < i; j += 1) {
      if (NEGATORS.has(toks[j])) negated = true;
      if (INTENSIFIERS.has(toks[j])) weight = 1.5;
    }
    let sign = isPos ? 1 : -1;
    if (negated) sign = -sign;
    if (sign > 0) pos += weight;
    else neg += weight;
  }
  const total = pos + neg;
  if (total === 0) return 0;
  return (pos - neg) / total;
}

/**
 * Aggregate a list of articles into a single mood score + counts.
 * @param {{title?:string, headline?:string, summary?:string}[]} articles
 * @returns {{ score:number, count:number, positive:number, negative:number }}
 *   score is the mean polarity of articles that carried any signal.
 */
export function scoreArticles(articles = []) {
  let sum = 0;
  let signal = 0;
  let positive = 0;
  let negative = 0;
  for (const a of articles || []) {
    const s = scoreText(`${a.title || a.headline || ''}. ${a.summary || ''}`);
    if (s > 0) positive += 1;
    else if (s < 0) negative += 1;
    if (s !== 0) {
      sum += s;
      signal += 1;
    }
  }
  return {
    score: signal ? sum / signal : 0,
    count: (articles || []).length,
    positive,
    negative,
  };
}

/** Word label for a polarity value. */
export function moodLabel(score) {
  if (score >= 0.33) return 'Positive';
  if (score >= 0.1) return 'Slightly positive';
  if (score > -0.1) return 'Neutral';
  if (score > -0.33) return 'Slightly negative';
  return 'Negative';
}

export default { scoreText, scoreArticles, moodLabel };
