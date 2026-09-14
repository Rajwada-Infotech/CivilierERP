import { fetchWithAuth } from "@/lib/fetchWithAuth";

export const API = "/api/expense-booking";

export async function apiFetch(url: string, opts?: RequestInit, timeoutMs = 25000) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error("Request timed out. Please try again.")),
      timeoutMs,
    );
  });

  const res = await Promise.race([fetchWithAuth(url, opts), timeout]).finally(
    () => {
      if (timeoutId) clearTimeout(timeoutId);
    },
  );

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const details = Array.isArray(body.details)
      ? body.details
          .map((d: any) => `${d.field || "?"}: ${d.message}`)
          .join(" | ")
      : "";
    throw new Error(
      (body.error ?? body.message ?? `HTTP ${res.status}`) +
        (details ? ` → ${details}` : ""),
    );
  }
  return res.json().catch(() => ({}));
}
