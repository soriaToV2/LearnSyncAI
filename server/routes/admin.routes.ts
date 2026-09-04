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
 * ═══════════════════════════════════════════════════════════════════════════
 * ADMIN — ACCOUNT ADMINISTRATION, AND NOTHING ELSE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Four independent sources scope this role identically — `ARCHITECTURE.md:14`,
 * `README.md:182-191`, `CLAUDE.md:14` and `schema.sql:13`: create, edit and
 * disable accounts for educators and students, and **no learning content, study
 * activities or analytics**. There is precedent for holding that line: an
 * `educator_assignments` table (admin assigns teachers their subjects and grades)
 * was built and then removed as going *"beyond the specification, which scopes
 * the admin to 'creating, editing, disabling accounts'"*.
 *
 * So nothing in this file reads `materials`, `concepts`, `bkt_mastery` or any
 * other learning table. The only tables it touches are `profiles` and, through
 * the Supabase admin API, `auth.users`.
 *
 * ⚠️ THERE IS NO DELETE ROUTE, AND ONE MUST NOT BE ADDED CASUALLY.
 * Thirteen tables CASCADE from `profiles` — `study_spaces`, `bkt_mastery`,
 * `bkt_update_logs`, `practice_tests`, `practice_telemetry`, `cognitive_logs`,
 * `chatbot_logs`, `spaced_repetition_logs`, `gamification_profiles`,
 * `game_content`, `game_sessions`, `user_badges`, `activity_logs`. Deleting one
 * student destroys their entire measured history irrecoverably, which for a
 * 50-student study is the research data itself. `schema.sql` states the intended
 * idiom on the column: *"Set to disabled by an admin to revoke access without
 * deleting the account."* `POST /accounts/:userId/status` is that mechanism, and
 * it is already honoured by `requireRole`, `POST /api/auth/login`,
 * `private.auth_role()` and `rosterForGrades()`.
 *
 * (Deletion is also the one operation the schema fights: `materials.educator_id`
 * is `ON DELETE RESTRICT`, the only non-CASCADE FK in the database, so deleting a
 * publishing educator fails as an opaque Supabase Auth error rather than a
 * readable refusal.)
 */

const router = Router();

router.use(authenticate, requireRole('admin'));

/**
 * Mirrors `PROFILE_COLUMNS` in auth.routes.ts. Explicit so the client can type
 * against it.
 *
 * ⚠️ `must_change_password` IS LOAD-BEARING HERE AND WAS MISSING ONCE.
 * `accountState()` on the client derives the "Not activated" pill from it, and an
 * absent field reads as `false` — so every account in the list showed **Active**
 * however freshly created, while the dashboard (which selects the column in its
 * own query) counted them correctly. Two screens quietly disagreeing.
 *
 * A column added to `profiles` that any screen renders must be added here too;
 * the list, the detail view and both writers all serialise through this string.
 */
const ACCOUNT_COLUMNS =
  'id, role, username, first_name, last_name, grade_level, status, must_change_password, created_at, updated_at';

/** Raised by `ux_profiles_username_lower`; case-insensitive, so `Juan` collides with `juan`. */
const UNIQUE_VIOLATION = '23505';

const PAGE_SIZE = 25;

/**
 * Ids per `.in()` list in `POST /import/precheck`, matching the 200 the mastery
 * readers chunk at. The list goes into the query string, so an unbounded one is
 * how that URL gets too long.
 */
const USERNAME_CHECK_CHUNK = 200;

/**
 * Paging for `emailOwners()` below — the only thing that still sweeps
 * `auth.users`, because addresses are not reachable any other way.
 * A school fits in a single page; the cap is a runaway guard, not a limit.
 */
const AUTH_PAGE_SIZE = 1000;
const AUTH_MAX_PAGES = 20;

/*
 * The placeholder-address helpers moved to `../lib/placeholderEmail` when the
 * self-service profile page needed the same "is this real?" test — see that file
 * for why `.invalid` and why only bulk import produces them now.
 */

