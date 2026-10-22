import { Router, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { supabaseAdmin } from '../lib/supabase';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import {
  CreateAccountSchema,
  UpdateAccountSchema,
  SetAccountStatusSchema,
  ResetAccountPasswordSchema,
  SetAccountEmailSchema,
  ImportAccountsSchema,
  ImportPrecheckSchema,
  ListAccountsQuerySchema,
  SuggestUsernameSchema,
  type CreateAccountInput,
} from '../types/api';
import { suggestUsername } from '../lib/usernameSuggest';
import { canReceiveMail, isPlaceholderEmail, placeholderEmailFor } from '../lib/placeholderEmail';

/**
 * Admin: account administration only. Never read a learning table here.
 * There is deliberately no delete route: 13 tables cascade from `profiles`, so deleting a student
 * destroys their study data. Disable instead.
 */

const router = Router();

router.use(authenticate, requireRole('admin'));

/** Every column a screen renders must be listed here (a missing must_change_password showed every account Active). */
const ACCOUNT_COLUMNS =
  'id, role, username, first_name, last_name, grade_level, status, must_change_password, created_at, updated_at';

/** Raised by the case-insensitive `ux_profiles_username_lower`. */
const UNIQUE_VIOLATION = '23505';

const PAGE_SIZE = 25;

/** Chunk size for `.in()` lists, which go into the query string. */
const USERNAME_CHECK_CHUNK = 200;

/** Paging for emailOwners(); addresses are only reachable by sweeping auth.users. The cap is a runaway guard. */
const AUTH_PAGE_SIZE = 1000;
const AUTH_MAX_PAGES = 20;

/**
 * Memorable initial passwords (`brave-otter-93`, ~1.5M combinations), readable aloud to a class.
 * Acceptable only because they are single-use (forced change at first login) and sign-in is
 * rate-limited. Revert to random passwords if either stops holding.
 */
const PASSWORD_ADJECTIVES = [
  'able', 'active', 'agile', 'alert', 'amber', 'ample', 'atomic', 'autumn',
  'basic', 'bold', 'brave', 'breezy', 'bright', 'brisk', 'calm', 'chief',
  'civic', 'classic', 'clean', 'clear', 'clever', 'coastal', 'cosmic', 'crisp',
  'daily', 'deep', 'direct', 'eager', 'early', 'easy', 'electric', 'epic',
  'equal', 'exact', 'fair', 'famous', 'fast', 'fine', 'firm', 'first',
  'fluent', 'fresh', 'gentle', 'giant', 'glad', 'golden', 'grand', 'great',
  'green', 'handy', 'happy', 'hardy', 'helpful', 'honest', 'ideal', 'jolly',
  'joyful', 'keen', 'kind', 'large', 'level', 'light', 'lively', 'local',
  'logical', 'loyal', 'lucky', 'lunar', 'magnetic', 'main', 'major', 'mellow',
  'merry', 'mighty', 'mindful', 'modern', 'natural', 'neat', 'noble', 'normal',
  'northern', 'open', 'orange', 'ordered', 'pacific', 'patient', 'peaceful', 'perfect',
  'plain', 'pleasant', 'polar', 'polite', 'prime', 'proper', 'proud', 'purple',
  'quick', 'quiet', 'rapid', 'ready', 'real', 'regal', 'roasted', 'robust',
  'royal', 'rustic', 'safe', 'sharp', 'shiny', 'silver', 'simple', 'sincere',
  'smart', 'smooth', 'snowy', 'solar', 'solid', 'southern', 'spring', 'stable',
  'steady', 'sturdy', 'summer', 'sunny', 'super', 'swift', 'tidy', 'true',
] as const;

const PASSWORD_NOUNS = [
  'acorn', 'anchor', 'apple', 'arrow', 'aster', 'atlas', 'badger', 'basil',
  'beacon', 'beaver', 'birch', 'bison', 'bloom', 'branch', 'bridge', 'brook',
  'button', 'cabin', 'cactus', 'canyon', 'castle', 'cedar', 'chorus', 'cliff',
  'clover', 'comet', 'compass', 'coral', 'cotton', 'crane', 'crystal', 'dahlia',
  'daisy', 'dolphin', 'dragon', 'eagle', 'ember', 'engine', 'falcon', 'fern',
  'forest', 'fossil', 'fountain', 'galaxy', 'garden', 'gazelle', 'ginger', 'glacier',
  'granite', 'harbor', 'harvest', 'hawk', 'hazel', 'heron', 'hickory', 'horizon',
  'island', 'jasmine', 'jungle', 'juniper', 'kettle', 'lagoon', 'lantern', 'laurel',
  'ledger', 'lemon', 'lighthouse', 'lily', 'lotus', 'magnet', 'mango', 'maple',
  'marble', 'meadow', 'melon', 'meteor', 'mint', 'monsoon', 'mountain', 'nectar',
  'nutmeg', 'oasis', 'ocean', 'olive', 'orbit', 'orchard', 'otter', 'palm',
  'pantry', 'parrot', 'pebble', 'pelican', 'penguin', 'pepper', 'pine', 'planet',
  'pond', 'poppy', 'prairie', 'quartz', 'rabbit', 'rainbow', 'raven', 'reef',
  'ribbon', 'river', 'robin', 'rocket', 'saffron', 'sage', 'sailor', 'salmon',
  'sequoia', 'shell', 'signal', 'sparrow', 'spruce', 'station', 'summit', 'sunset',
  'temple', 'thistle', 'tiger', 'tulip', 'turtle', 'valley', 'walnut', 'willow',
] as const;

/** Uniform over `max` (rejection sampling; plain `% max` is biased). */
function randomBelow(max: number): number {
  const limit = Math.floor(0xffffffff / max) * max;
  for (;;) {
    const n = randomBytes(4).readUInt32BE(0);
    if (n < limit) return n % max;
  }
}

function generatePassword(): string {
  const adjective = PASSWORD_ADJECTIVES[randomBelow(PASSWORD_ADJECTIVES.length)];
  const noun = PASSWORD_NOUNS[randomBelow(PASSWORD_NOUNS.length)];
  // 10-99: fixed length, no leading zero.
  const number = 10 + randomBelow(90);
  return `${adjective}-${noun}-${number}`;
}

/** Case-insensitive pre-check for a friendly 409. The unique index is the real guarantee. */
async function usernameTaken(username: string, exceptId?: string): Promise<boolean> {
  let query = supabaseAdmin.from('profiles').select('id').ilike('username', username);
  if (exceptId) query = query.neq('id', exceptId);
  const { data } = await query.limit(1);
  return (data?.length ?? 0) > 0;
}

type AccountRow = {
  id: string;
  role: string;
  username: string | null;
  first_name: string;
  last_name: string;
  grade_level: number | null;
  status: string;
  created_at: string;
  updated_at: string;
};

/** Nullable `error` rather than a discriminated union, which doesn't narrow without `strict`. */
type CreateOutcome = {
  error: { status: number; message: string } | null;
  /** Non-null exactly when `error` is null. */
  account: AccountRow | null;
  password: string;
  email: string;
};

const fail = (status: number, message: string): CreateOutcome => ({
  error: { status, message },
  account: null,
  password: '',
  email: '',
});

/**
 * Creates one account. handle_new_user() silently NULLs a bad username, so: pre-check → create →
 * re-read and confirm the username stuck → repair once → on collision delete and 409.
 * Always respond from the re-read row, never the request body.
 */
async function createAccount(input: CreateAccountInput): Promise<CreateOutcome> {
  const { role, first_name, last_name, username, grade_level } = input;

  if (await usernameTaken(username)) {
    return fail(409, `The username "${username}" is already taken`);
  }

  const password = input.password ?? generatePassword();
  // auth.users needs an identity, so a missing email becomes a placeholder.
  const email = input.email ?? placeholderEmailFor(username);

  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    // No SMTP is configured, so an unconfirmed account could never be confirmed.
    email_confirm: true,
    user_metadata: {
      role,
      first_name,
      last_name,
      username,
      ...(role === 'student' ? { grade_level } : {}),
      // Born un-activated (the admin knows the password). Via metadata so there's no ungated window.
      must_change_password: true,
    },
  });

  if (createError || !created.user) {
    const message = createError?.message ?? 'Could not create the account';
    // Supabase reports a duplicate address here; the username collision is caught above.
    const status = /already|exists|registered/i.test(message) ? 409 : 400;
    return fail(status, message);
  }

  const userId = created.user.id;

  // The trigger has inserted the profile; read it back to verify.
  let { data: account } = await supabaseAdmin
    .from('profiles')
    .select(ACCOUNT_COLUMNS)
    .eq('id', userId)
    .single<AccountRow>();

  if (!account) {
    await supabaseAdmin.auth.admin.deleteUser(userId);
    return fail(500, 'The account was created without a profile');
  }

  if (account.username === null) {
    // Lost a race or failed the trigger's format check; one UPDATE against the unique index settles it.
    const { data: repaired, error: repairError } = await supabaseAdmin
      .from('profiles')
      .update({ username })
      .eq('id', userId)
      .select(ACCOUNT_COLUMNS)
      .single<AccountRow>();

    if (repairError || !repaired) {
      // Better no account than one that reports success and cannot sign in.
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return repairError?.code === UNIQUE_VIOLATION
        ? fail(409, `The username "${username}" was taken a moment ago — try another`)
        : fail(500, 'The account could not be given a username, so it was removed');
    }
    account = repaired;
  }

  return { error: null, account, password, email };
}

