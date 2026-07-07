// Prompt builders for the two deep-research analyses. Kept out of the route so
// the route stays thin and the wording is reviewable in one place.
//
// Ground rules baked into both prompts:
//   - App data (portfolio, plan numbers, indicator snapshot) is authoritative —
//     the model must NOT invent or "remember" prices.
//   - Market/macro facts must come from live Google Search grounding, with
//     dates, and get re-verified by the critique rounds in geminiDeep.js.

const f0 = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)).toLocaleString('en-US') : '—');
const f2 = (v) => (Number.isFinite(Number(v)) ? (Math.round(Number(v) * 100) / 100).toString() : '—');

function holdingsBlock(holdings = []) {
  const total = holdings.reduce((s, h) => s + (Number(h.marketValue) || 0), 0);
  const lines = holdings.map((h) => {
    const w = total > 0 ? (((Number(h.marketValue) || 0) / total) * 100).toFixed(1) : '0';
    return `- ${h.symbol}${h.name ? ` (${h.name})` : ''} [${h.type || 'other'}]: value ${f0(h.marketValue)} (${w}%)${h.plPct != null ? `, P/L ${f2(h.plPct)}%` : ''}`;
  });
  return { total, lines };
}

function macroBlock(macro = []) {
  const label = {
    '^GSPC': 'S&P 500',
    '^IXIC': 'Nasdaq Composite',
    '^SET.BK': 'SET Index (Thailand)',
    'THB=X': 'USD/THB',
    '^TNX': 'US 10Y yield (x10)',
    'GC=F': 'Gold futures',
    'BTC-USD': 'Bitcoin',
  };
  return (macro || [])
    .filter((q) => q && Number.isFinite(Number(q.price)))
    .map((q) => `- ${label[q.symbol] || q.symbol}: ${f2(q.price)} (${q.changePct >= 0 ? '+' : ''}${f2(q.changePct)}% today)`);
}

// ── Retirement path advisor ─────────────────────────────────────────────────

export const RETIREMENT_SYSTEM = [
  'You are an independent, conservative financial planner advising a retail investor',
  'in THAILAND who invests in both the Thai market (SET, Thai mutual funds/RMF/Thai ESG)',
  'and the US market (stocks/ETFs). You have Google Search — USE IT EXTENSIVELY to pull',
  'CURRENT market and macro conditions before advising: Fed policy and rate path, US',
  'inflation and valuations, US sector trends; Bank of Thailand policy rate, Thai',
  'inflation/GDP and SET valuation and fund flows; USD/THB trend; global risks. Every',
  'market claim needs a timeframe (e.g. "as of this week") — never rely on memory for',
  'current numbers. The user\'s portfolio and plan numbers provided in the message are',
  'authoritative; do not re-derive or question them.',
  'Produce the answer in EXACTLY these markdown sections with "## " headings:',
  '## Snapshot — 3-4 sentences: where they stand today vs their freedom number, in plain words.',
  '## Market & Macro Now — current TH + US conditions that matter for a long-horizon saver (dated bullets).',
  '## Recommended Path — the core. A concrete target allocation NOW (percent per bucket: Thai equity,',
  'US/global equity, bonds/fixed income, gold, cash) sized to their age and gap; a glide path (how the mix',
  'shifts each 5-10 years toward retirement); and a monthly plan (how to split their monthly investment,',
  'DCA cadence). Balance risk and reward — justify each weight in one line.',
  '## Thai Tax Wrappers — in what ORDER to fill RMF / Thai ESG / PVD and why (current-year deduction caps),',
  'plus the practical tax notes for US holdings (15% dividend withholding; Thai remittance rules).',
  '## Scenarios — conservative / base / aggressive: expected return range, rough nest egg vs their freedom',
  'number, and the lever to pull if they fall behind (save more / retire later / spend less — quantify).',
  '## Risk Balance — the 4-6 biggest risks for THIS plan (FX for a THB spender holding USD assets,',
  'concentration, sequence-of-returns near retirement, inflation, behavior) each with a specific mitigation.',
  '## Action Checklist — numbered, concrete: do this month, this year, every year.',
  'Rules: educational scenario planning, not individualized advice; use ranges not point predictions;',
  'state assumptions; use the display currency given. Be specific and quantified throughout.',
  'End with one italic line: *Educational scenario analysis — not financial advice. Markets can fall; plans need annual review.*',
].join(' ');