/**
 * ⚠️ A PASSWORD AN ADMINISTRATOR READS ALOUD TO A CLASS — `brave-otter-93`.
 *
 * This replaced a random 10-character string (`xK7mPq2Rtv`) which was strictly
 * stronger and unusable in practice: it cannot be dictated to a room of Grade 7
 * students, and every transcription error is indistinguishable from a forgotten
 * password. The proposal it heads off was making the password equal the username,
 * which would mean anyone who knows a student's NAME can sign in as them, since
 * usernames here are generated from names.
 *
 * THE ENTROPY TRADE, STATED HONESTLY:
 *
 *   username-as-password   1 guess
 *   this generator         ~128 x 128 x 90  =  ~1.5 million
 *   the 10-char random     ~55^10           =  ~2.5 x 10^17
 *
 * ⚠️ 1.5 million is only acceptable because of the two things that now surround
 * it, and IT MUST BE REVERTED IF EITHER IS REMOVED:
 *   1. the password is SINGLE-USE — `must_change_password` forces a replacement
 *      at first login, so it protects one sign-in, not an account for a year;
 *   2. Supabase rate-limits sign-in attempts by source IP, so an online guessing
 *      run against 1.5 million candidates is not available.
 *
 * The word lists are chosen so no pairing reads as an insult — these are printed
 * and handed to children.
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

/** Uniform over `max`, rejecting the biased tail — `% max` favours low values. */
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
  // 10-99, so the length never varies and there is no leading zero to lose.
  const number = 10 + randomBelow(90);
  return `${adjective}-${noun}-${number}`;
}


/**
 * Is this username already taken? Case-insensitive, matching the unique index.
 *
 * This is the *friendly* path only — it answers 409 before anything is written.
 * It is NOT the guarantee: two admins importing at once can both pass it. The
 * unique index is the real arbiter and `createAccount()` below handles losing
 * that race.
 */
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

/**
 * The outcome of one creation attempt.
 *
 * `error` is always present and nullable rather than this being a discriminated
 * union on an `ok` flag: `tsconfig.json` does not enable `strict`, so a
 * `{ ok: true } | { ok: false }` union does not narrow at the call site and every
 * field access is an error. Checking `if (outcome.error)` needs no narrowing at
 * all.
 */
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
 * Create one account, end to end.
 *
 * ⚠️ THE VERIFY STEP IS NOT OPTIONAL, AND IT IS WHY THIS IS A FUNCTION.
 *
 * `handle_new_user()` fires on the `auth.users` INSERT and takes the username
 * from `raw_user_meta_data`. When that username is malformed or already taken it
 * **degrades to NULL rather than raising** — deliberately, because an exception
 * inside that trigger aborts the INSERT and surfaces as an opaque Supabase Auth
 * failure. The consequence here is that the naive implementation reports
 * "Account created" for an account that **cannot sign in at all**, with no error
 * anywhere.
 *
 * So: pre-check (friendly 409, nothing written) → create → **re-read the row and
 * confirm the username actually stuck** → on NULL, one targeted UPDATE, whose
 * `23505` is the authoritative answer → on collision, delete the auth user and
 * report the conflict rather than leaving an unusable account behind.
 *
 * The returned row is the re-read one. Never build a response from the request
 * body here: the body is what was asked for, the row is what happened.
 */
