import { inkOn } from '../../../context/ThemeContext';
import React, { useState } from 'react';
import { Check, Copy, UserPlus, Wand2 } from 'lucide-react';
import Spinner from '../../../components/ui/Spinner';
import Modal from '../../../components/ui/Modal';
import { Field, SaveButton, StatusLine, messageOf, useSubmitLatch, type Status } from '../../../components/common/formKit';
import { USERNAME_HINT, usernameProblem } from '../../../lib/account';
import { adminApi, type AssignableRole, type CreatedAccount } from '../../../lib/adminAccounts';

/**
 * Create one student or educator.
 *
 * ⚠️ THE GRADE FIELD IS REQUIRED FOR A STUDENT AND THERE IS NO DEFAULT.
 * `handle_new_user()` silently assigns Grade 7 to a student created without one,
 * and that value decides which year's materials the account can open for the rest
 * of its life. A pre-selected grade in this form would be the same silent choice
 * wearing a nicer hat, so the picker opens empty and Create stays disabled.
 *
 * ⚠️ THE PASSWORD IS SHOWN EXACTLY ONCE, ON SUCCESS. It is not stored in readable
 * form anywhere and cannot be retrieved — only reset. The success panel says so,
 * because an admin who closes it assuming they can look it up later has locked a
 * student out.
 */

const GRADES = [7, 8, 9, 10];

