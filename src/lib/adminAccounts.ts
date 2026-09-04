import { api } from './api';

/**
 * The admin portal's data layer — the counterpart of `src/lib/account.ts`, and
 * its deliberate inverse.
 *
 * `account.ts` is what a user may change about THEMSELVES, and it must never
 * grow a `role`, `status` or `grade_level` field because `PATCH /api/auth/me`
 * refuses all three. This module is what an administrator may change about
 * SOMEONE ELSE, so it carries exactly those fields — and the server's
 * `UpdateAccountSchema` is what makes that safe rather than this file.
 *
 * ⚠️ THE ROLES AN ADMIN MAY ASSIGN ARE `student` AND `educator`. Never `admin`:
 * that is the privilege-escalation surface, and `AssignableRole` on the server
 * rejects it regardless of what is sent from here.
 */

/** Roles an admin may assign. `admin` is not one — see above. */
export type AssignableRole = 'student' | 'educator';

/** Roles an account may already have, which is a wider set than the assignable one. */
export type AccountRole = AssignableRole | 'admin';

export type AccountStatus = 'active' | 'disabled';

export interface AdminAccount {
  id: string;
  role: AccountRole;
  /**
   * ⚠️ NULL MEANS THE ACCOUNT CANNOT SIGN IN. `handle_new_user()` degrades a
   * malformed or already-taken username to NULL rather than raising, because an
   * exception in that trigger would abort the account creation entirely. The
   * portal surfaces these as the "Cannot sign in" attention item — fixing one is
   * a username edit.
   */
  username: string | null;
  first_name: string;
  last_name: string;
  /** 7–10 for students; NULL for educators and admins, by DB constraint. */
  grade_level: number | null;
  status: AccountStatus;
  /**
   * ⚠️ TRUE MEANS THE ACCOUNT HAS NOT BEEN ACTIVATED — it still holds the password
   * an administrator set, so more than one person knows it. Every route except
   * `GET /api/auth/me` and `POST /api/auth/change-password` refuses it.
   *
   * This is a SEPARATE FACT from `status`, not a third value of it. An account can
   * be disabled *and* never activated, and one column could not express both —
   * see `accountStateLabel()` below for how the two combine on screen.
   */
  must_change_password: boolean;
  created_at: string;
  updated_at: string;
}

/** One account plus the two facts that live on `auth.users`, not `profiles`. */
export interface AdminAccountDetail extends AdminAccount {
  email: string | null;
  /**
   * True for a generated `<username>@pca.invalid` address. The UI shows "None"
   * rather than printing it — a placeholder must never read as a real contact.
   */
  email_is_placeholder: boolean;
  /**
   * Whether a reset code could actually arrive here. WIDER than the flag above:
   * that one only catches `@pca.invalid`, while this also rejects the bare words
   * (`admin`, `educ1`) migration 0021 left in `auth.users.email`. Print by this.
   */
  email_can_receive: boolean;
  last_sign_in_at: string | null;
}

export interface AccountsPage {
  accounts: AdminAccount[];
  total: number;
  page: number;
  page_size: number;
}

export interface AdminOverview {
  totals: {
    all: number;
    students: number;
    educators: number;
    admins: number;
    active: number;
    disabled: number;
  };
  by_grade: Array<{ grade: number; count: number }>;
  attention: {
    cannot_sign_in: number;
    /**
     * Handed out but never taken ownership of. Replaced `never_signed_in`, which
     * needed a paged sweep of `auth.users` to answer a weaker question — opening
     * the app is not the same as making the password your own.
     */
    not_activated: number;
    disabled: number;
  };
}

export interface NewAccount {
  role: AssignableRole;
  first_name: string;
  last_name: string;
  /**
   * Optional ONLY for a bulk-import row, where the server derives one from the
   * name. The create form always sends it — it has a Generate button.
   */
  username?: string;
  /** Required for a student, and must be absent for an educator. */
  grade_level?: number | null;
  email?: string;
  password?: string;
}

/** A created account, with the one-time password echoed back. */
export interface CreatedAccount extends AdminAccount {
  email: string;
  email_is_placeholder: boolean;
  /** ⚠️ Shown once. Not stored in readable form anywhere and not retrievable. */
  password: string;
  password_was_generated: boolean;
}