/** GET /api/admin/overview: account counts only. Accepts no input, so no schema. */
router.get('/overview', async (_req: Request, res: Response): Promise<void> => {
  const { data: rows, error } = await supabaseAdmin
    .from('profiles')
    .select('id, role, grade_level, status, username, must_change_password, created_at');

  if (error) {
    res.status(500).json({ error: 'Database error', message: error.message });
    return;
  }

  const all = rows ?? [];
  const students = all.filter((r) => r.role === 'student');

  const cannotSignIn = all.filter((r) => r.username === null);
  const notActivated = all.filter((r) => r.status === 'active' && r.must_change_password);

  res.json({
    data: {
      totals: {
        all: all.length,
        students: students.length,
        educators: all.filter((r) => r.role === 'educator').length,
        admins: all.filter((r) => r.role === 'admin').length,
        active: all.filter((r) => r.status === 'active').length,
        disabled: all.filter((r) => r.status === 'disabled').length,
      },
      by_grade: [7, 8, 9, 10].map((grade) => ({
        grade,
        count: students.filter((s) => s.grade_level === grade).length,
      })),
      /** Rendered only when non-empty. */
      attention: {
        /** `username IS NULL`: these accounts cannot sign in. */
        cannot_sign_in: cannotSignIn.length,
        /** Still holding the admin-set password. */
        not_activated: notActivated.length,
        disabled: all.filter((r) => r.status === 'disabled').length,
      },
    },
  });
});

