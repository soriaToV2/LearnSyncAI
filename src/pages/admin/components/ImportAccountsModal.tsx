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
  parseAccountsCsv,
  toCsv,
  toTsv,
  type ParsedRow,
} from '../../../lib/csvAccounts';
import { adminApi, type ImportRowResult } from '../../../lib/adminAccounts';
import { ErrorBanner } from './accountUi';

/**
 * Bulk account creation from a CSV — an action on the Accounts page, beside
 * creating one.
 *
 * This exists for the paper's 50-student study: the alternative is fifty trips
 * through the create form, and fifty chances to mistype a grade level.
 *
 * ⚠️ THE WHOLE FILE IS VALIDATED BEFORE ANYTHING IS WRITTEN. Every rule is
 * checked client-side first (`csvAccounts.ts`), then again by
 * `CreateAccountSchema` on the server — including within-file duplicate
 * usernames, which are the failure most likely to leave half a class created and
 * half not. The Create button stays disabled while any row has a problem.
 *
 * ⚠️ THE RESULTS TABLE IS THE ONLY TIME THE GENERATED PASSWORDS EXIST IN
 * READABLE FORM. They are not stored anywhere and cannot be looked up — losing
 * this screen means resetting each account individually. That was safe when this
 * was a full page, which cannot vanish by accident; a modal closes on Escape, on
 * a backdrop click and on the X. `requestClose()` below is the whole reason this
 * component is more than a moved file.
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
  /** Set only when the existing-username check could not run. See `ingest()`. */
  const [checkNote, setCheckNote] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('input');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ImportRowResult[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  /** True once the credentials have been copied OR saved to a file. See `requestClose()`. */
  const [saved, setSaved] = useState(false);
  /**
   * Which discarding action is waiting on confirmation. Closing is the obvious
   * one; "Import more" is the same hazard wearing a friendlier label, since it
   * wipes `results` just as thoroughly.
   */
  const [confirming, setConfirming] = useState<'close' | 'restart' | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const latch = useSubmitLatch();

  const problemCount = useMemo(() => rows.filter((r) => r.errors.length > 0).length, [rows]);
  const usableCount = rows.length - problemCount;

  /*
   * ⚠️ UPLOAD IS THE ONLY WAY IN — there is deliberately no paste box.
   *
   * There used to be one, and it could not work the way anybody would try to use
   * it: copying cells out of Excel or Google Sheets puts them on the clipboard
   * TAB-separated, and `splitLine()` in `csvAccounts.ts` splits on commas only. A
   * spreadsheet paste therefore arrived as one giant column and failed the header
   * check with "The header row is missing: role, first_name, …", which reads as a
   * problem with the admin's data rather than with the input method. The only
   * clipboard content it accepted was raw CSV text — a file already saved, opened
   * in Notepad and copied, which is a stranger route than uploading it.
   *
   * Do not reintroduce paste without teaching the parser about tabs first.
   */
  const ingest = async (file: File) => {
    setFileName(file.name);
    /*
     * Excel saves .xlsx by default, so dropping a workbook is the single most
     * likely mistake here. Caught by name rather than left to the parser: a
     * binary file reaches `parseAccountsCsv()` as mojibake and comes back as
     * "the header row is missing", which sends the admin looking at their columns
     * instead of at File → Save As.
     */
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
   * ⚠️ `csvAccounts.ts` CATCHES DUPLICATES WITHIN THE FILE, NOT AGAINST THE
   * DATABASE — this is the half that was missing.
   *
   * Without it the review screen could say "50 accounts ready to create" and then
   * fail on row 34 because that username already exists, leaving 33 accounts
   * created and a class half imported. The most likely way to hit that is the
   * ordinary one: import a class, notice two students were missed, and re-upload
   * the corrected *full* file. The email half has its own realistic route in:
   * siblings handed the same parent's address, which Supabase's unique index on
   * `auth.users.email` refuses.
   *
   * A courtesy, not the guarantee. The per-row checks inside the import route and
   * both unique indexes are still the real arbiters, so a per-row 409 remains
   * reachable if an account appears in between.
   */
  const withExistingAccountErrors = async (parsed: ParsedRow[]): Promise<ParsedRow[]> => {
    /*
     * Blank usernames are excluded because the server generates those and already
     * checks the database while doing it. Malformed values are excluded because
     * `ImportPrecheckSchema` validates every entry and would 400 on the whole
     * array — those rows already carry their own format errors anyway.
     */
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
      /*
       * Non-fatal on purpose. The import's own per-row check is the backstop, so
       * failing here costs the early warning and nothing else — blocking the
       * whole import over an unavailable courtesy check would be the worse trade.
       */
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
   * ⚠️ THE DISCARD GUARD. `Modal` routes Escape, the backdrop click and the X
   * through one `onClose`, so guarding only the X would leave the two easiest
   * accidents wide open — every path comes through here instead.
   *
   * `busy` refuses outright rather than confirming: `commit()` creates up to
   * fifty accounts SEQUENTIALLY (the server route explains why — Supabase
   * rate-limits the auth admin API by source IP), so unmounting mid-flight loses
   * every password while the server carries on creating the accounts.
   *
   * `saved` is set by either escape route, copy or download. Once the admin has
   * the passwords the prompt has done its job and must not nag.
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

  /**
   * "Start over" in the preview phase, "Import more" in the results phase. The
   * second is guarded for the same reason closing is: it clears `results`, and an
   * admin reaching for the next class has not necessarily saved the last one.
   */
  const requestRestart = () => {
    if (busy) return;
    if (phase === 'done' && !saved) {
      setConfirming('restart');
      return;
    }
    restart();
  };

  /*
   * Both escape hatches emit the SAME four columns, including the names — see
   * `CREDENTIAL_HEADER` in `csvAccounts.ts` for why a file without them cannot be
   * handed out at all. The building lives there, beside the parser it mirrors, so
   * the quoting rule has one home and can be tested on its own.
   */
  const copyAll = async () => {
    if (!results) return;
    await navigator.clipboard.writeText(toTsv(CREDENTIAL_HEADER, credentialRows(results)));
    setCopied(true);
    setSaved(true);
    setTimeout(() => setCopied(false), 2000);
  };

  /** Blob → object URL → click → revoke. Shared shape with `downloadTemplate()`. */
  const download = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadTemplate = () => download(CSV_TEMPLATE, 'learnsyncai-accounts-template.csv');

  const downloadCredentials = () => {
    if (!results) return;
    const today = new Date().toISOString().slice(0, 10);
    download(
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
      {/*
        ⚠️ THE SCROLL REGION IS NOT OPTIONAL. `Modal`'s panel is `overflow-hidden`
        with no max-height, inside a wrapper that centres with `items-center` — so
        a fifty-row table grows the panel past the viewport and it overflows BOTH
        edges. The top rows become unreachable and the Create button sits below
        the fold with nothing to scroll. (The same failure `CLAUDE.md` records for
        flashcard faces.) Capping the height here rather than in `Modal.tsx` keeps
        the other twelve call sites untouched.

        The action row is a SIBLING of the scroll box, never inside it, so the
        buttons stay pinned at every phase and every row count.

        The cap is `85vh` for the whole panel minus `11rem` of fixed chrome
        (Modal's header, its padding, and the action row) rather than a flat `vh`
        fraction — the chrome is a constant number of pixels, so a fraction that
        fits a 1080px screen overflows a 600px laptop, which is the machine an
        administrator is most likely to be using.
      */}
      <div className="flex flex-col gap-5">
        <div className="max-h-[calc(85vh-11rem)] overflow-y-auto -mx-1 px-1">
          {error && <ErrorBanner message={error} />}
          {fatal && <ErrorBanner message={fatal} />}

          {/*
            Amber, not rose: the import is still safe to run — the check that
            failed is the early warning, not the enforcement.
          */}
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

                {/*
                  A button rather than a div, so it is reachable by keyboard and
                  announces itself — the drag handlers ride along on it.

                  ⚠️ THE CONTENTS ARE `pointer-events-none`. Without it,
                  `dragleave` fires every time the cursor crosses onto a child
                  element, so the highlight flickers off while the file is still
                  over the target. Guarding it with a counter is the other common
                  fix and is more code for the same result.
                */}
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

                {/*
                  Named only when it did NOT go through — a file that parsed has
                  already moved the modal to the preview, so there is nothing here
                  to read. This tells the admin WHICH file failed, which matters
                  when they have two versions in the same folder.
                */}
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
                      ? 'Correct them in your spreadsheet, save it again, and upload it again. Nothing has been created.'
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
                            {/*
                              Blank is the NORMAL case now that the template has
                              no username column, so "—" would read as missing
                              data on every row of a healthy file. The real value
                              cannot be previewed — the server derives it and
                              resolves collisions — so the honest thing to show is
                              that one is coming.
                            */}
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
                          <td className="px-4 py-3 font-mono text-xs text-slate-500 tabular-nums">
                            {r.row}
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

        {/* ── Action row — pinned outside the scroll box ─────────────────── */}

        {/*
          The confirmation renders IN PLACE, replacing the action row. Not a
          nested `Modal`: two portals both binding Escape and both writing
          `document.body.style.overflow` fight over the teardown.
        */}
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
          /*
            No action row in this phase. A file parses the moment it arrives and
            takes the modal to the preview itself, so a "Review rows" button would
            be a second click that does nothing — it only existed to submit the
            paste box that used to sit here.
          */
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
                {/*
                  Accounts are created one at a time, so fifty rows is a genuine
                  wait. Saying so is also what makes the modal refusing to close
                  read as deliberate rather than broken.
                */}
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