/** What `POST /admin/accounts/:id/email` gives back — the address as stored, re-derived. */
export interface AdminAccountEmail {
  id: string;
  email: string;
  email_is_placeholder: boolean;
  email_can_receive: boolean;
}

export interface AccountFilters {
  role?: AccountRole;
  grade?: number;
  status?: AccountStatus;
  q?: string;
  page?: number;
}

export interface ImportRowResult {
  row: number;
  username: string;
  /**
   * ⚠️ Carried so the downloaded credentials file can say WHOSE account each row
   * is. A list of usernames and passwords with no names attached cannot be handed
   * out — there is no way to tell which child gets which line. Sent by the server
   * rather than matched back by index, because a row can drop out of the results.
   */
  first_name: string;
  last_name: string;
  ok: boolean;
  message?: string;
  password?: string;
  id?: string;
}

export const adminApi = {
  async overview(): Promise<AdminOverview> {
    const res = await api.get<AdminOverview>('/admin/overview');
    return res.data;
  },

  async listAccounts(filters: AccountFilters = {}): Promise<AccountsPage> {
    const params = new URLSearchParams();
    if (filters.role) params.set('role', filters.role);
    if (filters.grade !== undefined) params.set('grade', String(filters.grade));
    if (filters.status) params.set('status', filters.status);
    if (filters.q) params.set('q', filters.q);
    params.set('page', String(filters.page ?? 1));
    const res = await api.get<AccountsPage>(`/admin/accounts?${params.toString()}`);
    return res.data;
  },

  async getAccount(userId: string): Promise<AdminAccountDetail> {
    const res = await api.get<AdminAccountDetail>(`/admin/accounts/${userId}`);
    return res.data;
  },

  async createAccount(body: NewAccount): Promise<CreatedAccount> {
    const res = await api.post<CreatedAccount>('/admin/accounts', body);
    return res.data;
  },

  /**
   * A free username derived from the name — backs the Generate button.
   *
   * ⚠️ Admin-only on the server, and that is what makes it acceptable to exist at
   * all: a username-availability check any visitor could reach would let someone
   * work through plausible names and learn which children attend this school.
   * Never call this from an unauthenticated page.
   */
  async suggestUsername(first_name: string, last_name: string): Promise<string> {
    const res = await api.post<{ username: string }>('/admin/username-suggestion', {
      first_name,
      last_name,
    });
    return res.data.username;
  },

  /**
   * Which of these usernames and addresses already belong to an account? Backs
   * the bulk-import review screen, so a collision with an existing account shows
   * as a row error before anything is written.
   *
   * ⚠️ Admin-only on the server, for the same reason as `suggestUsername()`
   * above: an availability check any visitor could reach is an enumeration oracle
   * against a roll of children at one named school.
   *
   * ⚠️ A COURTESY, NOT A GUARANTEE — an account can appear in the seconds between
   * this call and the import. The per-row checks inside the import route, the
   * username unique index and Supabase's own email unique index are still the
   * real arbiters.
   */
  async precheckImport(
    usernames: string[],
    emails: string[]
  ): Promise<{ takenUsernames: string[]; takenEmails: string[] }> {
    const res = await api.post<{ taken_usernames: string[]; taken_emails: string[] }>(
      '/admin/import/precheck',
      { usernames, emails }
    );
    return { takenUsernames: res.data.taken_usernames, takenEmails: res.data.taken_emails };
  },

  /** Names, username, role and grade. Status and password have their own calls. */
  async updateAccount(
    userId: string,
    body: Partial<Pick<NewAccount, 'first_name' | 'last_name' | 'username' | 'role'>> & {
      grade_level?: number | null;
    }
  ): Promise<AdminAccount> {
    const res = await api.patch<AdminAccount>(`/admin/accounts/${userId}`, body);
    return res.data;
  },

  /**
   * The replacement for deletion. Nothing is destroyed — re-enabling restores the
   * account with every study space and mastery row intact.
   */
  async setStatus(userId: string, status: AccountStatus): Promise<AdminAccount> {
    const res = await api.post<AdminAccount>(`/admin/accounts/${userId}/status`, { status });
    return res.data;
  },

  /**
   * ⚠️ The password-recovery path that always works. `/forgot-password` handles
   * accounts with a deliverable address; this one handles everybody else, which
   * after a CSV import is most of them (`@pca.invalid` placeholders reach nothing).
   *
   * ⚠️ IT RE-ARMS `must_change_password`, unlike a self-service reset, which
   * clears it. The rule is who has seen the password: an admin choosing one has,
   * so the holder must replace it before the account is usable.
   *
   * It DOES sign the account out everywhere: measured, Supabase rejects both the
   * existing access token and its refresh token. That depends on `authenticate`
   * validating each request against the auth server, so see the route's JSDoc
   * before optimising that into a local JWT check.
   */
  async resetPassword(userId: string, newPassword: string): Promise<void> {
    await api.post(`/admin/accounts/${userId}/password`, { new_password: newPassword });
  },

  /**
   * Replace an account's contact address. Its own call, not a field on
   * `updateAccount()`: the address lives on `auth.users` and the profile row on
   * `profiles`, so one request writing both could half-apply.
   *
   * ⚠️ IT APPLIES IMMEDIATELY — unlike the self-service `changeEmail()` in
   * `src/lib/account.ts`, which mails a 6-digit code to the new address and applies
   * nothing until `confirmEmailChange()` redeems it. An admin can prove neither the
   * account (no password) nor the destination (no mailbox), and the addresses most
   * in need of fixing are `@pca.invalid` placeholders that can never receive a code
   * at all. Nothing verifies the address, so the form asks for confirmation before
   * sending it.
   *
   * A 409 means the address already belongs to another account —
   * `users_email_partial_key`, which is also why siblings cannot share one.
   */
  async setEmail(userId: string, email: string): Promise<AdminAccountEmail> {
    const res = await api.post<AdminAccountEmail>(`/admin/accounts/${userId}/email`, { email });
    return res.data;
  },

  async importAccounts(rows: NewAccount[]): Promise<{
    results: ImportRowResult[];
    created: number;
    failed: number;
  }> {
    const res = await api.post<{ results: ImportRowResult[]; created: number; failed: number }>(
      '/admin/accounts/import',
      { rows }
    );
    return res.data;
  },
};