export default function CreateAccountModal({
  isOpen,
  onClose,
  onCreated,
  accent,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
  accent: string;
}) {
  const [role, setRole] = useState<AssignableRole>('student');
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [username, setUsername] = useState('');
  const [grade, setGrade] = useState<number | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [created, setCreated] = useState<CreatedAccount | null>(null);
  const [copied, setCopied] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const latch = useSubmitLatch();

  const canGenerate = first.trim().length > 0 && last.trim().length > 0 && !isSuggesting;

  /*
   * The server builds AND checks the name — a client-side `first.last` would look
   * right and then collide on Create, which is exactly the round trip this button
   * exists to remove. It also handles the parts that are easy to get wrong:
   * folding `ñ` to `n`, dropping hyphens and apostrophes, fitting 30 characters,
   * and appending `2` when the name is already taken.
   */
  const generateUsername = async () => {
    if (!canGenerate) return;
    setIsSuggesting(true);
    setSuggestError(null);
    try {
      setUsername(await adminApi.suggestUsername(first.trim(), last.trim()));
    } catch (err) {
      setSuggestError(messageOf(err, 'Could not build a username from that name.'));
    } finally {
      setIsSuggesting(false);
    }
  };

  const usernameError = username.length > 0 ? usernameProblem(username) : null;

  /*
   * ⚠️ EMAIL IS REQUIRED HERE, AND OPTIONAL IN A CSV IMPORT.
   * An admin creating one account at a time has the address in front of them, so
   * there is no reason to fall back to a `<username>@pca.invalid` placeholder on
   * this path. A class of fifty may legitimately be imported before anyone has
   * collected fifty addresses, which is the one case the placeholder still serves.
   *
   * Shape-checked only — the server validates properly, and a browser-side email
   * regex that disagrees with it is worse than none.
   */
  const emailError =
    email.trim().length > 0 && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())
      ? 'Enter a valid email address.'
      : null;

  const canSave =
    first.trim().length > 0 &&
    last.trim().length > 0 &&
    username.trim().length > 0 &&
    !usernameError &&
    email.trim().length > 0 &&
    !emailError &&
    (role !== 'student' || grade !== null) &&
    !busy;

  const reset = () => {
    setRole('student');
    setFirst('');
    setLast('');
    setUsername('');
    setGrade(null);
    setEmail('');
    setStatus(null);
    setCreated(null);
    setCopied(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave || !latch.take()) return;
    setBusy(true);
    setStatus(null);
    try {
      const account = await adminApi.createAccount({
        role,
        first_name: first.trim(),
        last_name: last.trim(),
        username: username.trim().toLowerCase(),
        // Sent only for a student — an educator must carry no grade at all.
        ...(role === 'student' && grade !== null ? { grade_level: grade } : {}),
        email: email.trim().toLowerCase(),
      });
      setCreated(account);
      onCreated();
    } catch (err) {
      setStatus({ kind: 'error', text: messageOf(err, 'Could not create the account.') });
    } finally {
      setBusy(false);
      latch.release();
    }
  };

  const copyCredentials = async () => {
    if (!created) return;
    await navigator.clipboard.writeText(
      `Username: ${created.username}\nPassword: ${created.password}`
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={created ? 'Account created' : 'Create an account'}
      maxWidth="max-w-lg"
    >
      {created ? (
        <div className="flex flex-col gap-5">
          <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-3">
            <p className="font-sans text-sm text-emerald-300">
              {created.first_name} {created.last_name} can now sign in.
            </p>
          </div>

          <div className="rounded-xl bg-white/[0.03] border border-white/10 p-4 flex flex-col gap-3">
            <div>
              <p className="font-sans text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">
                Username
              </p>
              <p className="font-mono text-sm text-white break-all">{created.username}</p>
            </div>
            <div>
              <p className="font-sans text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">
                Password
              </p>
              <p className="font-mono text-sm text-white break-all">{created.password}</p>
            </div>
            <button
              type="button"
              onClick={copyCredentials}
              className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)] self-start flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:text-white hover:bg-white/10 transition-colors font-sans text-xs"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy both'}
            </button>
          </div>

          {/*
            Two sentences that both have to survive. The first: an admin who closes
            this assuming the password is retrievable has locked a student out, and
            the reset that fixes it is an admin action, not a self-service one.
            The second: the admin has to TELL the student they will be asked to
            change it, or the prompt at first login looks like a fault.
          */}
          <div className="rounded-xl bg-amber-500/[0.07] border border-amber-500/20 px-4 py-3 flex flex-col gap-1.5">
            <p className="font-sans text-xs text-amber-300/90 leading-relaxed">
              Save this password now — it is not stored anywhere and cannot be looked up later. If
              it is lost, reset it from the account's page.
            </p>
            <p className="font-sans text-xs text-slate-400 leading-relaxed">
              They will be asked to choose their own password the first time they sign in. Until
              they do, this one is not private — you know it too.
            </p>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={reset}
              className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)] px-5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:text-white font-display text-xs font-bold transition-colors"
            >
              Create another
            </button>
            <button
              type="button"
              onClick={close}
              style={{ backgroundColor: accent, color: inkOn(accent) }}
              className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)] px-5 py-2.5 rounded-xl font-display text-xs font-bold hover:brightness-110 transition-all active:scale-95"
            >
              Done
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="font-sans text-[10px] uppercase tracking-wider text-slate-500 font-bold">
              Role
            </span>
            <div className="grid grid-cols-2 gap-2">
              {(['student', 'educator'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    setRole(r);
                    // An educator carries no grade at all — clearing it here keeps
                    // the form honest rather than sending a value the server rejects.
                    if (r === 'educator') setGrade(null);
                  }}
                  style={role === r ? { borderColor: accent, color: accent } : undefined}
                  className={`px-4 py-2.5 rounded-xl border font-display text-xs font-bold capitalize transition-colors ${
                    role === r ? 'bg-white/[0.06]' : 'border-white/10 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
            {/*
              Stated rather than left to be discovered: `admin` is not in the list
              and its absence would otherwise read as an oversight.
            */}
            <p className="font-sans text-[11px] text-slate-500">
              Administrator accounts are not created here.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              label="First name"
              value={first}
              onChange={(e) => setFirst(e.target.value)}
              maxLength={60}
              autoComplete="off"
            />
            <Field
              label="Last name"
              value={last}
              onChange={(e) => setLast(e.target.value)}
              maxLength={60}
              autoComplete="off"
            />
          </div>

          {/*
            The Generate button sits inside the field rather than beside it so it
            reads as an action ON the username, not a separate control. It is
            disabled until both names are present, because that is what it builds
            from — and a button that silently does nothing is worse than one
            visibly waiting.
          */}
          <div className="relative">
            <Field
              label="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              maxLength={30}
              autoComplete="off"
              spellCheck={false}
              hint={
                suggestError ??
                usernameError ??
                `What they sign in with. ${USERNAME_HINT}`
              }
            />
            <button
              type="button"
              onClick={generateUsername}
              disabled={!canGenerate}
              title={
                canGenerate
                  ? 'Build a username from the name above'
                  : 'Enter a first and last name first'
              }
              className={`absolute right-2 top-[26px] flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-sans text-[11px] font-semibold transition-colors ${
                canGenerate
                  ? 'text-slate-300 bg-white/5 hover:bg-white/10 hover:text-white'
                  : 'text-slate-600 cursor-not-allowed'
              }`}
            >
              {isSuggesting ? (
                <Spinner className="w-3.5 h-3.5" />
              ) : (
                <Wand2 className="w-3.5 h-3.5" />
              )}
              Generate
            </button>
          </div>

          {role === 'student' && (
            <div className="flex flex-col gap-1.5">
              <span className="font-sans text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                Grade level
              </span>
              <div className="grid grid-cols-4 gap-2">
                {GRADES.map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGrade(g)}
                    style={grade === g ? { borderColor: accent, color: accent } : undefined}
                    className={`px-3 py-2.5 rounded-xl border font-display text-xs font-bold transition-colors ${
                      grade === g ? 'bg-white/[0.06]' : 'border-white/10 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
              <p className="font-sans text-[11px] text-slate-500 leading-relaxed">
                Decides which materials this student can open. There is no default — choose one.
              </p>
            </div>
          )}

          <Field
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
            placeholder="name@example.com"
            hint={
              emailError ??
              'Contact information only — they sign in with their username, never this. Each account needs its own address; two people cannot share one.'
            }
          />

          <div className="flex items-center gap-4 flex-wrap pt-1">
            <SaveButton accent={accent} disabled={!canSave} busy={busy} label="Create account" />
            <StatusLine status={status} />
          </div>

          <p className="font-sans text-[11px] text-slate-500 flex items-start gap-2 leading-relaxed">
            <UserPlus className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            A password is generated and shown once on the next screen.
          </p>
        </form>
      )}
    </Modal>
  );
}
