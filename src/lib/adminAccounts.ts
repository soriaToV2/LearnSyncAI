import { api } from './api';

/**
 * Admin portal data layer: what an admin may change about someone else (role, status, grade), the
 * inverse of src/lib/account.ts. The server's UpdateAccountSchema is what makes it safe.
 */

/** Roles an admin may assign; never `admin`. */
export type AssignableRole = 'student' | 'educator';

/** Roles an account may already have. */
export type AccountRole = AssignableRole | 'admin';

export type AccountStatus = 'active' | 'disabled';

export interface AdminAccount {
  id: string;
  role: AccountRole;
  /** NULL means the account can't sign in (handle_new_user() degraded a bad username). Fix by editing it. */
  username: string | null;
  first_name: string;
  last_name: string;
  /** 7–10 for students; NULL otherwise. */
  grade_level: number | null;
  status: AccountStatus;
  /**
   * True until the holder replaces the admin-set password; most routes refuse it until then.
   * Separate from `status` (an account can be both disabled and never activated).
   */
  must_change_password: boolean;
  created_at: string;
  updated_at: string;
}

/** One account plus email and last sign-in from auth.users. */
export interface AdminAccountDetail extends AdminAccount {
  email: string | null;
  /** A generated placeholder; the UI shows "None". */
  email_is_placeholder: boolean;
  /** Whether a reset code could arrive. Wider than the placeholder flag; print by this. */
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
    /** Still holding the admin-set password. */
    not_activated: number;
    disabled: number;
  };
}

export interface NewAccount {
  role: AssignableRole;
  first_name: string;
  last_name: string;
  /** Optional only on import rows (generated from the name). */
  username?: string;
  /** Required for a student, and must be absent for an educator. */
  grade_level?: number | null;
  email?: string;
  password?: string;
}

/** A created account, with its one-time password. */
export interface CreatedAccount extends AdminAccount {
  email: string;
  email_is_placeholder: boolean;
  /** Shown once; never retrievable. */
  password: string;
  password_was_generated: boolean;
}

/** The address as stored after POST /admin/accounts/:id/email. */
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
  /** Names come from the server so the credentials file never relies on row order. */
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

  /** A free username for a name. Admin-only (an availability oracle); never call from a public page. */
  async suggestUsername(first_name: string, last_name: string): Promise<string> {
    const res = await api.post<{ username: string }>('/admin/username-suggestion', {
      first_name,
      last_name,
    });
    return res.data.username;
  },

  /**
   * Which usernames/emails already exist, for the import review screen. Admin-only oracle.
   * A courtesy, not a guarantee; the import's own checks and unique indexes still decide.
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

  /** In place of deletion; re-enabling restores everything. */
  async setStatus(userId: string, status: AccountStatus): Promise<AdminAccount> {
    const res = await api.post<AdminAccount>(`/admin/accounts/${userId}/status`, { status });
    return res.data;
  },

  /**
   * Admin password reset: the recovery path that always works. Re-arms must_change_password, and
   * signs the account out everywhere (because `authenticate` checks tokens with the auth server).
   */
  async resetPassword(userId: string, newPassword: string): Promise<void> {
    await api.post(`/admin/accounts/${userId}/password`, { new_password: newPassword });
  },

  /**
   * Replace a contact address. Applies immediately, with no code (unlike self-service changeEmail()),
   * so the form confirms first. A 409 means another account has that address.
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

// Display helpers

export const ROLE_LABEL: Record<AccountRole, string> = {
  student: 'Student',
  educator: 'Educator',
  admin: 'Admin',
};

/**
 * The account's state label, derived rather than stored (account_status stays two values).
 * Disabled wins over not activated.
 */
export type AccountState = 'active' | 'not_activated' | 'disabled';

export function accountState(account: AdminAccount): AccountState {
  if (account.status === 'disabled') return 'disabled';
  return account.must_change_password ? 'not_activated' : 'active';
}

export const ACCOUNT_STATE_LABEL: Record<AccountState, string> = {
  active: 'Active',
  // "Not activated", not "Inactivated", which reads like Disabled.
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

/** Display text for a contact address; a placeholder is never shown as an address. */
export function contactEmail(detail: AdminAccountDetail): string {
  if (!detail.email || !detail.email_can_receive) return 'None set';
  return detail.email;
}