// ── display helpers ─────────────────────────────────────────────────────────

export const ROLE_LABEL: Record<AccountRole, string> = {
  student: 'Student',
  educator: 'Educator',
  admin: 'Admin',
};

/**
 * The one word an admin reads to know where an account stands.
 *
 * ⚠️ THIS IS THE "THIRD STATUS" — DERIVED, NOT STORED. `account_status` remains a
 * two-value enum on purpose: `status` is the access gate, read in roughly nineteen
 * places including every RLS helper, and a third value would mean re-auditing all
 * of them. Keeping activation as its own column also keeps "disabled AND never
 * activated" expressible, which one column could not.
 *
 * Disabled wins over not-activated: an account nobody may use is the more
 * important fact, and its activation state is recoverable when it is re-enabled.
 */
export type AccountState = 'active' | 'not_activated' | 'disabled';

export function accountState(account: AdminAccount): AccountState {
  if (account.status === 'disabled') return 'disabled';
  return account.must_change_password ? 'not_activated' : 'active';
}

export const ACCOUNT_STATE_LABEL: Record<AccountState, string> = {
  active: 'Active',
  // "Not activated" rather than "Inactivated", which reads as a synonym for
  // Disabled and would leave an admin guessing at the difference.
  not_activated: 'Not activated',
  disabled: 'Disabled',
};

/** The line under a name in a list. Mirrors `subtitleFor()` in AuthContext. */
export function accountSubtitle(account: AdminAccount): string {
  if (account.role === 'student' && account.grade_level !== null) {
    return `Grade ${account.grade_level}`;
  }
  return ROLE_LABEL[account.role];
}

/**
 * What to print for a contact address.
 *
 * A `<username>@pca.invalid` placeholder is NOT an address and must never be
 * rendered as one — the rule the invented `liza.mendoza@pca.edu.ph` broke was
 * about displaying a fabricated address as genuine, and printing a placeholder
 * would be the same mistake with better intentions.
 */
export function contactEmail(detail: AdminAccountDetail): string {
  if (!detail.email || !detail.email_can_receive) return 'None set';
  return detail.email;
}
