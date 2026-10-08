// Whether the system is in the few-seconds gap of a deploy: the gateway answers 502 / 504 while the backend
// restarts. Anything that notices (gatewayFetch) reports it here; the banner shows it, and polling /health
// tells us when everything is back.

export type SystemStatus = "ok" | "updating";

const HEALTH_POLL_MS = 3000;

let status: SystemStatus = "ok";
let pollTimer: ReturnType<typeof setInterval> | null = null;
let healthCheck: (() => Promise<boolean>) | null = null;
const listeners = new Set<(s: SystemStatus) => void>();

function setStatus(next: SystemStatus) {
  if (status === next) return;
  status = next;
  listeners.forEach((l) => l(next));
}

export const getSystemStatus = () => status;

export function subscribeSystemStatus(listener: (s: SystemStatus) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Where the health check comes from (set once at start-up, with the browser's own fetch). */
export function setHealthCheck(check: () => Promise<boolean>) {
  healthCheck = check;
}

export function reportSystemRecovered() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  setStatus("ok");
}

/** A request just failed at the gateway. Shows the banner and watches /health until the system answers again. */
export function reportGatewayFailure() {
  setStatus("updating");
  if (pollTimer || !healthCheck) return;
  pollTimer = setInterval(async () => {
    try {
      if (healthCheck && (await healthCheck())) reportSystemRecovered();
    } catch {
      /* still down */
    }
  }, HEALTH_POLL_MS);
}

/** For tests. */
export function resetSystemStatus() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  healthCheck = null;
  listeners.clear();
  status = "ok";
}
