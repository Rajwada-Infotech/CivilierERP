import { API_BASE_URL } from "./apiBase";
import { getSystemStatus, reportGatewayFailure, reportSystemRecovered, setHealthCheck } from "./systemStatus";
import { sendToMaintenancePage } from "./maintenanceRedirect";

// While a new build is going live, nginx answers 502 (or 504) for the few seconds the backend restarts.
// That is not an application error. Every call to our own API goes through here (the browser's fetch is
// wrapped once at start-up), so every page — not just the ones using fetchWithAuth — gets the same
// treatment: the "system is updating" banner, and reads (GET / HEAD) are quietly retried a few times.
// Writes are never retried — a repeated POST could save twice — they just fail with the gateway's answer.

export const STABILISING_MESSAGE = "Please wait a few seconds for the system to stabilise.";
export const GATEWAY_RETRY_DELAYS_MS = [1500, 3000, 5000];

// "429 Too many requests": the per-minute limit was hit, usually by a burst (a page that loads many things at once).
// It clears itself, so reads wait as long as the server asked (Retry-After) and try again, a couple of times. Writes
// are never retried, and this is not a gateway failure: no banner.
export const RATE_LIMIT_MAX_RETRIES = 2;
const RATE_LIMIT_MIN_WAIT_MS = 1500;
const RATE_LIMIT_MAX_WAIT_MS = 10_000;

export function rateLimitWaitMs(response: Response): number {
  const seconds = Number(response.headers.get("retry-after"));
  const asked = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : RATE_LIMIT_MIN_WAIT_MS;
  return Math.min(RATE_LIMIT_MAX_WAIT_MS, Math.max(RATE_LIMIT_MIN_WAIT_MS, asked));
}

// nginx's own error pages are HTML; the backend's deliberate 503s (e.g. "run the migrations") are JSON with an
// `error` message and must reach the screen untouched.
export function isGatewayFailure(response: Response): boolean {
  if (response.status === 502 || response.status === 504) return true;
  if (response.status === 503) {
    return !(response.headers.get("content-type") || "").includes("application/json");
  }
  return false;
}

function isOurApi(input: RequestInfo | URL): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, window.location.href);
    if (url.pathname.startsWith("/api/") && url.origin === window.location.origin) return true;
    return /^https?:\/\//i.test(API_BASE_URL) && url.href.startsWith(API_BASE_URL);
  } catch {
    return false;
  }
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Wraps a fetch function with the gateway handling above. */
export function createGatewayFetch(native: FetchFn, delays: number[] = GATEWAY_RETRY_DELAYS_MS): FetchFn {
  return async (input, init) => {
    if (!isOurApi(input)) return native(input, init);

    const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    const canRetry = (method === "GET" || method === "HEAD") && !(input instanceof Request && input.bodyUsed);
    let retries = 0;
    let rateRetries = 0;
    for (;;) {
      const response = await native(input, init);
      if (response.status === 429 && canRetry && rateRetries < RATE_LIMIT_MAX_RETRIES) {
        rateRetries++;
        await sleep(rateLimitWaitMs(response), init?.signal);
        continue;
      }
      if (!isGatewayFailure(response)) {
        if (retries > 0) reportSystemRecovered();
        if (response.status === 503) await sendToMaintenancePage(response);
        return response;
      }
      reportGatewayFailure();
      if (!canRetry || retries >= delays.length) return response;
      await sleep(delays[retries++], init?.signal);
    }
  };
}

let installed = false;

// The banner used to show only when one of the page's own requests failed during a deploy. A page that fetched
// nothing in those seconds — one reading from its cache — never showed it (CRM pages, which keep their data longer,
// most of all). A light heartbeat makes it universal: while the tab is visible, /health is asked every
// HEARTBEAT_MS (and when the tab comes back into view); a gateway failure raises the banner, and the existing /health
// poll takes it down and refreshes the page's data once the system answers. Being offline is not an update: a
// network error is ignored, and so is the backend's own (JSON) 503.
export const HEARTBEAT_MS = 15_000;

/** One heartbeat: true when the gateway answered as if mid-deploy (and the banner was raised). */
export async function heartbeat(native: FetchFn): Promise<boolean> {
  if (getSystemStatus() === "updating") return false; // already shown; the /health poll is running
  try {
    const res = await native("/health", { cache: "no-store" });
    if (!isGatewayFailure(res)) return false;
    reportGatewayFailure();
    return true;
  } catch {
    return false;
  }
}

/** Call once at start-up, before anything else fetches. */
export function installGatewayFetch() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const native: FetchFn = window.fetch.bind(window);
  // The health check uses the browser's own fetch, so it is never retried or counted as a failure.
  setHealthCheck(async () => {
    const res = await native("/health", { cache: "no-store" });
    return res.ok;
  });
  window.fetch = createGatewayFetch(native);

  window.setInterval(() => { if (!document.hidden) void heartbeat(native); }, HEARTBEAT_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void heartbeat(native); });
}
