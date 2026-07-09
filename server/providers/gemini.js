/**
 * Google Gemini provider — powers the optional "AI Insights" panel.
 *
 * IMPORTANT: Gemini is used for ANALYSIS ONLY (summarizing the portfolio + news
 * the app already fetched from real market-data providers). It is NEVER used as a
 * price source — LLMs hallucinate/lag on live numbers. Defensive: throws only a
 * clean Error the route turns into JSON; never crashes the server.
 */
import { config } from '../config.js';

const KEY = config.keys.gemini;
const MODEL = config.geminiModel || 'gemini-3.5-flash';
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export function hasKey() {
  return !!KEY;
}

const SYSTEM = [
  'You are a thoughtful, neutral financial analyst embedded in a personal',
  "multi-asset portfolio dashboard. You are given the user's holdings (with live",
  'prices, day change, P/L, asset type, and weight), a total value, and recent',
  'news headlines. Produce a DEEP but readable analysis using these markdown',
  'sections with "## " headings, in this order:',
  '## Overview — 2-3 sentences on how the portfolio is doing today and overall.',
  '## Movers — the biggest up/down holdings today with their % and any headline context.',
  '## Allocation & Concentration — comment on the asset-type mix and any holding/sector that dominates (a concentration risk).',
  '## Dividend Income — note the passive income / yield if relevant.',
  '## Risks — 2-4 concrete risks for THIS portfolio (concentration, volatility, FX, single-stock, etc.).',
  '## Suggested Plan — 3-5 specific, actionable but GENERAL ideas to consider (e.g. diversify across sectors/asset types, trim/add to rebalance toward target weights, dollar-cost-average, build a cash buffer, reinvest dividends). Frame as ideas to consider, with brief reasoning.',
  'Rules: be specific to the data given and educational. You MAY suggest general',
  'strategies and rebalancing ideas, but do NOT give individualized financial',
  'advice, specific price targets, or "buy/sell X now" calls. Use the currency',
  'provided. Keep it tight (~300-450 words), use bullet points within sections.',
  'End with one short italic line: *Educational only — not financial advice.*',
].join(' ');

/**
 * When the user states a goal, tailor the whole analysis to it: add a
 * "Goal Fit" section and make the plan serve that objective specifically.
 */
function systemFor(goal) {
  if (!goal) return SYSTEM;
  return [
    SYSTEM,
    '',
    `IMPORTANT — THE USER'S STATED GOAL FOR THIS PORTFOLIO: "${goal}".`,
    'Tailor the ENTIRE analysis to this goal — interpret every section through it,',
    'not as a generic summary. Insert a "## Goal Fit" section right after Overview',
    'that judges, specifically and honestly, how well the current holdings serve',
    'the goal: what already aligns, what gaps or conflicts exist, and how far off',
    'the portfolio is. Then make "## Suggested Plan" a prioritized set of ideas',
    'that move the portfolio toward THIS goal (and rename mentally toward it),',
    'each with one line of reasoning tied back to the goal. If the goal is vague,',
    'risky, or unrealistic given the holdings, say so plainly. Keep all the',
    'guardrails above (general strategies only, no buy/sell-now calls or price',
    'targets). You may extend to ~500 words to cover the goal properly.',
  ].join(' ');
}

/**
 * Generate a short AI insight for a portfolio.
 * @param {{ holdings: Array, news?: Array, displayCurrency?: string, goal?: string }} ctx
 * @returns {Promise<string>} the insight text
 */
export async function generateInsights({ holdings = [], news = [], displayCurrency = 'USD', goal = '' } = {}) {
  if (!KEY) throw new Error('Gemini API key not configured');
  if (!Array.isArray(holdings) || holdings.length === 0) {
    throw new Error('No holdings to analyze');
  }

  const total = holdings.reduce((s, h) => s + (Number(h.marketValue) || 0), 0);
  const pctOf = (v) => (total > 0 ? ((Number(v) || 0) / total) * 100 : 0);

  const lines = holdings.map((h) => {
    const parts = [
      `${h.symbol}${h.name ? ` (${h.name})` : ''}`,
      h.type ? `[${h.type}]` : null,
      h.shares != null ? `${h.shares} units` : null,
      h.price != null ? `price ${h.price}` : null,
      h.changePct != null ? `day ${Number(h.changePct).toFixed(2)}%` : null,
      h.marketValue != null ? `value ${Math.round(h.marketValue)} (${pctOf(h.marketValue).toFixed(1)}% of portfolio)` : null,
      h.plPct != null ? `P/L ${Number(h.plPct).toFixed(1)}%` : null,
    ].filter(Boolean);
    return `- ${parts.join(', ')}`;
  });

  // Allocation by asset type (helps the model assess diversification).
  const byType = {};
  for (const h of holdings) byType[h.type || 'other'] = (byType[h.type || 'other'] || 0) + (Number(h.marketValue) || 0);
  const allocation = Object.entries(byType)
    .sort((a, b) => b[1] - a[1])
    .map(([t, v]) => `${t} ${pctOf(v).toFixed(0)}%`)
    .join(', ');

  const headlines = (news || [])
    .slice(0, 12)
    .map((n) => `- ${n.title}${n.relatedSymbols && n.relatedSymbols.length ? ` [${n.relatedSymbols.join(',')}]` : ''}`);

  const cleanGoal = typeof goal === 'string' ? goal.trim().slice(0, 500) : '';

  const prompt = [
    `Display currency: ${displayCurrency}.`,
    cleanGoal ? `The user's goal for this portfolio: "${cleanGoal}".` : '',
    `Total portfolio value: ${Math.round(total)} ${displayCurrency}.`,
    `Allocation by type: ${allocation || 'n/a'}.`,
    '',
    'Holdings:',
    ...lines,
    headlines.length ? '\nRecent headlines:' : '',
    ...headlines,
  ]
    .filter((s) => s !== undefined && s !== '')
    .join('\n');

  const url = `${BASE}/models/${encodeURIComponent(MODEL)}:generateContent?key=${encodeURIComponent(KEY)}`;
  const body = {
    systemInstruction: { parts: [{ text: systemFor(cleanGoal) }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.5,
      maxOutputTokens: 3072,
      topP: 0.95,
      // Gemini 2.5/3.x "thinking" tokens count against the output budget and were
      // truncating the answer — disable thinking so the full analysis comes through.
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(`Gemini request failed: ${e?.message || e}`);
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    throw new Error(`Gemini error: ${msg}`);
  }

  // Refusal / safety block.
  const cand = data?.candidates?.[0];
  const text = cand?.content?.parts?.map((p) => p.text).filter(Boolean).join('\n').trim();
  if (!text) {
    const reason = cand?.finishReason || data?.promptFeedback?.blockReason || 'no content';
    throw new Error(`Gemini returned no text (${reason})`);
  }
  return text;
}

export default { hasKey, generateInsights };
