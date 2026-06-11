export function parseJsonArray<T = any>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];

  if (typeof value === "string" && value.trim()) {
    try {
      let parsed = JSON.parse(value);
      // Handle legacy double-encoded values (backend was JSON.stringify-ing
      // an already-stringified array, so the DB contains a JSON string of a
      // JSON string).  Parse a second time if the first pass yields a string.
      if (typeof parsed === "string") parsed = JSON.parse(parsed);
      if (Array.isArray(parsed)) return parsed as T[];
    } catch {
      return [];
    }
  }

  return [];
}
