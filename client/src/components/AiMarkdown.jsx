import React from 'react';
import { theme } from '../lib/theme.js';

/**
 * Minimal markdown renderer shared by all AI panels (## headings, bullets,
 * numbered lists, **bold** / *italic*, and [text](url) links). Extracted from
 * InsightsPanel so the retirement advisor and trade scout render identically.
 */

/** Render inline **bold** / *italic* / [text](url) within a line. */
export function inline(s, keyBase) {
  const out = [];
  const re = /(\[[^\]]+\]\(https?:\/\/[^)\s]+\)|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let m;
  let i = 0;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('[')) {
      const mm = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(tok);
      if (mm) {
        out.push(
          <a
            key={`${keyBase}-${i}`}
            href={mm[2]}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: theme.colors.accent, textDecoration: 'none', borderBottom: `1px dotted ${theme.colors.accent}` }}
          >
            {mm[1]}
          </a>
        );
      } else {
        out.push(tok);
      }
    } else if (tok.startsWith('**')) {
      out.push(<strong key={`${keyBase}-${i}`}>{tok.slice(2, -2)}</strong>);
    } else {
      out.push(<em key={`${keyBase}-${i}`} style={{ color: theme.colors.textDim }}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
    i += 1;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

/** Block renderer for the AI output. */
export default function AiMarkdown({ text }) {
  const lines = String(text).split('\n');
  const blocks = [];
  let bullets = null; // { ordered: boolean, items: string[] }
  const flush = () => {
    if (bullets) {
      const Tag = bullets.ordered ? 'ol' : 'ul';
      blocks.push(
        <Tag
          key={`l-${blocks.length}`}
          style={{ margin: '2px 0 2px 0', paddingLeft: 18, listStyle: bullets.ordered ? 'decimal' : 'disc' }}
        >
          {bullets.items.map((b, i) => (
            <li key={i} style={{ marginBottom: 3, lineHeight: 1.5 }}>{inline(b, `li-${blocks.length}-${i}`)}</li>
          ))}
        </Tag>
      );
      bullets = null;
    }
  };
  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) {
      flush();
      return;
    }
    const isBullet = /^[-*]\s+/.test(line);
    const isNumbered = /^\d+[.)]\s+/.test(line);
    if (/^#{2,4}\s/.test(line)) {
      flush();
      blocks.push(
        <div
          key={`h-${idx}`}
          style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color: theme.colors.accent, marginTop: blocks.length ? 8 : 0 }}
        >
          {line.replace(/^#{2,4}\s+/, '')}
        </div>
      );
    } else if (isBullet || isNumbered) {
      const item = line.replace(/^([-*]|\d+[.)])\s+/, '');
      const ordered = isNumbered;
      if (bullets && bullets.ordered !== ordered) flush();
      (bullets || (bullets = { ordered, items: [] })).items.push(item);
    } else {
      flush();
      blocks.push(
        <p key={`p-${idx}`} style={{ margin: 0, lineHeight: 1.6 }}>{inline(line, `p-${idx}`)}</p>
      );
    }
  });
  flush();
  return (
    <div style={{ fontSize: 13.5, color: theme.colors.text, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {blocks}
    </div>
  );
}

/** Compact "Sources" chip list for grounded AI answers. */
export function SourceList({ sources }) {
  const list = (sources || []).filter((s) => s && s.url);
  if (list.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: theme.colors.textDim }}>
        Sources ({list.length})
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {list.map((s, i) => (
          <a
            key={i}
            className="chip"
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            title={s.url}
            style={{
              fontSize: 11,
              color: theme.colors.textDim,
              textDecoration: 'none',
              maxWidth: 260,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            🔗 {s.title || s.url}
          </a>
        ))}
      </div>
    </div>
  );
}