/** GET /api/admin/accounts. No emails: they'd cost one getUserById per row. */
router.get('/accounts', async (req: Request, res: Response): Promise<void> => {
  const parsed = ListAccountsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const { role, grade, status, q, page } = parsed.data;
  const from = (page - 1) * PAGE_SIZE;

  let query = supabaseAdmin
    .from('profiles')
    .select(ACCOUNT_COLUMNS, { count: 'exact' })
    .order('role', { ascending: true })
    .order('last_name', { ascending: true })
    .order('first_name', { ascending: true })
    .range(from, from + PAGE_SIZE - 1);

  if (role) query = query.eq('role', role);
  if (grade !== undefined) query = query.eq('grade_level', grade);
  if (status) query = query.eq('status', status);
  if (q) {
    // Commas are PostgREST OR syntax.
    const term = q.replace(/[,]/g, ' ');
    query = query.or(
      `first_name.ilike.%${term}%,last_name.ilike.%${term}%,username.ilike.%${term}%`
    );
  }

  const { data, error, count } = await query;

  if (error) {
    res.status(500).json({ error: 'Database error', message: error.message });
    return;
  }

  res.json({
    data: {
      accounts: data ?? [],
      total: count ?? 0,
      page,
      page_size: PAGE_SIZE,
    },
  });
});

