import { fetchWithAuth, ApiError } from "@/lib/fetchWithAuth";

// Script Console (Admin > Script Console, super admin only): see backend/routes/scriptConsole.js.

export interface VaultStatus {
  configured: boolean;
  unlocked: boolean;
  idleMinutes: number;
  /** Seconds this person is still locked out of unlocking for (after too many wrong keys). */
  lockedOutSec: number;
  running: { id: string; startedAt: number; name: string | null } | null;
}

export interface EnvRow { key: string; value: string }
export interface SavedScript { id: number; name: string; description: string; script: string; env: EnvRow[]; updatedBy: string | null; updatedAt: string | null }
export interface Chunk { s: "o" | "e"; t: string }
export type RunStatus = "running" | "done" | "failed" | "killed" | "timeout" | "interrupted";
export interface RunView { id: string; status: RunStatus; exitCode: number | null; startedAt: number; finishedAt: number | null; chunks: Chunk[]; next: number; truncated: boolean }
export interface HistoryRow { RunId: string; UserEmail: string | null; Name: string | null; Status: RunStatus; ExitCode: number | null; StartedAt: string; FinishedAt: string | null }
export interface HistoryRun { runId: string; userEmail: string | null; name: string | null; status: RunStatus; exitCode: number | null; startedAt: string; finishedAt: string | null; script: string; env: EnvRow[]; output: string }

/** The server said the vault is locked (it was locked, idled out, or this sign-in never opened it). */
export const isVaultLocked = (err: unknown) => err instanceof ApiError && err.status === 403 && /vault is locked/i.test(err.message);

const BASE = "/api/script-console";
const json = (body: unknown): RequestInit => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function read<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((body as { error?: string }).error || "Request failed"), { status: res.status, body });
  return body as T;
}
const call = <T>(path: string, init?: RequestInit) => fetchWithAuth(`${BASE}${path}`, { skipActivityLog: true, ...init }).then((r) => read<T>(r));

export const getVaultStatus = () => call<VaultStatus>("/status");
/** The new key (shown once). */
export const createVaultKey = (password: string) => call<{ key: string }>("/setup", { method: "POST", ...json({ password }) });
export const unlockVault = (key: string) => call<{ ok: true }>("/unlock", { method: "POST", ...json({ key }) });
export const lockVault = () => call<{ ok: true }>("/lock", { method: "POST" });
export const rotateVaultKey = (currentKey: string) => call<{ key: string }>("/rotate", { method: "POST", ...json({ currentKey }) });

export const listScripts = () => call<SavedScript[]>("/library");
export const saveScript = (s: { id?: number; name: string; description?: string; script: string; env: EnvRow[] }) =>
  s.id ? call<{ id: number }>(`/library/${s.id}`, { method: "PUT", ...json(s) }) : call<{ id: number }>("/library", { method: "POST", ...json(s) });
export const deleteScript = (id: number) => call<{ ok: true }>(`/library/${id}`, { method: "DELETE" });

export const startRun = (r: { script: string; env: EnvRow[]; name?: string; timeoutMinutes?: number }) => call<{ id: string; startedAt: number }>("/run", { method: "POST", ...json(r) });
export const getRun = (id: string, from: number) => call<RunView>(`/runs/${id}?from=${from}`);
export const stopRun = (id: string) => call<{ ok: true }>(`/runs/${id}/kill`, { method: "POST" });
export const listHistory = () => call<HistoryRow[]>("/history");
export const getHistoryRun = (id: string) => call<HistoryRun>(`/history/${id}`);