async function createAccount(input: CreateAccountInput): Promise<CreateOutcome> {
  const { role, first_name, last_name, username, grade_level } = input;

  if (await usernameTaken(username)) {
    return fail(409, `The username "${username}" is already taken`);
  }

  const password = input.password ?? generatePassword();
  /*
   * ⚠️ THE FALLBACK IS REACHABLE ONLY FROM BULK IMPORT NOW.
   * `CreateAccountSchema` requires an email, so the single-account form always
   * supplies one; `ImportAccountRowSchema` leaves it optional, because a CSV of
   * fifty students may be prepared before fifty addresses have been collected.
   */
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
      /*
       * ⚠️ EVERY ACCOUNT BORN HERE IS BORN UN-ACTIVATED, whether the password was
       * generated or typed by the admin — in both cases the admin knows it, and
       * for a bulk import so does everyone who saw the credentials table.
       *
       * Passed through metadata so `handle_new_user()` writes it in the same
       * INSERT as the rest of the row. A follow-up UPDATE from here would leave a
       * window in which the account exists, is usable, and is not gated.
       */
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

  // The trigger has already inserted `profiles` (and `gamification_profiles` for
  // a student). Read it back — this is the verification step described above.
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
    // Lost the race, or the trigger disagreed with us about the format. One
    // attempt against the unique index settles which.
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

/**
 * GET /api/admin/overview
 *
 * The counts on the admin dashboard. Accepts NOTHING — no body, no query, no path
 * parameter — so it has zero IDOR surface and needs no Zod schema, the same bar
 * `GET /api/dashboard` and `GET /api/educator/overview` are held to.
 *
 * ⚠️ ACCOUNTS ONLY. No mastery, no scores, no material counts — see the scope
 * note at the top of this file. Every figure here is a count of rows in
 * `profiles`, plus one fact from `auth.users` (see below).
 */
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

  /*
   * ⚠️ THIS ROUTE NO LONGER TOUCHES `auth.users` AT ALL.
   *
   * It used to page `listUsers()` (50 per call) purely to compute "never signed
   * in" from `last_sign_in_at`. `must_change_password` answers a better question
   * from a plain column: "never signed in" only says the app was not opened,
   * whereas "not activated" says the holder has not taken ownership of the
   * account — which is the thing an admin acts on, and a superset of the other.
   *
   * `last_sign_in_at` is still shown on the account detail page, where it is one
   * `getUserById` for one account rather than a paged sweep of the directory.
   */
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
      /** Students per grade, 7–10. Educators and admins have no grade by constraint. */
      by_grade: [7, 8, 9, 10].map((grade) => ({
        grade,
        count: students.filter((s) => s.grade_level === grade).length,
      })),
      /*
       * The operational signals, mirroring the educator dashboard's `attention`:
       * a list the UI renders only when non-empty. A permanent "all clear" card is
       * a widget that reports nothing.
       */
      attention: {
        /** `username IS NULL` — the `handle_new_user()` degradation. These accounts cannot log in. */
        cannot_sign_in: cannotSignIn.length,
        /**
         * Created and handed out, but the holder has not replaced the password the
         * administrator set — so it is still known to more people than its owner.
         */
        not_activated: notActivated.length,
        disabled: all.filter((r) => r.status === 'disabled').length,
      },
    },
  });
});

/**
 * GET /api/admin/accounts
 *
 * The account list. Filters map onto `idx_profiles_role_grade`, which already
 * exists.
 *
 * ⚠️ DELIBERATELY DOES NOT FETCH EMAILS. `profiles` has no email column, so one
 * would cost a `getUserById` per row — 50+ round trips to render a list whose
 * identifier is the username anyway. The detail route below fetches exactly one.
 */
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
    // Commas separate the OR terms in PostgREST, so a comma in the search string
    // would be read as syntax. Nothing else here is a metacharacter for `ilike`.
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

/**
 * GET /api/admin/accounts/:userId
 *
 * One account, plus the two facts that live on `auth.users` rather than
 * `profiles`: the contact email and `last_sign_in_at`.
 *
 * A user id in the path is correct HERE and is not the pattern `GET /api/dashboard`
 * and `GET /api/educator/overview` avoid. Those derive everything from
 * `req.user!.id` because a *student's* id in a URL is an IDOR surface for a
 * student-facing route. Administering every account is this role's entire job;
 * `requireRole('admin')` is the authorisation, and there is nothing narrower to
 * scope to.
 */
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
      /** True when the address is a `.invalid` placeholder — the client shows "None". */
      email_is_placeholder: isPlaceholderEmail(authUser?.user?.email),
      /**
       * ⚠️ WIDER, AND IT IS THIS ONE THE UI PRINTS BY. The flag above is false for
       * `admin` and `educ1`, whose addresses are bare words left behind by
       * migration 0021 — so keying the display off it showed an administrator the
       * word `admin` as their own contact address. It also decides whether this
       * account could recover its own password by email.
       */
      email_can_receive: canReceiveMail(authUser?.user?.email),
      last_sign_in_at: authUser?.user?.last_sign_in_at ?? null,
    },
  });
});