/** GET /api/admin/accounts/:userId: the profile plus email and last sign-in from auth.users. */
router.get('/accounts/:userId', async (req: Request, res: Response): Promise<void> => {
  const { data: account } = await supabaseAdmin
    .from('profiles')
    .select(ACCOUNT_COLUMNS)
    .eq('id', req.params.userId)
    .maybeSingle<AccountRow>();

  if (!account) {
    res.status(404).json({ error: 'Not found', message: 'No such account' });
    return;
  }

  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(account.id);

  res.json({
    data: {
      ...account,
      email: authUser?.user?.email ?? null,
      email_is_placeholder: isPlaceholderEmail(authUser?.user?.email),
      /** Wider than the placeholder flag; the UI displays by this one. */
      email_can_receive: canReceiveMail(authUser?.user?.email),
      last_sign_in_at: authUser?.user?.last_sign_in_at ?? null,
    },
  });
});

/**
 * POST /api/admin/username-suggestion: a currently free username for a name.
 * An enumeration oracle, safe only behind the admin role. Never reuse it for sign-up.
 */
router.post('/username-suggestion', async (req: Request, res: Response): Promise<void> => {
  const parsed = SuggestUsernameSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const username = await suggestUsername(parsed.data.first_name, parsed.data.last_name);

  if (!username) {
    res.status(400).json({
      error: 'Could not build a username',
      message: 'That name has no letters or numbers to build from — type a username instead',
    });
    return;
  }

  res.json({ data: { username } });
});

/**
 * POST /api/admin/import/precheck: which usernames/emails already exist, flagged before import.
 * Admin-only oracle. A courtesy, not the guarantee; the unique indexes and per-row 409 still apply.
 */
router.post('/import/precheck', async (req: Request, res: Response): Promise<void> => {
  const parsed = ImportPrecheckSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  // Usernames are always lowercase, so a plain `.in()` is case-insensitive in effect.
  const wantedUsernames = [...new Set(parsed.data.usernames)];
  const taken_usernames: string[] = [];

  for (let i = 0; i < wantedUsernames.length; i += USERNAME_CHECK_CHUNK) {
    const chunk = wantedUsernames.slice(i, i + USERNAME_CHECK_CHUNK);
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('username')
      .in('username', chunk);

    if (error) {
      res.status(500).json({ error: 'Database error', message: error.message });
      return;
    }
    for (const row of data ?? []) {
      if (row.username) taken_usernames.push(row.username);
    }
  }

  let taken_emails: string[];
  try {
    taken_emails = [...(await emailOwners(new Set(parsed.data.emails))).keys()];
  } catch (err) {
    res.status(500).json({
      error: 'Auth error',
      message: err instanceof Error ? err.message : 'Could not check the addresses',
    });
    return;
  }

  res.json({ data: { taken_usernames, taken_emails } });
});

/** POST /api/admin/accounts. The response carries the password once; it can only be reset later. */
router.post('/accounts', async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const result = await createAccount(parsed.data);
  if (result.error) {
    res
      .status(result.error.status)
      .json({ error: 'Could not create account', message: result.error.message });
    return;
  }

  res.status(201).json({
    data: {
      ...result.account,
      email: result.email,
      email_is_placeholder: isPlaceholderEmail(result.email),
      /** Shown to the admin exactly once. */
      password: result.password,
      password_was_generated: parsed.data.password === undefined,
    },
    message: 'Account created',
  });
});

/**
 * Address → owner id for the wanted addresses. auth.users isn't reachable via PostgREST and the SDK
 * has no getUserByEmail, so this pages listUsers(). Run only on explicit admin actions. Throws on failure.
 */
async function emailOwners(wanted: Set<string>): Promise<Map<string, string>> {
  const owners = new Map<string, string>();
  if (wanted.size === 0) return owners;

  for (let page = 1; page <= AUTH_MAX_PAGES; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: AUTH_PAGE_SIZE,
    });
    if (error) throw new Error(error.message);

    const users = data?.users ?? [];
    for (const user of users) {
      const email = user.email?.toLowerCase();
      if (email && wanted.has(email)) owners.set(email, user.id);
    }
    // A short page is the last page.
    if (users.length < AUTH_PAGE_SIZE) break;
  }

  return owners;
}

/**
 * PATCH /api/admin/accounts/:userId: names, username, role, grade.
 * UpdateAccountSchema is the only guard against role escalation (the trigger is inert here).
 */
