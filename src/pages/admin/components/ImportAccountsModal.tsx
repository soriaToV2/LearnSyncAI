import { inkOn } from '../../../context/ThemeContext';
import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Check, Copy, Download, FileDown, RotateCcw, UploadCloud
} from 'lucide-react';
import Spinner from '../../../components/ui/Spinner';
import Modal from '../../../components/ui/Modal';
import { useSubmitLatch } from '../../../components/common/formKit';
import { usernameProblem } from '../../../lib/account';
import {
  CREDENTIAL_HEADER,
  CSV_TEMPLATE,
  EMAIL_SHAPE,
  credentialRows,
  downloadCsvFile,
  parseAccountsCsv,
  toCsv,
  toTsv,
  type ParsedRow,
} from '../../../lib/csvAccounts';
import { adminApi, type ImportRowResult } from '../../../lib/adminAccounts';
import { ErrorBanner } from './accountUi';

/**
 * Bulk account creation from a CSV. The whole file is validated (client, then server) before anything
 * is written. The results table is the only time the generated passwords are readable, so closing goes
 * through requestClose().
 */

type Phase = 'input' | 'preview' | 'done';

export default function ImportAccountsModal({
  isOpen,
  onClose,
  onImported,
  accent,
}: {
  isOpen: boolean;
  onClose: () => void;
  onImported: () => void;
  accent: string;
}) {
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  /** Set only when the existing-account check could not run. */
  const [checkNote, setCheckNote] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('input');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ImportRowResult[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  /** True once the credentials have been copied or saved to a file. */
  const [saved, setSaved] = useState(false);
  /** Which discarding action awaits confirmation: closing, or "Import more" (it clears results too). */
  const [confirming, setConfirming] = useState<'close' | 'restart' | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const latch = useSubmitLatch();

  const problemCount = useMemo(() => rows.filter((r) => r.errors.length > 0).length, [rows]);
  const usableCount = rows.length - problemCount;

  /* Upload only, no paste box: a spreadsheet paste is tab-separated and splitLine() splits on commas. */
  const ingest = async (file: File) => {
    setFileName(file.name);
    /* Reject .xlsx by name: a binary file would reach the parser and fail as a missing header. */
    if (!/\.(csv|txt)$/i.test(file.name)) {
      setRows([]);
      setFatal(
        `"${file.name}" is not a CSV file. In Excel, use File → Save As and choose "CSV (Comma delimited)".`
      );
      return;
    }
    const parsed = parseAccountsCsv(await file.text());
    setFatal(parsed.fatal);
    setCheckNote(null);
    if (parsed.fatal) {
      setRows(parsed.rows);
      return;
    }

    setRows(await withExistingAccountErrors(parsed.rows));
    setPhase('preview');
  };

  /*
   * csvAccounts.ts only catches duplicates within the file; this checks usernames and emails against
   * the database. A courtesy, not the guarantee: the import route's per-row checks still decide.
   */
  const withExistingAccountErrors = async (parsed: ParsedRow[]): Promise<ParsedRow[]> => {
    /* Blank usernames are generated (and checked) by the server; malformed values would 400 the whole array. */
    const usernames = [
      ...new Set(
        parsed
          .map((r) => r.account.username)
          .filter((u): u is string => !!u && !usernameProblem(u))
      ),
    ];
    const emails = [
      ...new Set(
        parsed.map((r) => r.account.email).filter((e): e is string => !!e && EMAIL_SHAPE.test(e))
      ),
    ];
    if (usernames.length === 0 && emails.length === 0) return parsed;

    setIsChecking(true);
    try {
      const { takenUsernames, takenEmails } = await adminApi.precheckImport(usernames, emails);
      const takenU = new Set(takenUsernames);
      const takenE = new Set(takenEmails);
      if (takenU.size === 0 && takenE.size === 0) return parsed;

      return parsed.map((row) => {
        const extra: string[] = [];
        if (row.account.username && takenU.has(row.account.username)) {
          extra.push(`"${row.account.username}" already belongs to an existing account`);
        }
        if (row.account.email && takenE.has(row.account.email)) {
          extra.push(`"${row.account.email}" is already used by an existing account`);
        }
        return extra.length > 0 ? { ...row, errors: [...row.errors, ...extra] } : row;
      });
    } catch {
      /* Non-fatal: failing costs the early warning only. */
      setCheckNote(
        'Could not check this file against existing accounts. Any clash will still be caught and reported per row when you create.'
      );
      return parsed;
    } finally {
      setIsChecking(false);
    }
  };

  const onFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await ingest(file);
    // Allows re-selecting the same file after a correction.
    e.target.value = '';
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await ingest(file);
  };

  const commit = async () => {
    if (problemCount > 0 || rows.length === 0 || busy || !latch.take()) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await adminApi.importAccounts(rows.map((r) => r.account));
      setResults(outcome.results);
      setPhase('done');
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The import failed.');
    } finally {
      setBusy(false);
      latch.release();
    }
  };

  const restart = () => {
    setRows([]);
    setFileName(null);
    setIsDragging(false);
    setIsChecking(false);
    setCheckNote(null);
    setResults(null);
    setFatal(null);
    setError(null);
    setCopied(false);
    setDownloaded(false);
    setSaved(false);
    setConfirming(null);
    setPhase('input');
  };

  /*
   * Discard guard. Escape, backdrop and X all arrive here via Modal's onClose. Refuse outright while
   * busy (creation is sequential, and unmounting loses every password); once saved, don't prompt.
   */
  const requestClose = () => {
    if (busy) return;
    if (phase === 'done' && !saved) {
      setConfirming('close');
      return;
    }
    restart();
    onClose();
  };

  /** "Start over" / "Import more". The latter clears results, so it goes through the same guard. */
  const requestRestart = () => {
    if (busy) return;
    if (phase === 'done' && !saved) {
      setConfirming('restart');
      return;
    }
    restart();
  };

  /* Both exports emit the same four columns; the builders live in csvAccounts.ts beside the parser. */
  const copyAll = async () => {
    if (!results) return;
    await navigator.clipboard.writeText(toTsv(CREDENTIAL_HEADER, credentialRows(results)));
    setCopied(true);
    setSaved(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadTemplate = () =>
    downloadCsvFile(CSV_TEMPLATE, 'learnsyncai-accounts-template.csv');

  const downloadCredentials = () => {
    if (!results) return;
    const today = new Date().toISOString().slice(0, 10);
    downloadCsvFile(
      toCsv(CREDENTIAL_HEADER, credentialRows(results)),
      `learnsyncai-credentials-${today}.csv`
    );
    setDownloaded(true);
    setSaved(true);
    setTimeout(() => setDownloaded(false), 2000);
  };

  const createdCount = results ? results.filter((r) => r.ok).length : 0;

  const secondaryButton =
    'px-5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:text-white font-display text-xs font-bold transition-colors flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)]';

  return (
    <Modal
      isOpen={isOpen}
      onClose={requestClose}
      title={phase === 'done' ? 'Import complete' : 'Import accounts'}
      maxWidth="max-w-3xl"
    >
      {/* Scroll region: Modal has no max-height and centres its panel, so a long table would overflow both edges. The action row stays a sibling so it is pinned. Cap = 85vh minus 11rem of fixed chrome. Don't fix this in Modal.tsx. */}
      <div className="flex flex-col gap-5">
        <div className="max-h-[calc(85vh-11rem)] overflow-y-auto -mx-1 px-1">
          {error && <ErrorBanner message={error} />}
          {fatal && <ErrorBanner message={fatal} />}

          {/* Amber: the import is still safe to run without the early warning. */}
          {checkNote && (
            <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-amber-500/[0.07] border border-amber-500/20 mb-6">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="font-sans text-xs text-amber-200/90 leading-relaxed">{checkNote}</p>
            </div>
          )}

          {phase === 'input' && (
            <div className="flex flex-col gap-4">
              <section className="rounded-2xl bg-white/[0.02] border border-white/5 p-5">
                <h3 className="font-display text-sm font-bold text-white mb-1">
                  1. Prepare the file
                </h3>
                <p className="font-sans text-xs text-slate-400 mb-4 leading-relaxed">
                  One row per account, with a header row. There is no username or password column —
                  both are created for you, and you get them in a file at the end.
                </p>

                <div className="rounded-xl bg-black/30 border border-white/5 p-3 overflow-x-auto mb-4">
                  <pre className="font-mono text-[11px] text-slate-300 leading-relaxed whitespace-pre">
                    {CSV_TEMPLATE}
                  </pre>
                </div>

                <ul className="flex flex-col gap-1.5 mb-4">
                  {[
                    'role — student or educator. Administrator accounts are not created here.',
                    'first_name and last_name — both required. The username is built from them, e.g. juan.delacruz.',
                    'grade_level — required for students (7–10), blank for educators.',
                    'email — optional here, unlike the single-account form: a class can be imported before addresses are collected. Each address must be unique, so two students cannot share one.',
                  ].map((line) => (
                    <li
                      key={line}
                      className="font-sans text-xs text-slate-400 flex items-start gap-2"
                    >
                      <span className="text-slate-600 mt-0.5">•</span>
                      {line}
                    </li>
                  ))}
                </ul>

                <button
                  type="button"
                  onClick={downloadTemplate}
                  className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)] flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:text-white hover:bg-white/10 transition-colors font-sans text-xs"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download template
                </button>
              </section>

              <section className="rounded-2xl bg-white/[0.02] border border-white/5 p-5">
                <h3 className="font-display text-sm font-bold text-white mb-1">
                  2. Upload the file
                </h3>
                <p className="font-sans text-xs text-slate-400 mb-4 leading-relaxed">
                  Nothing is created until you have reviewed every row on the next screen.
                </p>

                {/* A button for keyboard access. Contents are pointer-events-none, or dragleave fires on every child and the highlight flickers. */}
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={isChecking}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={onDrop}
                  className={`w-full rounded-xl border-2 border-dashed px-6 py-10 transition-colors ${
                    isDragging
                      ? 'border-white/40 bg-white/[0.06]'
                      : 'border-white/15 bg-white/[0.02] hover:border-white/30 hover:bg-white/[0.04]'
                  } disabled:pointer-events-none`}
                >
                  <div className="pointer-events-none flex flex-col items-center gap-2 text-center">
                    {isChecking ? (
                      <Spinner className="w-7 h-7 text-slate-400" />
                    ) : (
                      <UploadCloud
                        className={`w-7 h-7 ${isDragging ? 'text-white' : 'text-slate-500'}`}
                      />
                    )}
                    <span className="font-display text-sm font-bold text-slate-200">
                      {isChecking
                        ? 'Checking against existing accounts…'
                        : 'Drop your .csv here, or click to browse'}
                    </span>
                    <span className="font-sans text-[11px] text-slate-500 leading-relaxed">
                      {isChecking
                        ? 'Looking for usernames and addresses that are already in use.'
                        : 'Saved from the template above. In Excel: File → Save As → CSV (Comma delimited).'}
                    </span>
                  </div>
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  onChange={onFileInput}
                  className="hidden"
                />

                {/* Names the file that failed to parse. */}
                {fileName && fatal && (
                  <p className="font-sans text-[11px] text-slate-500 mt-3">
                    Last tried: <span className="font-mono text-slate-400">{fileName}</span>
                  </p>
                )}
              </section>
            </div>
          )}

          {phase === 'preview' && (
            <div className="flex flex-col gap-4">
              <div
                className={`flex items-start gap-3 px-4 py-3 rounded-2xl border ${
                  problemCount > 0
                    ? 'bg-amber-500/[0.07] border-amber-500/20'
                    : 'bg-emerald-500/[0.07] border-emerald-500/20'
                }`}
              >
                {problemCount > 0 ? (
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                ) : (
                  <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                )}
                <div>
                  <p className="font-display text-sm font-bold text-white">
                    {problemCount > 0
                      ? `${problemCount} of ${rows.length} rows need fixing`
                      : `${usableCount} account${usableCount === 1 ? '' : 's'} ready to create`}
                  </p>
                  <p className="font-sans text-xs text-slate-400 mt-1 leading-relaxed">
                    {problemCount > 0
                      ? 'Correct them in your spreadsheet, save it again, and upload it again. Nothing has been created. Row numbers below match your spreadsheet, header row included.'
                      : 'Passwords are generated where you left the column blank, and shown once after this.'}
                  </p>
                </div>
              </div>

              <div className="rounded-2xl bg-white/[0.02] border border-white/5 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-white/5">
                        {['Row', 'Name', 'Username', 'Role', 'Grade', 'Status'].map((h) => (
                          <th
                            key={h}
                            className="font-sans text-[10px] uppercase tracking-wider text-slate-500 font-bold px-4 py-3 whitespace-nowrap"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => {
                        const bad = row.errors.length > 0;
                        return (
                          <tr
                            key={row.line}
                            className={`border-b border-white/5 last:border-0 ${bad ? 'bg-rose-500/[0.04]' : ''}`}
                          >
                            <td className="px-4 py-3 font-mono text-xs text-slate-500 tabular-nums align-top">
                              {row.line}
                            </td>
                            <td className="px-4 py-3 font-sans text-xs text-slate-200 align-top whitespace-nowrap">
                              {row.account.first_name} {row.account.last_name}
                            </td>
                            {/* Blank is normal (the server generates it), so say so rather than showing "—". */}
                            <td className="px-4 py-3 font-mono text-xs text-slate-300 align-top">
                              {row.account.username || (
                                <span className="font-sans italic text-slate-500">generated</span>
                              )}
                            </td>
                            <td className="px-4 py-3 font-sans text-xs text-slate-400 align-top capitalize">
                              {row.account.role || '—'}
                            </td>
                            <td className="px-4 py-3 font-sans text-xs text-slate-400 align-top tabular-nums">
                              {row.account.grade_level ?? '—'}
                            </td>
                            <td className="px-4 py-3 align-top">
                              {bad ? (
                                <ul className="flex flex-col gap-1">
                                  {row.errors.map((e) => (
                                    <li key={e} className="font-sans text-[11px] text-rose-300">
                                      {e}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <span className="font-sans text-[11px] text-emerald-400">Ready</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {phase === 'done' && results && (
            <div className="flex flex-col gap-4">
              <div className="flex items-start gap-3 px-4 py-3 rounded-2xl bg-emerald-500/[0.07] border border-emerald-500/20">
                <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-display text-sm font-bold text-white">
                    {createdCount} of {results.length} accounts created
                  </p>
                  <p className="font-sans text-xs text-amber-300/90 mt-1 leading-relaxed">
                    Copy or save these passwords now — they are not stored anywhere and cannot be
                    looked up later. A lost one has to be reset from the account's page.
                  </p>
                </div>
              </div>

              <div className="rounded-2xl bg-white/[0.02] border border-white/5 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-white/5">
                        {['Row', 'Name', 'Username', 'Password', 'Result'].map((h) => (
                          <th
                            key={h}
                            className="font-sans text-[10px] uppercase tracking-wider text-slate-500 font-bold px-4 py-3 whitespace-nowrap"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((r) => (
                        <tr key={r.row} className="border-b border-white/5 last:border-0">
                          {/* r.row indexes the posted array; map it to the file line so this matches the preview. Names and credentials still come from the server's row. */}
                          <td className="px-4 py-3 font-mono text-xs text-slate-500 tabular-nums">
                            {rows[r.row - 1]?.line ?? r.row}
                          </td>
                          <td className="px-4 py-3 font-sans text-xs text-slate-200 whitespace-nowrap">
                            {r.first_name} {r.last_name}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-slate-300">
                            {r.username}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-white">
                            {r.password ?? '—'}
                          </td>
                          <td className="px-4 py-3 font-sans text-[11px]">
                            {r.ok ? (
                              <span className="text-emerald-400">Created</span>
                            ) : (
                              <span className="text-rose-300">{r.message}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Action row, outside the scroll box */}

        {/* Confirmation renders in place of the action row, not as a nested Modal (two portals would fight over Escape and body overflow). */}
        {confirming ? (
          <div className="flex flex-col gap-3 px-4 py-3 rounded-2xl bg-amber-500/[0.07] border border-amber-500/25">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-display text-sm font-bold text-white">
                  {confirming === 'close'
                    ? 'Close without saving these passwords?'
                    : 'Start another import without saving these passwords?'}
                </p>
                <p className="font-sans text-xs text-slate-400 mt-1 leading-relaxed">
                  They cannot be looked up later. Each one would have to be reset from its account's
                  page.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setConfirming(null)}
                style={{ backgroundColor: accent, color: inkOn(accent) }}
                className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)] px-5 py-2.5 rounded-xl font-display text-xs font-bold hover:brightness-110 transition-all active:scale-95"
              >
                Go back
              </button>
              <button
                type="button"
                onClick={() => {
                  const closing = confirming === 'close';
                  restart();
                  if (closing) onClose();
                }}
                className={secondaryButton}
              >
                {confirming === 'close' ? 'Close anyway' : 'Discard and continue'}
              </button>
            </div>
          </div>
        ) : phase === 'input' ? (
          /* No action row: a file parses on arrival and moves to the preview itself. */
          null
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            {phase === 'preview' && (
              <>
                <button
                  type="button"
                  onClick={commit}
                  disabled={problemCount > 0 || busy || rows.length === 0}
                  style={
                    problemCount > 0 || busy || rows.length === 0
                      ? undefined
                      : { backgroundColor: accent, color: inkOn(accent) }
                  }
                  className={`px-5 py-2.5 rounded-xl font-display text-xs font-bold flex items-center gap-2 transition-all active:scale-95 ${
                    problemCount > 0 || busy || rows.length === 0
                      ? 'bg-white/5 text-slate-500 cursor-not-allowed'
                      : 'hover:brightness-110'
                  }`}
                >
                  {busy ? (
                    <Spinner className="w-3.5 h-3.5" />
                  ) : (
                    <UploadCloud className="w-3.5 h-3.5" />
                  )}
                  Create {usableCount} account{usableCount === 1 ? '' : 's'}
                </button>
                <button
                  type="button"
                  onClick={requestRestart}
                  disabled={busy}
                  className={`${secondaryButton} disabled:opacity-40 disabled:pointer-events-none`}
                >
                  Start over
                </button>
                {/* Accounts are created one at a time, so this is a real wait. */}
                {busy && (
                  <p className="font-sans text-[11px] text-slate-400 leading-relaxed">
                    Creating accounts one at a time — please keep this window open.
                  </p>
                )}
              </>
            )}

            {phase === 'done' && (
              <>
                <button
                  type="button"
                  onClick={copyAll}
                  disabled={createdCount === 0}
                  style={
                    createdCount === 0 ? undefined : { backgroundColor: accent, color: inkOn(accent) }
                  }
                  className={`px-5 py-2.5 rounded-xl font-display text-xs font-bold flex items-center gap-2 transition-all active:scale-95 ${
                    createdCount === 0
                      ? 'bg-white/5 text-slate-500 cursor-not-allowed'
                      : 'hover:brightness-110'
                  }`}
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied' : 'Copy all credentials'}
                </button>
                <button
                  type="button"
                  onClick={downloadCredentials}
                  disabled={createdCount === 0}
                  className={`${secondaryButton} disabled:opacity-40 disabled:pointer-events-none`}
                >
                  {downloaded ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <FileDown className="w-3.5 h-3.5" />
                  )}
                  {downloaded ? 'Saved' : 'Save as file'}
                </button>
                <button type="button" onClick={requestRestart} className={secondaryButton}>
                  <RotateCcw className="w-3.5 h-3.5" />
                  Import more
                </button>
                <button type="button" onClick={requestClose} className={secondaryButton}>
                  Done
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
