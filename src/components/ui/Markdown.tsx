import React from 'react';

/**
 * Lightweight Markdown renderer for AI chat responses.
 *
 * The Study Assistant is prompted to format replies with markdown (bold, lists,
 * headings, etc.), but the chat bubble previously printed the raw string — so
 * users saw literal `**`, `##`, `-` characters. This component parses the small
 * subset the model actually produces and renders it as styled elements.
 *
 * Supported: **bold**, *italic* / _italic_, `inline code`, # headings,
 * - / * bullet lists, 1. numbered lists, and paragraphs. Anything else is passed
 * through as plain text. It is intentionally minimal (no external dependency) and
 * safe for streaming — it is a pure function of the current content string.
 */

// ── Inline parsing (bold / italic / code) ─────────────────────────────────────
interface InlineRule {
  open: string;
  close: string;
  render: (inner: string, key: string) => React.ReactNode;
}

const INLINE_RULES: InlineRule[] = [
  // Code is literal — its contents are never re-parsed. Listed first so it wins ties.
  { open: '`', close: '`', render: (inner, key) => (
    <code key={key} className="font-mono text-[0.85em] bg-black/25 border border-white/10 rounded px-1 py-0.5 text-slate-100">{inner}</code>
  ) },
  { open: '**', close: '**', render: (inner, key) => (
    <strong key={key} className="font-semibold text-white">{parseInline(inner, key)}</strong>
  ) },
  { open: '__', close: '__', render: (inner, key) => (
    <strong key={key} className="font-semibold text-white">{parseInline(inner, key)}</strong>
  ) },
  { open: '*', close: '*', render: (inner, key) => (
    <em key={key} className="italic">{parseInline(inner, key)}</em>
  ) },
  { open: '_', close: '_', render: (inner, key) => (
    <em key={key} className="italic">{parseInline(inner, key)}</em>
  ) },
];

function parseInline(text: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let rest = text;
  let i = 0;

  while (rest.length > 0) {
    // Find the earliest-opening rule that has a matching, non-empty closer.
    let best: { openIdx: number; closeIdx: number; rule: InlineRule } | null = null;

    for (const rule of INLINE_RULES) {
      const openIdx = rest.indexOf(rule.open);
      if (openIdx === -1) continue;
      const closeIdx = rest.indexOf(rule.close, openIdx + rule.open.length);
      if (closeIdx === -1 || closeIdx === openIdx + rule.open.length) continue; // no closer / empty
      if (best === null || openIdx < best.openIdx) best = { openIdx, closeIdx, rule };
    }

    if (best === null) {
      out.push(rest);
      break;
    }

    if (best.openIdx > 0) out.push(rest.slice(0, best.openIdx));
    const inner = rest.slice(best.openIdx + best.rule.open.length, best.closeIdx);
    out.push(best.rule.render(inner, `${keyPrefix}-${i}`));
    rest = rest.slice(best.closeIdx + best.rule.close.length);
    i++;
  }

  return out;
}

// ── Block parsing (headings / lists / paragraphs) ─────────────────────────────
function headingClass(level: number): string {
  if (level <= 1) return 'text-lg font-bold text-white mt-1';
  if (level === 2) return 'text-base font-bold text-white mt-1';
  return 'text-[15px] font-semibold text-white';
}

function renderBlocks(content: string): React.ReactNode[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let key = 0;

  const flushPara = () => {
    if (para.length === 0) return;
    const text = para.join('\n');
    blocks.push(
      <p key={`p${key++}`} className="text-[15px] leading-relaxed whitespace-pre-wrap">
        {parseInline(text, `p${key}`)}
      </p>
    );
    para = [];
  };

  const flushList = () => {
    if (!list) return;
    const items = list.items.map((it, idx) => (
      <li key={idx} className="leading-relaxed">{parseInline(it, `li${key}-${idx}`)}</li>
    ));
    blocks.push(
      list.ordered
        ? <ol key={`l${key++}`} className="list-decimal pl-5 space-y-1 text-[15px]">{items}</ol>
        : <ul key={`l${key++}`} className="list-disc pl-5 space-y-1 text-[15px]">{items}</ul>
    );
    list = null;
  };

  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);

    if (heading) {
      flushPara();
      flushList();
      const level = heading[1].length;
      blocks.push(
        <p key={`h${key++}`} className={headingClass(level)}>{parseInline(heading[2], `h${key}`)}</p>
      );
    } else if (ul) {
      flushPara();
      if (list && !list.ordered) list.items.push(ul[1]);
      else { flushList(); list = { ordered: false, items: [ul[1]] }; }
    } else if (ol) {
      flushPara();
      if (list && list.ordered) list.items.push(ol[1]);
      else { flushList(); list = { ordered: true, items: [ol[1]] }; }
    } else if (line.trim() === '') {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  }

  flushPara();
  flushList();
  return blocks;
}

export default function Markdown({ content }: { content: string }) {
  return <div className="font-sans space-y-2.5 break-words">{renderBlocks(content)}</div>;
}
