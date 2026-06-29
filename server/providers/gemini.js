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
  'You are a concise, neutral financial assistant embedded in a personal',
  'multi-asset portfolio dashboard. You are given the user\'s holdings with live',
  'prices and (optionally) recent news headlines. Summarize how the portfolio is',
  'doing today, call out the biggest movers (up and down) with their % change,',
  'and add brief relevant context from the headlines when useful.',
  'Rules: be factual and educational; do NOT give buy/sell/hold recommendations,',
  'price targets, or personalized advice. No preamble. Keep it under ~180 words,',
  'using short paragraphs or bullet points. Use the currency provided.',
].join(' ');

/**
 * Generate a short AI insight for a portfolio.
 * @param {{ holdings: Array, news?: Array, displayCurrency?: string }} ctx
 * @returns {Promise<string>} the insight text
 */
export async function generateInsights({ holdings = [], news = [], displayCurrency = 'USD' } = {}) {
  if (!KEY) throw new Error('Gemini API key not configured');
  if (!Array.isArray(holdings) || holdings.length === 0) {
    throw new Error('No holdings to analyze');
  }

  const lines = holdings.map((h) => {
    const parts = [
      `${h.symbol}${h.name ? ` (${h.name})` : ''}`,
      h.shares != null ? `${h.shares} sh` : null,
      h.price != null ? `price ${h.price}` : null,
      h.changePct != null ? `day ${Number(h.changePct).toFixed(2)}%` : null,
      h.marketValue != null ? `mv ${Math.round(h.marketValue)}` : null,
      h.plPct != null ? `P/L ${Number(h.plPct).toFixed(1)}%` : null,
    ].filter(Boolean);
    return `- ${parts.join(', ')}`;
  });

  const headlines = (news || [])
    .slice(0, 10)
    .map((n) => `- ${n.title}${n.relatedSymbols && n.relatedSymbols.length ? ` [${n.relatedSymbols.join(',')}]` : ''}`);

  const prompt = [
    `Display currency: ${displayCurrency}.`,
    '',
    'Holdings:',
    ...lines,
    headlines.length ? '\nRecent headlines:' : '',
    ...headlines,
  ]
    .filter((s) => s !== undefined)
    .join('\n');

  const url = `${BASE}/models/${encodeURIComponent(MODEL)}:generateContent?key=${encodeURIComponent(KEY)}`;
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 700, topP: 0.95 },
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
