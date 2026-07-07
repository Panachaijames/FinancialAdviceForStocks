/**
 * Gemini "deep research" engine — multi-round, web-grounded analysis.
 *
 * Unlike the one-shot gemini.js insights call, this runs an iterative loop with
 * Google Search grounding enabled: research draft -> self-critique (find gaps,
 * verify claims with fresh searches) -> refined final answer. Each round is one
 * grounded generateContent call in a growing multi-turn conversation, so later
 * rounds see (and improve on) earlier work.
 *
 * Why rounds are single digits, not thousands: every round is a full LLM call
 * with live web search (seconds of latency + real API quota). Quality saturates
 * after a few critique passes — depth comes from grounding + critique, not raw
 * repetition. Rounds come from GEMINI_DEEP_ROUNDS (default 3, clamped 1-10).
 *
 * Like gemini.js: ANALYSIS ONLY — never a price source. Throws clean Errors.
 */
import { config } from '../config.js';

const KEY = config.keys.gemini;
const MODEL = config.geminiModel || 'gemini-3.5-flash';
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export function hasKey() {
  return !!KEY;
}

const clampRounds = (v, dflt) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(10, Math.max(1, n));
};

export const DEEP_ROUNDS = clampRounds(process.env.GEMINI_DEEP_ROUNDS, 3);

async function callGemini({ system, contents }) {
  const url = `${BASE}/models/${encodeURIComponent(MODEL)}:generateContent?key=${encodeURIComponent(KEY)}`;
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    // Google Search grounding — the model decides when to search; results come
    // back with groundingMetadata we surface as clickable sources.
    tools: [{ google_search: {} }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 8192,
      topP: 0.95,
      // Thinking tokens count against the output budget on 2.5/3.x and can
      // truncate long answers — the multi-round critique loop is our "thinking".
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
  const cand = data?.candidates?.[0];
  const text = cand?.content?.parts?.map((p) => p.text).filter(Boolean).join('\n').trim();
  if (!text) {
    const reason = cand?.finishReason || data?.promptFeedback?.blockReason || 'no content';
    throw new Error(`Gemini returned no text (${reason})`);
  }

  // Grounded citations: candidates[0].groundingMetadata.groundingChunks[].web
  const sources = [];
  const chunks = cand?.groundingMetadata?.groundingChunks || [];
  for (const c of chunks) {
    const web = c && c.web;
    if (web && web.uri) sources.push({ title: web.title || web.uri, url: web.uri });
  }
  return { text, sources };
}

/**
 * Run the multi-round grounded research loop.
 * @param {{ system: string, task: string, rounds?: number }} p
 *   system — role + output-format instructions (constant across rounds)
 *   task   — the research question with all app-supplied data inlined
 * @returns {Promise<{ text: string, sources: {title:string,url:string}[], rounds: number }>}
 */
export async function deepResearch({ system, task, rounds = DEEP_ROUNDS } = {}) {
  if (!KEY) throw new Error('Gemini API key not configured');
  const total = clampRounds(rounds, DEEP_ROUNDS);

  const contents = [{ role: 'user', parts: [{ text: task }] }];
  const seen = new Set();
  const sources = [];
  let text = '';

  for (let round = 1; round <= total; round += 1) {
    const out = await callGemini({ system, contents });
    text = out.text;
    for (const s of out.sources) {
      // Dedupe by URL so repeated grounding hits don't pile up.
      if (seen.has(s.url)) continue;
      seen.add(s.url);
      sources.push(s);
    }
    if (round === total) break;

    contents.push({ role: 'model', parts: [{ text: out.text }] });
    const lastRound = round + 1 === total;
    contents.push({
      role: 'user',
      parts: [
        {
          text: [
            `Critique round ${round + 1}/${total}. Re-read your analysis above as a skeptical senior analyst:`,
            '1) Which claims are stale, unverified, or missing a source? Run fresh searches to verify or correct them.',
            '2) What did you NOT consider (contrary evidence, upcoming events, macro shifts, risks on the other side of the trade/plan)? Search for it.',
            '3) Where were you vague? Make it specific and quantified.',
            lastRound
              ? 'Then output the FINAL, complete, improved answer in the EXACT required format — standalone (do not reference earlier drafts), incorporating everything verified.'
              : 'Then output the complete improved answer in the EXACT required format — standalone (do not reference earlier drafts).',
          ].join('\n'),
        },
      ],
    });
  }

  return { text, sources, rounds: total };
}

export default { hasKey, deepResearch, DEEP_ROUNDS };