/**
 * @param {{ plan: object, projection: object, holdings: Array, macro: Array, displayCurrency: string }} p
 */
export function buildRetirementTask({ plan = {}, projection = {}, holdings = [], macro = [], displayCurrency = 'THB' } = {}) {
  const { total, lines } = holdingsBlock(holdings);
  const macroLines = macroBlock(macro);

  // Optional refinements — only mention what the user actually set.
  const refinements = [];
  if (Number(plan.contributionGrowth) > 0) refinements.push(`contributions grow ${f2(plan.contributionGrowth)}%/yr (raises)`);
  if (Number(plan.retireSpendPct) > 0 && Number(plan.retireSpendPct) !== 100) refinements.push(`retired lifestyle costs ${f0(plan.retireSpendPct)}% of today's spending`);
  if (Number(plan.pensionStartAge) > 0) refinements.push(`pension starts at age ${f0(plan.pensionStartAge)}`);
  if (Number(plan.lumpSum) > 0) refinements.push(`one-time lump sum of ${f0(plan.lumpSum)} ${displayCurrency}${Number(plan.lumpSumAge) > 0 ? ` at age ${f0(plan.lumpSumAge)}` : ''}`);
  if (Number(plan.careBumpPct) > 0) refinements.push(`late-life care: spending +${f2(plan.careBumpPct)}% from age ${f0(plan.careFromAge || 75)}`);

  return [
    `Today: ${new Date().toISOString().slice(0, 10)}. Display currency: ${displayCurrency}.`,
    '',
    'THE INVESTOR PLAN (user inputs):',
    `- Age ${f0(plan.currentAge)}, retiring at ${f0(plan.retireAge)}, planning to age ${f0(plan.endAge)}.`,
    `- Investing ${f0(plan.monthly)} ${displayCurrency}/month. Spending today ${f0(plan.expense)} ${displayCurrency}/month${Number(plan.pension) > 0 ? `; expected pension ${f0(plan.pension)}/month` : ''}.`,
    `- Assumptions: ${f2(plan.preReturn)}%/yr before retirement, ${f2(plan.postReturn)}%/yr after, inflation ${f2(plan.inflation)}%/yr, withdrawal rate ${f2(plan.swr)}%, investment tax drag ${f2(plan.invTax)}%.`,
    ...(refinements.length ? [`- Refinements: ${refinements.join('; ')}.`] : []),
    '',
    'PROJECTION (computed by the app from those inputs):',
    `- Projected nest egg at ${f0(plan.retireAge)}: ${f0(projection.nestEggAtRetirement)} ${displayCurrency} (≈ ${f0(projection.realNestEgg)} in today's money).`,
    `- Freedom number (to fund ${f0(projection.monthlyExpenseAtRetirement)}/month at retirement): ${f0(projection.freedomNumber)} ${displayCurrency}.`,
    `- Gap: ${projection.freedomGap > 0 ? `${f0(projection.freedomGap)} SHORT` : `${f0(-projection.freedomGap)} surplus`}.`,
    projection.depletionAge ? `- WARNING: money projected to run out at age ${f0(projection.depletionAge)} (before plan-to age).` : '- Money projected to last through the plan.',
    '',
    `CURRENT PORTFOLIO (total ≈ ${f0(total)} ${displayCurrency}):`,
    ...(lines.length ? lines : ['- (no holdings tracked yet)']),
    '',
    ...(macroLines.length ? ['LIVE MARKET SNAPSHOT (from the app, just now):', ...macroLines, ''] : []),
    'TASK: Do deep research on current market trends and macro conditions in BOTH Thailand and the US,',
    'then design the path this investor should take — an allocation and set of actions that balances risk',
    'and reward and gets them to a comfortable retirement. Follow the required section format exactly.',
  ].join('\n');
}

