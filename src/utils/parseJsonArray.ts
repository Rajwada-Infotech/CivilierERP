export function parseJsonArray<T = any>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];

  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed as T[];
    } catch {
      return [];
    }
  }

  return [];
}