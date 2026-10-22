import { passwordProblem, usernameProblem } from './account';
import type { ImportRowResult, NewAccount } from './adminAccounts';

/**
 * CSV → validated account rows for bulk import. A mirror of CreateAccountSchema (the server
 * re-validates) so every problem shows before anything is written. Minimal parser, no dependency.
 */

/**
 * Template columns. No username or password: the server generates both. The parser still accepts
 * either when present, for older files and chosen usernames.
 */
export const CSV_COLUMNS = ['role', 'first_name', 'last_name', 'grade_level', 'email'] as const;

/** Required columns. grade_level is required by value for students only. */
export const REQUIRED_COLUMNS = ['role', 'first_name', 'last_name'] as const;

/** Accepted when supplied, absent from the template, never required. */
export const OPTIONAL_COLUMNS = ['username', 'password'] as const;

export const CSV_TEMPLATE = `role,first_name,last_name,grade_level,email
student,Juan,Dela Cruz,9,
student,Maria,Reyes,7,maria.reyes@example.com
educator,Ana,Santos,,ana.santos@pca.edu.ph`;

/** Shape check only (the server's .email() is the rule). Exported so the precheck sends only well-formed addresses. */
export const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export interface ParsedRow {
  /** 1-based line in the file, header included, so it matches the spreadsheet's row gutter. */
  line: number;
  account: NewAccount;
  /** Empty when the row is usable. */
  errors: string[];
}

export interface ParseResult {
  rows: ParsedRow[];
  /** A problem with the file as a whole. */
  fatal: string | null;
}

/** Splits one CSV line, honouring double-quoted fields; `""` is a literal quote. */
function splitLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out.map((f) => f.trim());
}

function validate(account: NewAccount, raw: Record<string, string>): string[] {
  const errors: string[] = [];

  if (account.role !== 'student' && account.role !== 'educator') {
    // Name both roles: `admin` isn't assignable here.
    errors.push(`Role must be "student" or "educator" (got "${raw.role || 'blank'}")`);
  }
  if (!account.first_name) errors.push('First name is required');
  if (!account.last_name) errors.push('Last name is required');

  // A blank username is valid (the server generates one); only supplied ones are checked.
  if (account.username) {
    const usernameError = usernameProblem(account.username);
    if (usernameError) errors.push(usernameError);
  }

  // A student without a grade is rejected, never defaulted (handle_new_user() would silently use 7).
  if (account.role === 'student') {
    if (raw.grade_level === '') {
      errors.push('A student needs a grade level (7–10)');
    } else if (
      account.grade_level === undefined ||
      account.grade_level === null ||
      Number.isNaN(account.grade_level)
    ) {
      errors.push(`Grade level must be a number 7–10 (got "${raw.grade_level}")`);
    } else if (account.grade_level < 7 || account.grade_level > 10) {
      errors.push(`Grade level must be 7–10 (got ${account.grade_level})`);
    }
  } else if (account.role === 'educator' && raw.grade_level !== '') {
    errors.push('An educator has no grade level — leave it blank');
  }

  if (raw.email && !EMAIL_SHAPE.test(raw.email)) {
    errors.push(`"${raw.email}" is not a valid email address`);
  }
  // Only a supplied password is checked; blank means generate one.
  if (raw.password) {
    const problem = passwordProblem(raw.password);
    if (problem) errors.push(`${problem} Or leave the column blank to generate one.`);
  }

  return errors;
}

// Writing: the credentials file handed out after an import

/** Names are included so each child's line is identifiable. First/last order matches the template. */
export const CREDENTIAL_HEADER = ['first_name', 'last_name', 'username', 'password'] as const;

/**
 * Successful rows only (failed rows have no password). Names come from the server's result rows;
 * never re-derive them by index, since rows can drop out.
 */
export function credentialRows(results: ImportRowResult[]): string[][] {
  return results
    .filter((r) => r.ok)
    .map((r) => [r.first_name, r.last_name, r.username, r.password ?? '']);
}

