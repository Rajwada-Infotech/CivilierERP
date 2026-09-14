// Backend routes often forward the raw mssql/driver error string straight
// through (`res.status(500).json({ error: err.message })`), which reads like
// "Violation of UNIQUE KEY constraint 'UQ_enterprise_name'. Cannot insert
// duplicate key..." — technically correct, useless to the person filling in
// a form. This maps the common raw patterns to plain English and falls back
// to a caller-supplied friendly message for anything else that looks
// internal (long, SQL-flavored, or just missing).

const PATTERNS: { test: RegExp; message: (m: RegExpMatchArray) => string }[] = [
  {
    test: /violation of unique key constraint|cannot insert duplicate key|duplicate key was ignored/i,
    message: () => "A record with this name already exists. Please use a different name.",
  },
  {
    test: /the (?:insert|update|delete) statement conflicted with the foreign key constraint/i,
    message: () =>
      "This record is linked to other data and can't be changed right now. Remove or update those first.",
  },
  {
    test: /cannot insert the value null into column '([^']+)'/i,
    message: (m) => `${humanizeColumn(m[1])} is required.`,
  },
  {
    test: /the (?:insert|update) statement conflicted with the check constraint/i,
    message: () => "One of the values entered isn't allowed for this field.",
  },
  {
    test: /string or binary data would be truncated/i,
    message: () => "One of the fields is too long. Please shorten it and try again.",
  },
  {
    test: /request failed with status code 401|unauthorized/i,
    message: () => "Your session has expired. Please log in again.",
  },
  {
    test: /network error|failed to fetch/i,
    message: () => "Couldn't reach the server. Check your connection and try again.",
  },
];

function humanizeColumn(column: string): string {
  return column
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Raw driver/stack-trace-ish text — anything matching this but none of the
// specific patterns above falls back to the caller's generic message rather
// than being shown verbatim.
const LOOKS_INTERNAL = /\bsql\b|constraint|stack trace|\bexception\b|column '.*'|at Object\.|node_modules/i;

export function friendlyErrorMessage(err: unknown, fallback: string): string {
  const raw =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (!raw) return fallback;

  for (const { test, message } of PATTERNS) {
    const match = raw.match(test);
    if (match) return message(match);
  }

  if (LOOKS_INTERNAL.test(raw) || raw.length > 140) return fallback;
  return raw;
}