/**
 * POST /api/admin/username-suggestion
 *
 * `{ first_name, last_name }` → `{ username }`, guaranteed free at the moment of
 * the call. Backs the Generate button beside the username field.
 *
 * ⚠️ THIS IS THE ENDPOINT THE CODEBASE DELIBERATELY DOES NOT HAVE, AND IT IS SAFE
 * ONLY BECAUSE OF `requireRole('admin')` ABOVE. A username-availability check that
 * an unauthenticated caller could reach is an enumeration oracle: someone could
 * work through plausible Filipino names and learn which children attend this one
 * named school. That is the same reasoning that makes `POST /api/auth/login`
 * return one identical message for every failure, and why no such lookup exists
 * for the sign-up page.
 *
 * An administrator can already read the entire account list, so this discloses
 * nothing they cannot see by scrolling. **If anyone ever proposes reusing it for
 * self-registration, that reasoning collapses — do not move it out from behind
 * the admin role.**
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
 * POST /api/admin/import/precheck
 *
 * `{ usernames, emails }` → `{ taken_usernames, taken_emails }`. Backs the
 * bulk-import review screen, so anything already belonging to an account is
 * flagged beside the row's other problems **before** anything is written.
 *
 * ⚠️ SAME ENUMERATION ORACLE AS `/username-suggestion` ABOVE, SAFE FOR THE SAME
 * REASON AND ONLY THAT REASON — `requireRole('admin')`. See that route's JSDoc;
 * everything it says applies here, and the email half is worse if ever leaked
 * because it confirms a real address for a named child.
 *
 * ⚠️ THIS IS A COURTESY, NOT THE GUARANTEE. Two admins importing overlapping
 * files can both pass it, and an account can be created in the seconds between
 * this call and the import. `usernameTaken()` inside `createAccount()`, the
 * `ux_profiles_username_lower` unique index and Supabase's own
 * `users_email_partial_key` remain the real arbiters, and the per-row 409 stays
 * reachable. What this buys is that the *common* case — a file re-uploaded after
 * a partial import, or siblings sharing a parent's address — is caught on the
 * review screen instead of halfway through creating a class.
 *
 * Both halves in one call: they are needed at the same instant for the same
 * decision, and splitting them would let one succeed while the other failed.
 */
router.post('/import/precheck', async (req: Request, res: Response): Promise<void> => {
  const parsed = ImportPrecheckSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  /*
   * Usernames live on `profiles`, so this is a plain lookup.
   * `profiles_username_format` permits lowercase only and `UsernameField`
   * lowercases before validating, so `.in()` is already case-insensitive in
   * effect and needs no `ilike` fan-out. Chunked at the same 200 the mastery
   * readers use — the list goes into the query string, and an unbounded one is
   * how that URL gets too long.
   */
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

  // The sweep lives in `emailOwners()` — see there for why `auth.users` can only
  // be reached this way. This caller wants the addresses, not who holds them.
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

/**
 * POST /api/admin/accounts
 *
 * Create one student or educator. The response carries the password **once** —
 * it is not stored anywhere in readable form and cannot be retrieved later, only
 * reset.
 */
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
 * Which of these addresses already belong to an account, and to whom.
 *
 * ⚠️ THE ONLY ROUTE TO THIS FACT. Addresses live on `auth.users`, which is not
 * reachable through PostgREST — there is no `.from('users')` for it and no
 * `getUserByEmail` in the admin SDK — so paging `listUsers()` and intersecting in
 * memory is the whole available mechanism.
 *
 * `GET /overview` deliberately STOPPED doing this, and that is not a
 * contradiction: it swept every page on every dashboard load to answer a question
 * a plain column read answered better. Both callers here need a fact that has no
 * other source, and each runs once, on an explicit admin action — a file upload,
 * or classifying a failed email change.
 *
 * At 1000 per page a school is one request. The page cap is a runaway guard, not
 * an expected limit. Throws on a sweep failure; both callers decide what that
 * means for them.
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
    // A short page is the last page. Without this the loop always runs the cap.
    if (users.length < AUTH_PAGE_SIZE) break;
  }

  return owners;
}