// ── Short-term trade scout ──────────────────────────────────────────────────

export const TRADE_SYSTEM = [
  'You are a tactical markets analyst producing a SHORT-TERM (days to a few weeks) research dossier',
  'on ONE symbol for an experienced retail trader. You have Google Search — USE IT HARD: the latest',
  'news and catalysts for the company and its sector (with dates and publisher names), the next earnings',
  'date, recent analyst actions, peer/sector momentum, and macro events landing in the next 1-2 weeks',
  '(Fed/CPI/jobs for US names; Bank of Thailand, SET fund flows and THB for .BK names). Distinguish',
  'confirmed facts from rumor. The indicator snapshot and prices provided in the message are authoritative',
  '— derive levels from THEM, never from memory.',
  'Produce EXACTLY these markdown sections with "## " headings:',
  '## Verdict — Direction: Bullish / Bearish / Neutral-wait · Conviction: Low/Medium/High · Horizon: X days-weeks, then a 1-2 sentence thesis.',
  '## Catalysts & News — dated bullets, each ending with the source name in parentheses; flag (confirmed) vs (unconfirmed/rumor).',
  '## Technical Read — trend, momentum and volume from the provided snapshot; name the key support/resistance levels it implies.',
  '## Trade Scenario — a HYPOTHETICAL plan: entry zone, invalidation/stop level, first and stretch target, approximate risk:reward,',
  'and a sizing note (risk only a small, defined % of capital). Derive all levels from the provided price data.',
  '## What Could Go Wrong — the bear case (or bull case if bearish), event risk, and for .BK names liquidity/FX notes.',
  '## Watch Next — the specific dates, data releases and headlines to monitor in the coming days.',
  'Rules: this is educational scenario analysis for a self-directed trader, NOT a recommendation; use',
  'conditional language ("if X holds, then Y"); short-term outcomes are highly uncertain — say so where true.',
  'Quantify everything you can. End with one italic line:',
  '*Educational scenario, not financial advice — short-term trading carries a high risk of loss.*',
].join(' ');

/**
 * @param {{ symbol: string, quote: object|null, snapshotLines: string[], news: Array, displayCurrency?: string }} p
 */
export function buildTradeTask({ symbol, quote = null, snapshotLines = [], news = [] } = {}) {
  const newsLines = (news || [])
    .slice(0, 12)
    .map((n) => {
      const when = n.publishedAt ? String(n.publishedAt).slice(0, 10) : '';
      return `- ${when} ${n.title}${n.source ? ` (${n.source})` : ''}`;
    });
  return [
    `Today: ${new Date().toISOString().slice(0, 10)}.`,
    `SYMBOL: ${symbol}${quote && quote.name ? ` — ${quote.name}` : ''}${quote && quote.currency ? ` (prices in ${quote.currency})` : ''}`,
    quote && Number.isFinite(Number(quote.price))
      ? `LIVE QUOTE: ${quote.price} (${quote.changePct >= 0 ? '+' : ''}${f2(quote.changePct)}% today)`
      : '',
    '',
    ...(snapshotLines.length ? ['TECHNICAL SNAPSHOT (computed from daily candles by the app):', ...snapshotLines, ''] : []),
    ...(newsLines.length ? ['RECENT HEADLINES (from the app\'s news feed):', ...newsLines, ''] : []),
    `TASK: Research this name as deeply as you can RIGHT NOW (fresh news, catalysts, sector reads, upcoming`,
    `events), decide whether there is a credible short-term opportunity in the next days-to-weeks, and write`,
    `the dossier in the required format. If the honest answer is "no edge right now", say Neutral-wait and`,
    `explain what would change that.`,
  ]
    .filter((s) => s !== '')
    .join('\n');
}

export default { RETIREMENT_SYSTEM, buildRetirementTask, TRADE_SYSTEM, buildTradeTask };
