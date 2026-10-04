/**
 * Shared API response helpers.
 *
 * The pattern  `res.json().catch(() => ({}))` is dangerous on array-returning
 * endpoints — if JSON parsing fails, `{}` is returned and callers crash on
 * `.filter()`, `.map()`, or `.length` because `{}` is not an array.
 *
 * Use these helpers instead:
 *   - `handleArray<T>(res)`   — throws on !res.ok, returns T[] (falls back to [])
 *   - `handleObject<T>(res)`  — throws on !res.ok, returns T   (falls back to {})
 *   - `normalizeArray<T>(v)`  — coerces an unknown value to T[] safely
 */

/**
 * Read a Response that should contain a JSON array.
 * Throws with the server's error message if !res.ok.
 * Falls back to [] if JSON parsing fails (never returns {}).
 */
export async function handleArray<T>(res: Response): Promise<T[]> {
  const data = await res.json().catch(() => []);
  if (!res.ok) {
    const msg = (data as any)?.error || (data as any)?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return Array.isArray(data) ? data : [];
}

/**
 * Read a Response that should contain a JSON object.
 * Throws with the server's error message if !res.ok.
 * Falls back to {} if JSON parsing fails.
 */
export async function handleObject<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}) as T);
  if (!res.ok) {
    const msg = (data as any)?.error || (data as any)?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

/**
 * Safely coerce an unknown value to an array.
 * Returns [] for null, undefined, plain objects, and other non-arrays.
 * Use after `res.json().catch(() => ({}))` to protect callers.
 *
 * @example
 *   return normalizeArray<PurchaseOrder>(await res.json().catch(() => ({})));
 */
export function normalizeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value : [];
}