/**
 * PATCH /api/admin/accounts/:userId
 *
 * Names, username, role and grade level. `status` has its own route; password has
 * its own route.
 *
 * ⚠️ `UpdateAccountSchema` IS THE ONLY THING STOPPING A ROLE ESCALATION HERE.
 * `enforce_profile_immutables()` looks like a second line of defence and is not —
 * `auth.uid()` is NULL for the service role Express holds, so the trigger returns
 * early for every request that reaches this file.
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

  /*
   * ⚠️ SELF-LOCKOUT GUARD. There is exactly one admin account on this deployment.
   * An admin who changed their own role would lock every administrator out of the
   * system permanently, with no way back short of the Supabase dashboard.
   */
  if (patch.role && targetId === req.user!.id) {
    res.status(400).json({
      error: 'Not allowed',
      message: 'You cannot change your own role',
    });
    return;
  }

  /*
   * An existing admin is not demotable through this portal either — `role` is
   * typed `student | educator`, so this is the *target's* current role, not the
   * requested one. Editing another admin's name is fine; changing what they are
   * is not something a peer should do from a web form.
   */
  if (patch.role && current.role === 'admin') {
    res.status(400).json({
      error: 'Not allowed',
      message: 'An administrator account cannot be given a different role here',
    });
    return;
  }

  /*
   * ⚠️ ROLE AND GRADE MOVE TOGETHER, AND THE SCHEMA CANNOT SEE THE WHOLE RULE.
   *
   * `profiles_student_needs_grade` is `CHECK (role <> 'student' OR grade_level IS
   * NOT NULL)`. A partial PATCH does not know the resulting role without the row,
   * so Zod validates what it can (role+grade sent together) and the resolved pair
   * is checked here. Without this a `{ role: 'student' }` on an educator reaches
   * Postgres and comes back as a raw constraint name.
   */
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

  // An educator carrying a stale grade renders as "Grade 9" in the sidebar via
  // `subtitleFor()`, so student → educator clears it rather than leaving it.
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
 * POST /api/admin/accounts/:userId/status
 *
 * Enable or disable. This is the portal's replacement for deletion, and the
 * reason there is no delete route — see the file header.
 *
 * Disabling takes effect **immediately and completely**: `requireRole` re-reads
 * `status` on every single request, so a live JWT stops working at once, and
 * `POST /api/auth/login` refuses a new session with the same generic message
 * every other failure returns. Nothing is destroyed — re-enabling restores the
 * account exactly as it was, with every study space and mastery row intact.
 */
