import { useEffect, useRef, useState, useCallback } from 'react';
import {
  FileText, AlertCircle, ExternalLink, RefreshCw,
  ChevronUp, ChevronDown, ZoomIn, ZoomOut
} from 'lucide-react';
import Spinner from '../../components/ui/Spinner';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// pdf.js runs parsing/rendering off the main thread via a web worker.
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const ZOOM_STEP = 0.2;
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 3;

interface PdfViewerProps {
  /** Signed URL of the PDF to display. Null when no material is active. */
  url: string | null;
  /** Title of the active material (shown in the viewer header). */
  title?: string;
  /** True while the signed URL is being fetched. */
  loading?: boolean;
  /** Error message if the URL could not be fetched. */
  error?: string | null;
  /** Retry handler for the error state. */
  onRetry?: () => void;
}

/** Renders a single PDF page onto a canvas at the given scale (crisp on HiDPI). */
function PdfPage({ page, scale }: { page: PDFPageProxy; scale: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const outputScale = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale });
    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;

    const renderTask = page.render({
      canvas,
      canvasContext: ctx,
      viewport,
      transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
    });
    renderTask.promise.catch(() => {
      /* render cancelled on rescale/unmount — safe to ignore */
    });

    return () => renderTask.cancel();
  }, [page, scale]);

  return <canvas ref={canvasRef} className="block bg-white rounded-sm shadow-lg max-w-full" />;
}

/**
 * In-app PDF reader. Fetches the document with pdf.js and renders each page to a
 * canvas styled to match the app, with its own toolbar (page navigation + zoom) —
 * so viewing feels native to LearnSyncAI rather than the browser's built-in PDF UI.
 */