router.patch('/accounts/:userId', async (req: Request, res: Response): Promise<void> => {
  const parsed = UpdateAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const targetId = req.params.userId;
  const patch = parsed.data;

  const { data: current } = await supabaseAdmin
    .from('profiles')
    .select(ACCOUNT_COLUMNS)
    .eq('id', targetId)
    .maybeSingle<AccountRow>();

  if (!current) {
    res.status(404).json({ error: 'Not found', message: 'No such account' });
    return;
  }

  // Self-lockout guard: there is one admin account.
  if (patch.role && targetId === req.user!.id) {
    res.status(400).json({
      error: 'Not allowed',
      message: 'You cannot change your own role',
    });
    return;
  }

  // An existing admin's role can't be changed here (checks the target's current role).
  if (patch.role && current.role === 'admin') {
    res.status(400).json({
      error: 'Not allowed',
      message: 'An administrator account cannot be given a different role here',
    });
    return;
  }

  // Check the resolved role/grade pair (profiles_student_needs_grade); Zod can't see the current row.
  const nextRole = patch.role ?? current.role;
  const nextGrade =
    patch.grade_level !== undefined ? patch.grade_level : current.grade_level;

  if (nextRole === 'student' && nextGrade === null) {
    res.status(400).json({
      error: 'Validation error',
      message: 'A student needs a grade level — set one in the same change',
    });
    return;
  }

  // Student → educator clears the grade.
  const clearGrade = nextRole !== 'student' && nextGrade !== null;

  if (patch.username && (await usernameTaken(patch.username, targetId))) {
    res.status(409).json({
      error: 'Username taken',
      message: `The username "${patch.username}" is already taken`,
    });
    return;
  }

  const { data: updated, error } = await supabaseAdmin
    .from('profiles')
    .update({
      ...patch,
      ...(clearGrade ? { grade_level: null } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', targetId)
    .select(ACCOUNT_COLUMNS)
    .single<AccountRow>();

  if (error || !updated) {
    const taken = error?.code === UNIQUE_VIOLATION;
    res.status(taken ? 409 : 500).json({
      error: taken ? 'Username taken' : 'Database error',
      message: taken ? 'That username was claimed a moment ago' : (error?.message ?? 'Update failed'),
    });
    return;
  }

  res.json({ data: updated, message: 'Account updated' });
});

/**
 * POST /api/admin/accounts/:userId/status: enable/disable, in place of deletion.
 * Takes effect on the next request (requireRole re-reads status). Fully reversible.
 */
router.post('/accounts/:userId/status', async (req: Request, res: Response): Promise<void> => {
  const parsed = SetAccountStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const targetId = req.params.userId;

  // Self-lockout guard.
  if (targetId === req.user!.id) {
    res.status(400).json({
      error: 'Not allowed',
      message: 'You cannot change your own account status',
    });
    return;
  }

  const { data: updated, error } = await supabaseAdmin
    .from('profiles')
    .update({ status: parsed.data.status, updated_at: new Date().toISOString() })
    .eq('id', targetId)
    .select(ACCOUNT_COLUMNS)
    .single<AccountRow>();

  if (error || !updated) {
    res.status(error ? 500 : 404).json({
      error: error ? 'Database error' : 'Not found',
      message: error?.message ?? 'No such account',
    });
    return;
  }

  res.json({
    data: updated,
    message: parsed.data.status === 'disabled' ? 'Account disabled' : 'Account enabled',
  });
});

/**
 * POST /api/admin/accounts/:userId/password: the recovery path that always works; never remove it.
 * Re-arms must_change_password. Open sessions are revoked only because `authenticate` checks tokens
 * with the auth server; verifying JWTs locally would break that.
 */
router.post('/accounts/:userId/password', async (req: Request, res: Response): Promise<void> => {
  const parsed = ResetAccountPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const { data: account } = await supabaseAdmin
    .from('profiles')
    .select('id, username')
    .eq('id', req.params.userId)
    .maybeSingle();

  if (!account) {
    res.status(404).json({ error: 'Not found', message: 'No such account' });
    return;
  }

  const { error } = await supabaseAdmin.auth.admin.updateUserById(account.id, {
    password: parsed.data.new_password,
  });

  if (error) {
    res.status(400).json({ error: 'Could not reset password', message: error.message });
    return;
  }

  // Re-arm the activation gate (the admin knows this password). After the reset, never before.
  const { error: flagError } = await supabaseAdmin
    .from('profiles')
    .update({ must_change_password: true, updated_at: new Date().toISOString() })
    .eq('id', account.id);

  if (flagError) {
    console.error('[admin] password reset but the activation flag was not set', flagError.message);
  }

  res.json({
    data: {
      id: account.id,
      username: account.username,
      /** False means the gate wasn't re-armed. */
      must_change_password: !flagError,
    },
    message: 'Password reset',
  });
});

/**
 * POST /api/admin/accounts/:userId/email: replace an account's contact address (e.g. a placeholder).
 * Applies immediately with no code. Email isn't a credential, so no gate re-arm or session revoke.
 */
router.post('/accounts/:userId/email', async (req: Request, res: Response): Promise<void> => {
  const parsed = SetAccountEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const { data: account } = await supabaseAdmin
    .from('profiles')
    .select('id, username')
    .eq('id', req.params.userId)
    .maybeSingle();

  if (!account) {
    res.status(404).json({ error: 'Not found', message: 'No such account' });
    return;
  }

  const { data: updated, error } = await supabaseAdmin.auth.admin.updateUserById(account.id, {
    email: parsed.data.email,
    email_confirm: true,
  });

  if (error) {
    // updateUserById reports a duplicate as an opaque `{}` error, so don't string-match it:
    // ask who owns the address instead (failure path only).
    let owner: string | undefined;
    try {
      owner = (await emailOwners(new Set([parsed.data.email]))).get(parsed.data.email);
    } catch {
      // Diagnosis only; a failed sweep doesn't change the outcome.
    }

    if (owner && owner !== account.id) {
      res.status(409).json({
        error: 'Email taken',
        message: 'That email address already belongs to another account',
      });
      return;
    }

    // Show a readable upstream message; never the opaque `{}`.
    const detail = (error.message ?? '').trim();
    const readable = detail && detail !== '{}';
    res.status(readable ? 400 : 500).json({
      error: 'Could not change email',
      message: readable ? detail : 'That email address could not be applied. Please try again.',
    });
    return;
  }

  // From the updated user, not the request body.
  const email = updated?.user?.email ?? parsed.data.email;

  res.json({
    data: {
      id: account.id,
      email,
      email_is_placeholder: isPlaceholderEmail(email),
      email_can_receive: canReceiveMail(email),
    },
    message: 'Email updated',
  });
});

/**
 * POST /api/admin/accounts/import: bulk creation through createAccount().
 * Sequential, never Promise.all (Supabase rate-limits the auth admin API by IP). Rows report individually.
 */
router.post('/accounts/import', async (req: Request, res: Response): Promise<void> => {
  const parsed = ImportAccountsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  // Names are part of each result so the client never matches rows by index (rows can drop out).
  const results: Array<{
    row: number;
    username: string;
    first_name: string;
    last_name: string;
    ok: boolean;
    message?: string;
    password?: string;
    id?: string;
  }> = [];

  // Usernames claimed earlier in this batch but not yet written.
  const claimed = new Set<string>();
  for (const row of parsed.data.rows) {
    if (row.username) claimed.add(row.username.toLowerCase());
  }

  for (const [index, row] of parsed.data.rows.entries()) {
    // A blank username is generated from the name.
    let account = row;
    if (!row.username) {
      const generated = await suggestUsername(row.first_name, row.last_name, claimed);
      if (!generated) {
        results.push({
          row: index + 1,
          username: '',
          first_name: row.first_name,
          last_name: row.last_name,
          ok: false,
          message: 'Could not build a username from this name — add one to the file',
        });
        continue;
      }
      claimed.add(generated);
      account = { ...row, username: generated };
    }

    const result = await createAccount(account);
    // account.username, not row.username, which is blank when generated.
    results.push(
      result.error
        ? {
            row: index + 1,
            username: account.username,
            first_name: row.first_name,
            last_name: row.last_name,
            ok: false,
            message: result.error.message,
          }
        : {
            row: index + 1,
            username: account.username,
            // From the re-read row, not the request body.
            first_name: result.account!.first_name,
            last_name: result.account!.last_name,
            ok: true,
            id: result.account!.id,
            password: result.password,
          }
    );
  }

  const created = results.filter((r) => r.ok).length;

  res.status(created > 0 ? 201 : 400).json({
    data: { results, created, failed: results.length - created },
    message: `${created} of ${results.length} accounts created`,
  });
});

export default router;