router.post('/accounts/:userId/status', async (req: Request, res: Response): Promise<void> => {
  const parsed = SetAccountStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const targetId = req.params.userId;

  /*
   * ⚠️ SELF-LOCKOUT GUARD — the other half of the one in PATCH above. An admin
   * disabling themselves is locked out by `requireRole` on their very next
   * request, including the request that would undo it.
   */
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
 * POST /api/admin/accounts/:userId/password
 *
 * ⚠️ THIS IS THE PASSWORD-RECOVERY PATH THAT ALWAYS WORKS — TIER 2 OF TWO, AND
 * THE ONE THAT NEVER FAILS TO BE AVAILABLE.
 *
 * `POST /api/auth/forgot-password` now covers accounts that have a deliverable
 * address on file, but that is opt-in and most accounts do not: CSV import leaves
 * the email column optional and generates a `@pca.invalid` placeholder, and the
 * accounts predating migration 0021 hold bare words (`admin`, `educ1`). For every
 * one of those, this route is still the only way back in — so it must never be
 * removed on the grounds that self-service reset exists.
 *
 * ⚠️ IT RE-ARMS `must_change_password`; THE SELF-SERVICE RESET CLEARS IT. The rule
 * is who has seen the password. An admin choosing one has seen it — and after a
 * bulk import so has everyone who saw the credentials table — so the holder must
 * replace it. A student who set their own through a mailed code has not exposed
 * it to anybody, so the gate is already satisfied.
 *
 * It takes no current password: the admin is not the account holder and cannot
 * know it. `requireRole('admin')` is the authorisation — which is precisely why
 * the self-lockout guards above matter.
 *
 * ✅ IT DOES REVOKE THE TARGET'S OPEN SESSIONS. Measured 2026-08-15 against this
 * project: after `updateUserById({ password })`, an access token issued moments
 * earlier answers **401**, and its refresh token is rejected outright with
 * "Refresh Token Not Found". So a reset genuinely locks out a device the student
 * left signed in, and the UI says so.
 *
 * ⚠️ THAT PROPERTY DEPENDS ON `authenticate` CALLING `supabaseAdmin.auth.getUser(token)`.
 * That is a round trip to the auth server, not a local signature check, which is
 * what lets a revoked session be noticed at all. Verifying the JWT locally is the
 * obvious way to save a hop off every request — and doing so would silently turn
 * every already-open session into one that survives a password reset until it
 * expires. Do not make that change without revisiting this route and the copy on
 * the account page.
 *
 * `supabaseAdmin.auth.admin.signOut(jwt, scope)` is NOT usable here regardless:
 * it identifies sessions by JWT and we hold the admin's, not the target's.
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

  /*
   * ⚠️ RE-ARM THE ACTIVATION GATE. The admin just chose this password and knows
   * it, which is the same condition a newly created account is in — so the same
   * rule applies: a password an administrator has seen never stays in use.
   *
   * This is the SECOND of the two call sites that arm the flag (creation is the
   * other). Missing it would mean a forgotten-password reset quietly downgrades
   * an account from "only its owner knows the password" back to "the admin knows
   * it too", permanently.
   *
   * After the reset, never before — see the same ordering note in
   * `POST /api/auth/change-password`.
   */
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
      /** False means the reset password will be usable indefinitely — say so. */
      must_change_password: !flagError,
    },
    message: 'Password reset',
  });
});

/**
 * POST /api/admin/accounts/:userId/email
 *
 * Replace an account's contact address. The fix for an address entered wrongly at
 * creation, and the only way an imported student ever gets off the
 * `<username>@pca.invalid` placeholder that `canReceiveMail()` rejects — without
 * this, such an account can never reach Tier 1 password recovery at all, because
 * `EmailRecoveryBanner` is the only other route to an address and it asks the
 * holder, who cannot see that theirs is undeliverable.
 *
 * ⚠️ IT APPLIES IMMEDIATELY. `admin.updateUserById({ email })` is precisely the
 * call `POST /api/auth/change-email` was rewritten to STOP using, so the contrast
 * matters: that route is driven by whoever holds a live session, which on a shared
 * school computer is not proof of anything, so it proves the destination with a
 * mailed code. This route is driven by `requireRole('admin')`, and an admin can
 * satisfy neither proof for somebody else — no password, no mailbox. It also grants
 * them nothing new, since the same role already holds
 * `POST /accounts/:userId/password`. See `SetAccountEmailSchema`.
 *
 * ⚠️ SERVICE-ROLE ADMIN API, SO THE "Secure email change" DASHBOARD SETTING DOES
 * NOT APPLY. That setting governs the user-scoped `updateUser({ email })` the
 * self-service route uses; this one mails nothing and needs no confirmation from
 * either address. `email_confirm: true` for the same reason `createUser()` sets it
 * above — no SMTP is configured, so an unconfirmed address could never be confirmed.
 *
 * It deliberately does NOT re-arm `must_change_password` and does NOT revoke
 * sessions: an email is not a credential on this platform. Sign-in is unaffected —
 * `POST /api/auth/login` re-resolves `username -> profiles.id -> getUserById` on
 * every request, so the student keeps the username and password they already have.
 * The `email` claim in an already-issued JWT goes stale until it refreshes; nothing
 * authorises on it.
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
    /*
     * ⚠️ `updateUserById` REPORTS A DUPLICATE ADDRESS AS AN OPAQUE 500, AND THERE
     * IS NOTHING IN IT TO PARSE. Measured against this project 2026-09-04: an
     * `AuthRetryableFetchError` whose `message` is the literal two-character
     * string `{}`, with no `code` and no body — quite unlike `createUser`, which
     * says "already been registered" and is why `createAccount()` and
     * `POST /api/auth/change-email` can both string-match their collisions.
     * Copying that match here compiles, reads correctly, and silently reports
     * every duplicate as a generic 400.
     *
     * So the collision is classified by ASKING who owns the address instead of by
     * reading the answer. Only on the failure path — the happy path stays a single
     * call and never sweeps.
     */
    let owner: string | undefined;
    try {
      owner = (await emailOwners(new Set([parsed.data.email]))).get(parsed.data.email);
    } catch {
      // Diagnosis, not the operation. A failed sweep must not change what is
      // reported about a write that has already failed.
    }

    if (owner && owner !== account.id) {
      res.status(409).json({
        error: 'Email taken',
        message: 'That email address already belongs to another account',
      });
      return;
    }

    /*
     * A readable upstream complaint is about the address itself, so it is the
     * admin's to see and act on. The opaque `{}` is not — it would render as
     * literal braces on the account page.
     */
    const detail = (error.message ?? '').trim();
    const readable = detail && detail !== '{}';
    res.status(readable ? 400 : 500).json({
      error: 'Could not change email',
      message: readable ? detail : 'That email address could not be applied. Please try again.',
    });
    return;
  }

  // Read the address back off the updated user, not the request body — the same
  // "row, not what was asked for" rule `createAccount()` follows.
  const email = updated?.user?.email ?? parsed.data.email;

  res.json({
    data: {
      id: account.id,
      email,
      email_is_placeholder: isPlaceholderEmail(email),
      /** The one the UI prints by — see `lib/placeholderEmail.ts`. */
      email_can_receive: canReceiveMail(email),
    },
    message: 'Email updated',
  });
});