export default function PdfViewer({ url, title, loading, error, onRetry }: PdfViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);

  const [pages, setPages] = useState<PDFPageProxy[]>([]);
  const [fitScale, setFitScale] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);

  // ── Load the document whenever the URL changes ──────────────
  useEffect(() => {
    if (!url) {
      setPages([]);
      setDocError(null);
      setDocLoading(false);
      return;
    }

    let cancelled = false;
    let doc: PDFDocumentProxy | null = null;
    setDocLoading(true);
    setDocError(null);
    setPages([]);
    setZoom(1);
    setCurrentPage(1);

    const task = pdfjsLib.getDocument({ url });
    task.promise
      .then(async (loaded) => {
        doc = loaded;
        const proxies = await Promise.all(
          Array.from({ length: loaded.numPages }, (_, i) => loaded.getPage(i + 1))
        );
        if (cancelled) return;
        pageRefs.current = new Array(proxies.length).fill(null);
        setPages(proxies);
        setDocLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[PdfViewer] Failed to render document:', err);
        setDocError('This document could not be rendered. Try opening it in a new tab.');
        setDocLoading(false);
      });

    return () => {
      cancelled = true;
      task.destroy();
      doc?.destroy();
    };
  }, [url]);

  // ── Fit-to-width scale (recomputed on container resize) ─────
  const computeFit = useCallback(() => {
    const el = scrollRef.current;
    if (!el || pages.length === 0) return;
    const naturalWidth = pages[0].getViewport({ scale: 1 }).width;
    const available = el.clientWidth - 48; // horizontal padding breathing room
    setFitScale(Math.max(0.2, available / naturalWidth));
  }, [pages]);

  useEffect(() => {
    computeFit();
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => computeFit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [computeFit]);

  // ── Track the current page while scrolling ──────────────────
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const mid = el.scrollTop + el.clientHeight / 2;
    let nearest = 1;
    for (let i = 0; i < pageRefs.current.length; i++) {
      const wrap = pageRefs.current[i];
      if (wrap && wrap.offsetTop <= mid) nearest = i + 1;
    }
    setCurrentPage(nearest);
  }, []);

  const goToPage = (n: number) => {
    const target = Math.min(Math.max(n, 1), pages.length);
    pageRefs.current[target - 1]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const effectiveScale = (fitScale ?? 1) * zoom;
  const showLoading = loading || docLoading;
  const showError = error || docError;
  const hasDoc = url && !showLoading && !showError && pages.length > 0;

  return (
    <div className="flex-1 bg-surface-container-lowest border border-white/5 rounded-2xl flex flex-col overflow-hidden shadow-sm relative min-h-[50vh]">
      {/* Header */}
      <div className="px-5 py-3 border-b border-white/5 bg-surface-container/20 flex items-center justify-between gap-3 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-primary-fixed-dim/10 flex items-center justify-center border border-primary-fixed-dim/20 shrink-0">
            <FileText className="w-5 h-5 text-primary-fixed-dim" />
          </div>
          <div className="min-w-0">
            <h2 className="font-display font-semibold text-sm text-white leading-tight truncate">
              {title || 'Document Viewer'}
            </h2>
            <p className="font-sans text-[11px] text-slate-400 mt-0.5">
              {hasDoc ? `Page ${currentPage} of ${pages.length}` : url ? 'Reference material' : 'No material selected'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {hasDoc && (
            <>
              {/* Page navigation */}
              <div className="hidden sm:flex items-center bg-white/5 border border-white/10 rounded-lg">
                <button
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={currentPage <= 1}
                  aria-label="Previous page"
                  className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)] p-1.5 text-slate-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronUp className="w-4 h-4" />
                </button>
                <span className="px-1 font-mono text-[11px] text-slate-300 tabular-nums select-none">
                  {currentPage}/{pages.length}
                </span>
                <button
                  onClick={() => goToPage(currentPage + 1)}
                  disabled={currentPage >= pages.length}
                  aria-label="Next page"
                  className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)] p-1.5 text-slate-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>

              {/* Zoom */}
              <div className="flex items-center bg-white/5 border border-white/10 rounded-lg">
                <button
                  onClick={() => setZoom(z => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)))}
                  disabled={zoom <= ZOOM_MIN}
                  aria-label="Zoom out"
                  className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)] p-1.5 text-slate-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <span className="px-1 font-mono text-[11px] text-slate-300 tabular-nums select-none w-9 text-center">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  onClick={() => setZoom(z => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)))}
                  disabled={zoom >= ZOOM_MAX}
                  aria-label="Zoom in"
                  className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)] p-1.5 text-slate-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
              </div>
            </>
          )}

          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open in new tab"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-primary-fixed-dim/10 hover:border-primary-fixed-dim/30 text-slate-300 hover:text-white transition-all text-xs font-medium"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Open</span>
            </a>
          )}
        </div>
      </div>

      {/* Body */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 relative overflow-auto bg-surface-container/20 no-scrollbar">
        {showLoading ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-400">
            <Spinner className="w-7 h-7 text-primary-fixed-dim" />
            <p className="font-sans text-sm">Loading document…</p>
          </div>
        ) : showError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center p-6">
            <div className="w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
              <AlertCircle className="w-6 h-6 text-red-400" />
            </div>
            <p className="font-sans text-sm text-slate-300 max-w-xs">{showError}</p>
            <div className="flex items-center gap-2">
              {onRetry && (
                <button
                  onClick={onRetry}
                  className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)] flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300 hover:text-white transition-all text-xs font-medium"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Try again
                </button>
              )}
              {url && (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300 hover:text-white transition-all text-xs font-medium"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open in new tab
                </a>
              )}
            </div>
          </div>
        ) : hasDoc ? (
          <div className="flex flex-col items-center gap-4 py-6 px-4 min-h-full">
            {pages.map((page, i) => (
              <div key={i} ref={el => { pageRefs.current[i] = el; }} data-page={i + 1}>
                <PdfPage page={page} scale={effectiveScale} />
              </div>
            ))}
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center p-6 text-slate-500">
            <FileText className="w-12 h-12 opacity-20" />
            <div>
              <p className="font-sans text-sm text-slate-400">Select a material to view it here</p>
              <p className="font-sans text-xs opacity-70 mt-1">Click any uploaded file on the left to open it.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
