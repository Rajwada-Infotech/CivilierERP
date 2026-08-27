// Tiny pub/sub so fetchWithAuth (a services-layer module with no business
// logic of its own) can signal "session expired" without importing
// navigation or a toast library directly — AuthContext subscribes and does
// the actual logout + redirect, exactly like the web app's fetchWithAuth
// setting window.location.href but decoupled for RN (no window global).
type Listener = () => void;

const listeners = new Set<Listener>();

export function onSessionExpired(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitSessionExpired(): void {
  listeners.forEach((l) => l());
}