/**
 * POST /api/admin/accounts/import
 *
 * Bulk creation for the paper's 50-student study — the alternative is fifty trips
 * through one form.
 *
 * Every row goes through the same `createAccount()` as the single-account route,
 * so a bulk-created account is subject to identical rules; in particular a student
 * still cannot be created without a deliberate grade level.
 *
 * ⚠️ SEQUENTIAL, NOT `Promise.all`. Supabase rate-limits the auth admin API by
 * source IP, and every one of these calls shares the server's — the same
 * constraint already recorded for the login route. Fifty parallel creations is a
 * throttle, not a speed-up.
 *
 * Rows are reported individually rather than the whole import failing: the file
 * is validated up front (including within-file duplicates, in
 * `ImportAccountsSchema`), so a failure this late is a genuine race for a
 * username, and 49 good accounts should not be discarded for it.
 */
router.post('/accounts/import', async (req: Request, res: Response): Promise<void> => {
  const parsed = ImportAccountsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  /*
   * ⚠️ THE NAME IS PART OF THE RESULT, NOT DECORATION. The credentials the admin
   * downloads are handed out to fifty children, and a file of usernames and
   * passwords with no names attached cannot be handed to anyone — there is no way
   * to tell whose row is whose. The client must never re-derive it by index
   * against the request it sent: a row can drop out (a name that yields no
   * username `continue`s below), so the two arrays are not guaranteed to align.
   */
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

  /*
   * Names claimed earlier in THIS batch. `suggestUsername()` checks the database,
   * but rows are created one at a time — so without this, a file containing two
   * students called Maria Santos would be handed `maria.santos` twice and the
   * second row would fail on the unique index halfway through the import.
   */
  const claimed = new Set<string>();
  for (const row of parsed.data.rows) {
    if (row.username) claimed.add(row.username.toLowerCase());
  }

  for (const [index, row] of parsed.data.rows.entries()) {
    /*
     * A blank username column is filled from the name. Fifty students should not
     * need fifty hand-written usernames, and the same rules apply either way —
     * `CreateAccountSchema` has already validated any username that WAS supplied.
     */
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
    // `account.username`, not `row.username` — the latter is blank on any row
    // whose username was generated above, and the admin needs the real one to
    // hand out.
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
            // From the RE-READ profile row, not the request body — the same rule
            // `createAccount()` follows for the username. The body is what was
            // asked for; the row is what exists.
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