/** One CSV cell, quoted only when needed. Must stay the exact inverse of splitLine(). */
export function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Header + rows as a CSV file, trailing newline included. */
export function toCsv(header: readonly string[], rows: string[][]): string {
  return [header.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n') + '\n';
}

/** Downloads a CSV string as a file. Doesn't work inside a sandboxed Artifact. */
export function downloadCsvFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Tab-separated for pasting into a spreadsheet; no quoting needed. */
export function toTsv(header: readonly string[], rows: string[][]): string {
  return [header.join('\t'), ...rows.map((r) => r.join('\t'))].join('\n');
}

/** Where an earlier row claimed a username or address; the name makes a wrong number visible. */
interface Claim {
  line: number;
  name: string;
}

/** The row's full name, or "" (a missing name is already its own error). */
function claimantName(raw: Record<string, string>): string {
  return [raw.first_name, raw.last_name].map((p) => (p ?? '').trim()).filter(Boolean).join(' ');
}

function claimRef(claim: Claim): string {
  return claim.name ? `row ${claim.line} (${claim.name})` : `row ${claim.line}`;
}

export function parseAccountsCsv(text: string): ParseResult {
  // Carry each row's original line number through the blank-line filter. A newline inside a quoted
  // field still splits the record (the parser is line-based).
  const lines = text
    .split(/\r?\n/)
    .map((text, i) => ({ n: i + 1, text: text.trim() }))
    .filter((l) => l.text.length > 0);

  if (lines.length === 0) return { rows: [], fatal: 'The file is empty.' };

  const header = splitLine(lines[0].text).map((h) => h.toLowerCase().replace(/\s+/g, '_'));

  // `username` is no longer required; files that still carry it parse as before.
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    return {
      rows: [],
      fatal: `The header row is missing: ${missing.join(', ')}. Expected: ${CSV_COLUMNS.join(', ')}`,
    };
  }

  if (lines.length === 1) {
    return { rows: [], fatal: 'The file has a header row but no accounts.' };
  }

  const rows: ParsedRow[] = [];
  // Case-insensitive within-file duplicate check, so a collision can't fail mid-import.
  const seen = new Map<string, Claim>();
  // Same for emails, which must be unique in auth.users.
  const seenEmails = new Map<string, Claim>();

  for (let i = 1; i < lines.length; i++) {
    // The file line, never the loop index.
    const line = lines[i].n;
    const cells = splitLine(lines[i].text);
    const raw: Record<string, string> = {};
    header.forEach((col, idx) => {
      raw[col] = cells[idx] ?? '';
    });

    const role = raw.role.toLowerCase() as NewAccount['role'];
    const username = (raw.username ?? '').toLowerCase();
    const gradeText = raw.grade_level ?? '';

    const account: NewAccount = {
      role,
      first_name: raw.first_name,
      last_name: raw.last_name,
      // Omit the key when blank, never send '': the server rejects an empty username.
      ...(username ? { username } : {}),
      ...(role === 'student' && gradeText !== ''
        ? { grade_level: Number(gradeText) }
        : {}),
      ...(raw.email ? { email: raw.email.toLowerCase() } : {}),
      ...(raw.password ? { password: raw.password } : {}),
    };

    const errors = validate(account, { ...raw, grade_level: gradeText });
    const claim: Claim = { line, name: claimantName(raw) };

    const previous = seen.get(username);
    if (username && previous !== undefined) {
      errors.push(`Duplicate username — already used on ${claimRef(previous)}`);
    } else if (username) {
      seen.set(username, claim);
    }

    // Only a supplied email can clash.
    const email = (raw.email ?? '').trim().toLowerCase();
    const previousEmail = seenEmails.get(email);
    if (email && previousEmail !== undefined) {
      errors.push(`Duplicate email — already used on ${claimRef(previousEmail)}`);
    } else if (email) {
      seenEmails.set(email, claim);
    }

    rows.push({ line, account, errors });
  }

  return { rows, fatal: null };
}
