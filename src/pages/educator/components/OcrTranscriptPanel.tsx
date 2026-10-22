import { useState, Fragment } from 'react';
import { ChevronDown, ScanText } from 'lucide-react';
import Spinner from '../../../components/ui/Spinner';
import { api } from '../../../lib/api';

/**
 * What OCR read from a scanned or photographed material, page by page: the text the concepts came
 * from, so a garbled page here explains odd concepts downstream. Fetched on first expand (it's large).
 * `[?]` (UNREADABLE_MARK) stays visible, tinted as a warning.
 */

interface OcrPage {
  page: number;
  text: string;
}

const UNREADABLE_MARK = '[?]';

interface Props {
  materialId: string;
  focusClass: string;
}

/** Renders a page's text with each unreadable mark tinted. */
function TranscriptText({ text }: { text: string }) {
  const parts = text.split(UNREADABLE_MARK);
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part}
          {i < parts.length - 1 && (
            <span className="text-amber-400 font-semibold" title="A word the OCR could not read">
              {UNREADABLE_MARK}
            </span>
          )}
        </Fragment>
      ))}
    </>
  );
}

export default function OcrTranscriptPanel({ materialId, focusClass }: Props) {
  const [open, setOpen] = useState(false);
  const [pages, setPages] = useState<OcrPage[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (!next || pages !== null || loading) return;

    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<{ pages: OcrPage[] }>(`/materials/${materialId}/ocr-text`);
      setPages(data.pages ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The transcript could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  const readable = pages?.filter((p) => p.text.trim().length > 0).length ?? 0;
  const unreadableMarks = pages?.reduce((n, p) => n + p.text.split(UNREADABLE_MARK).length - 1, 0) ?? 0;

  return (
    <section className="rounded-xl bg-white/[0.02] border border-white/5 mb-8">
      <button
        type="button"
        onClick={() => void toggle()}
        aria-expanded={open}
        className={`w-full flex items-center justify-between gap-3 px-5 py-4 text-left rounded-xl ${focusClass}`}
      >
        <span className="flex items-center gap-2.5 min-w-0">
          <ScanText className="w-4 h-4 text-primary-fixed-dim shrink-0" />
          <span className="font-sans text-sm font-semibold text-white">Text read from the pages</span>
          <span className="hidden sm:inline font-sans text-xs text-slate-500 truncate">
            — what the concepts were extracted from
          </span>
        </span>
        <ChevronDown
          className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="px-5 pb-5 border-t border-white/5 animate-swap-in">
          {loading && (
            <p className="flex items-center gap-2 font-sans text-xs text-slate-400 pt-4">
              <Spinner className="w-3.5 h-3.5" /> Loading the transcript…
            </p>
          )}

          {error && (
            <p className="font-sans text-xs text-rose-300 pt-4">{error}</p>
          )}

          {pages && !pages.length && (
            <p className="font-sans text-xs text-slate-400 pt-4">
              No transcript was saved for this material.
            </p>
          )}

          {pages && pages.length > 0 && (
            <>
              <p className="font-sans text-[11px] text-slate-500 leading-relaxed pt-4 mb-4">
                {readable} of {pages.length} {pages.length === 1 ? 'page' : 'pages'} had readable text.
                {unreadableMarks > 0 && (
                  <>
                    {' '}<span className="text-amber-400 font-semibold">{UNREADABLE_MARK}</span> marks a word
                    that could not be read ({unreadableMarks} in total) — if a page has many, retake that photo
                    flat, in focus and in good light, and upload the lesson again.
                  </>
                )}
              </p>
              <div className="space-y-4 max-h-[28rem] overflow-y-auto pr-1">
                {pages.map((p) => (
                  <article key={p.page}>
                    <h3 className="font-sans text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                      Page {p.page}
                    </h3>
                    {p.text.trim() ? (
                      <pre className="font-sans text-xs text-slate-300 leading-relaxed whitespace-pre-wrap break-words">
                        <TranscriptText text={p.text} />
                      </pre>
                    ) : (
                      <p className="font-sans text-xs italic text-slate-500">No readable text on this page.</p>
                    )}
                  </article>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
