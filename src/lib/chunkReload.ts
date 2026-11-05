import { toast } from "sonner";

// After a new build is deployed, the hashed files of the previous build are gone. A tab that was opened
// before the deploy still points at them, so opening a page that hasn't been loaded yet fails with a
// 404 ("Failed to fetch dynamically imported module"). The fix is simply to load the new build.

const RELOAD_KEY = "__new_version_reload_at";
// Never reload twice within this window — if the page still fails after a fresh load it is a real
// error, not a stale tab, and a reload loop would only hide it.
const RELOAD_WINDOW_MS = 30_000;

const CHUNK_ERROR =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading chunk [\w-]+ failed|Loading CSS chunk|ChunkLoadError|Unable to preload CSS/i;

export function isChunkLoadError(err: unknown): boolean {
  const text =
    err instanceof Error ? `${err.name} ${err.message}` : typeof err === "string" ? err : "";
  return CHUNK_ERROR.test(text);
}

/** Reloads the page to pick up the new build, at most once per 30 s. Returns true when a reload was started. */
export function reloadForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < RELOAD_WINDOW_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // Storage blocked: can't tell whether we already reloaded, so don't risk a loop.
    return false;
  }
  toast.info("A new version of CivilierERP is available. Refreshing the page…", { duration: 3000 });
  window.setTimeout(() => window.location.reload(), 800);
  return true;
}
