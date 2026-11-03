import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Download, KeyRound, Loader2, Lock, Play, Plus, RefreshCw, Save, Square, Trash2, X } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, SheetMark, MarkSquare, type MarkTone } from "@/components/sheet/Sheet";
import { fmtIstDateTime } from "@/lib/istTime";
import { downloadBlob } from "@/lib/xlsxBook";
import {
  createVaultKey, deleteScript, getHistoryRun, getRun, getVaultStatus, isVaultLocked, listHistory, listScripts, lockVault, rotateVaultKey,
  saveScript, startRun, stopRun, unlockVault,
  type Chunk, type EnvRow, type HistoryRun, type RunStatus, type SavedScript,
} from "@/api/scriptConsoleApi";

const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const HEAD = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground";
const RULE = "1px solid hsl(var(--foreground))";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const KEY_INK = `${KEY} bg-foreground text-card border border-foreground`;
const KEY_LINE = `${KEY} border border-foreground text-foreground hover:bg-primary/10`;
const INPUT = "border border-foreground/40 focus:border-foreground bg-card text-foreground placeholder:text-muted-foreground/60 outline-none";
const TAGBOX = "inline-flex items-center gap-1.5 border border-foreground/40 px-2 py-1 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] text-foreground";

// The Admin module styles every ".font-mono" as nowrap (index.css), which would run every output line together, so the
// output panel and the editor set their font and wrapping themselves.
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
const OUTPUT_STYLE = { fontFamily: MONO, whiteSpace: "pre-wrap", overflowWrap: "anywhere" } as const;
const EDITOR_STYLE = { fontFamily: MONO, whiteSpace: "pre", tabSize: 2 } as const;

const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");
const STATUS_TONE: Record<RunStatus, MarkTone> = { running: "moving", done: "done", failed: "stopped", killed: "stopped", timeout: "stopped", interrupted: "stopped" };
const STATUS_TEXT: Record<RunStatus, string> = { running: "Running", done: "Finished", failed: "Failed", killed: "Stopped", timeout: "Timed out", interrupted: "Interrupted" };

// ── Entering the key: never offered to the browser's password manager ────────────────────────────────────────────────
// A type="password" field makes Chrome / Edge / Firefox offer to SAVE what was typed, and a vault key saved in a browser
// is no longer a key only the super admin holds. So the key goes into a plain text field that is only drawn as dots
// (-webkit-text-security), with the "do not store or autofill" hints password managers respect. Where the browser cannot
// draw a text field as dots (older Firefox), it falls back to a password field with autocomplete off.
const canMaskText = typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("-webkit-text-security", "disc");

function SecretInput({ value, onChange, onEnter, masked, placeholder, className, label }: {
  value: string; onChange: (v: string) => void; onEnter?: () => void; masked: boolean; placeholder?: string; className?: string; label?: string;
}) {
  const asPassword = masked && !canMaskText;
  return (
    <input
      type={asPassword ? "password" : "text"}
      name="vault-key"
      aria-label={label ?? "Vault key"}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
      autoComplete={asPassword ? "off" : "one-time-code"}
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      data-lpignore="true"
      data-1p-ignore="true"
      data-bwignore="true"
      data-form-type="other"
      className={className}
      style={masked && !asPassword ? ({ WebkitTextSecurity: "disc" } as React.CSSProperties) : undefined}
    />
  );
}

// ── The key, shown once ──────────────────────────────────────────────────────────────────────────────────────────────
/** The key as a small text file to keep in a password manager or on a safe drive. */
function keyFileText(vaultKey: string, now = new Date()) {
  return [
    "CivilierERP - Script Console vault key",
    `Created: ${fmtIstDateTime(now)} (IST)`,
    "",
    vaultKey,
    "",
    "256-bit key, 13 groups of 4. Type it exactly as shown; case and dashes do not matter.",
    "The server keeps no copy. Without this key the saved scripts and run history cannot be read.",
    "Keep this file private: whoever holds it (and a super admin login) can run code on the server.",
    "",
  ].join("\r\n");
}

function KeyReveal({ vaultKey, onDone, doneLabel }: { vaultKey: string; onDone: () => void; doneLabel: string }) {
  const [saved, setSaved] = useState(false);
  return (
    <div className="space-y-4">
      <p className="text-sm text-foreground">
        This is your vault key. <strong>It is shown this one time.</strong> The server keeps no copy of it: write it down or put it in a password manager now.
      </p>
      <div
        className="flex flex-wrap justify-center gap-x-1 gap-y-2 border border-foreground bg-card px-3 py-4 font-mono text-[clamp(0.8rem,2.6vw,1.25rem)] font-semibold tracking-[0.08em] select-all"
        data-testid="vault-key"
        aria-label="Vault key"
      >
        {vaultKey.split("-").map((group, i, all) => (
          <span key={i} className="whitespace-nowrap">{i < all.length - 1 ? `${group}-` : group}</span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={`${KEY_LINE} h-9 px-4`} onClick={() => { void navigator.clipboard.writeText(vaultKey); toast.success("Key copied. Paste it somewhere safe, then clear your clipboard."); }}>
          <Copy size={12} /> Copy key
        </button>
        <button
          type="button"
          className={`${KEY_INK} h-9 px-4`}
          onClick={() => {
            downloadBlob(new Blob([keyFileText(vaultKey)], { type: "text/plain;charset=utf-8" }), "civilier-script-console-vault-key.txt");
            toast.success("Key file downloaded. Keep it somewhere private.");
          }}
        >
          <Download size={12} /> Download key
        </button>
        <span className={LBL}>256-bit · 13 groups of 4</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Lose it and the saved scripts and run history cannot be read again; the only way back in is for someone with database access to remove the key record, which starts the vault over empty.
      </p>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="mt-1" />
        <span>I have saved the key somewhere safe.</span>
      </label>
      <button type="button" className={`${KEY_INK} h-10 px-6`} disabled={!saved} onClick={onDone}>{doneLabel}</button>
    </div>
  );
}

// ── Before the vault: create the key / enter the key ─────────────────────────────────────────────────────────────────
function VaultSetup({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const create = async () => {
    setBusy(true);
    setError("");
    try { setKey((await createVaultKey(password)).key); } catch (e) { setError(message(e)); } finally { setBusy(false); setPassword(""); }
  };
  return (
    <div className="w-full bg-card" style={{ border: RULE }}>
      <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: RULE }}>
        <KeyRound size={14} /> <span className={HEAD}>Create the vault key</span>
      </div>
      <div className="grid gap-0 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="space-y-3 p-5 text-sm text-foreground lg:border-r lg:border-foreground/25">
          <p>The Script Console runs code on the server, so it opens only with a 256-bit vault key that you hold.</p>
          <ul className="list-disc space-y-1.5 pl-5 text-muted-foreground">
            <li>The key is made on the server and shown to you once.</li>
            <li>The server stores only a one-way hash, never the key.</li>
            <li>Saved scripts, run history and output are encrypted with it (AES-256-GCM).</li>
            <li>It opens for one sign-in at a time and locks after 15 idle minutes.</li>
          </ul>
        </div>
        <div className="space-y-4 p-5">
        {key ? (
          <KeyReveal vaultKey={key} onDone={onDone} doneLabel="Open the Script Console" />
        ) : (
          <>
            <label className="grid gap-1.5 text-sm">
              <span className={LBL}>Your login password (to confirm it is you)</span>
              <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && password && void create()} className={`${INPUT} h-10 px-3`} />
            </label>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <button type="button" className={`${KEY_INK} h-10 px-6`} disabled={busy || !password} onClick={() => void create()}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />} Create vault key
            </button>
          </>
        )}
        </div>
      </div>
    </div>
  );
}

function VaultUnlock({ lockedOutSec, onUnlocked }: { lockedOutSec: number; onUnlocked: () => void }) {
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lockedUntil, setLockedUntil] = useState<number>(lockedOutSec > 0 ? Date.now() + lockedOutSec * 1000 : 0);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const waitSec = Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));

  const unlock = async () => {
    setBusy(true);
    setError("");
    try {
      await unlockVault(key);
      setKey("");
      onUnlocked();
    } catch (e) {
      const body = (e as { body?: { attemptsLeft?: number; retryAfterSec?: number } }).body;
      if (body?.retryAfterSec) setLockedUntil(Date.now() + body.retryAfterSec * 1000);
      setError(message(e) + (body?.attemptsLeft !== undefined ? ` ${body.attemptsLeft} attempt(s) left.` : ""));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="w-full bg-card" style={{ border: RULE }}>
      <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: RULE }}>
        <Lock size={14} /> <span className={HEAD}>The vault is locked</span>
      </div>
      <div className="grid gap-0 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="space-y-3 p-5 text-sm text-foreground lg:border-r lg:border-foreground/25">
          <p>Enter the vault key to open the Script Console.</p>
          <ul className="list-disc space-y-1.5 pl-5 text-muted-foreground">
            <li>It locks again after 15 minutes without use, and whenever you sign out.</li>
            <li>Five wrong keys lock you out for 15 minutes.</li>
            <li>Lost the key? Someone with database access can reset the vault, which empties it.</li>
          </ul>
        </div>
        <div className="space-y-4 p-5">
        <label className="grid gap-1.5 text-sm">
          <span className={LBL}>Vault key</span>
          <div className="flex gap-2">
            <SecretInput
              masked={!show} value={key} placeholder="XXXX-XXXX-XXXX-…"
              onChange={setKey} onEnter={() => key && !waitSec && void unlock()}
              className={`${INPUT} h-10 min-w-0 flex-1 px-3 font-mono text-sm tracking-wider`}
            />
            <button type="button" className={`${KEY_LINE} h-10 px-3`} onClick={() => setShow((s) => !s)}>{show ? "Hide" : "Show"}</button>
          </div>
        </label>
        {waitSec > 0 ? (
          <p className="text-sm text-destructive">Too many wrong keys. Try again in {Math.floor(waitSec / 60)}:{String(waitSec % 60).padStart(2, "0")}.</p>
        ) : (
          error && <p className="text-sm text-destructive">{error}</p>
        )}
        <button type="button" className={`${KEY_INK} h-10 px-6`} disabled={busy || !key || waitSec > 0} onClick={() => void unlock()}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />} Unlock
        </button>
        </div>
      </div>
    </div>
  );
}

// ── The runner ───────────────────────────────────────────────────────────────────────────────────────────────────────
const TIMEOUTS = [1, 5, 10, 30, 60];
const STARTER = `// Runs like \`docker compose exec backend node -\`: the backend folder is the working directory,
// so require("./db") works, and the variables below are in process.env.
const { connectDB, getPool, closeDB } = require("./db");
(async () => {
  await connectDB();
  const r = await getPool().request().query("SELECT TOP 5 id, email FROM dbo.users");
  console.table(r.recordset);
  await closeDB?.();
  process.exit(0);
})();
`;

function Runner({ idleMinutes, onLocked }: { idleMinutes: number; onLocked: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [script, setScript] = useState(STARTER);
  const [env, setEnv] = useState<EnvRow[]>([]);
  const [timeoutMinutes, setTimeoutMinutes] = useState(10);
  const [libId, setLibId] = useState<number | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [runStatus, setRunStatus] = useState<RunStatus | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  const [side, setSide] = useState<"saved" | "history">("saved");
  const [viewing, setViewing] = useState<HistoryRun | null>(null);
  const [, tick] = useState(0);
  const nextRef = useRef(0);
  const outRef = useRef<HTMLPreElement>(null);

  const guard = useCallback((e: unknown) => { if (isVaultLocked(e)) onLocked(); else toast.error(message(e)); }, [onLocked]);

  const library = useQuery({ queryKey: ["script-console", "library"], queryFn: listScripts, retry: false });
  const history = useQuery({ queryKey: ["script-console", "history"], queryFn: listHistory, retry: false, refetchInterval: runStatus === "running" ? false : 30_000 });
  useEffect(() => { if (library.error) guard(library.error); }, [library.error, guard]);
  useEffect(() => { if (history.error) guard(history.error); }, [history.error, guard]);

  // A run that was going when the page opened (or after a reload) is picked up again.
  const status = useQuery({ queryKey: ["script-console", "status"], queryFn: getVaultStatus, refetchInterval: 15_000 });
  const attached = useRef(false);
  useEffect(() => {
    if (attached.current || !status.data?.running) return;
    attached.current = true;
    setRunId(status.data.running.id);
    setRunStatus("running");
    setStartedAt(status.data.running.startedAt);
    nextRef.current = 0;
  }, [status.data]);

  // Follow the running script: poll its output until it ends.
  useEffect(() => {
    if (!runId || runStatus !== "running") return;
    let stop = false;
    let inFlight = false;
    const poll = async () => {
      if (inFlight) return; // a slow answer must not be asked for twice: that printed lines two and three times
      inFlight = true;
      try {
        const from = nextRef.current;
        const v = await getRun(runId, from);
        if (stop || from !== nextRef.current) return; // another poll got there first
        if (v.chunks.length) setChunks((c) => [...c, ...v.chunks]);
        nextRef.current = v.next;
        setStartedAt(v.startedAt);
        if (v.status !== "running") {
          setRunStatus(v.status); setExitCode(v.exitCode); setFinishedAt(v.finishedAt);
          void qc.invalidateQueries({ queryKey: ["script-console", "history"] });
          void qc.invalidateQueries({ queryKey: ["script-console", "status"] });
        }
      } catch (e) { if (!stop) guard(e); } finally { inFlight = false; }
    };
    void poll();
    const t = setInterval(poll, 800);
    const clock = setInterval(() => tick((n) => n + 1), 1000);
    return () => { stop = true; clearInterval(t); clearInterval(clock); };
  }, [runId, runStatus, guard, qc]);

  useEffect(() => { if (outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight; }, [chunks]);

  const cleanEnv = useMemo(() => env.filter((r) => r.key.trim()), [env]);
  const running = runStatus === "running";

  const run = async () => {
    setViewing(null);
    try {
      const r = await startRun({ script, env: cleanEnv, name: name.trim() || undefined, timeoutMinutes });
      setRunId(r.id); setChunks([]); setRunStatus("running"); setExitCode(null); setStartedAt(r.startedAt); setFinishedAt(null);
      nextRef.current = 0;
      void qc.invalidateQueries({ queryKey: ["script-console", "history"] });
    } catch (e) { guard(e); }
  };
  const stop = async () => { if (runId) try { await stopRun(runId); } catch (e) { guard(e); } };

  const save = async (asNew: boolean) => {
    const label = name.trim();
    if (!label) return toast.error("Give the script a name first.");
    try {
      const r = await saveScript({ id: asNew ? undefined : libId ?? undefined, name: label, script, env: cleanEnv });
      setLibId(r.id);
      toast.success("Saved (encrypted with the vault key).");
      void qc.invalidateQueries({ queryKey: ["script-console", "library"] });
    } catch (e) { guard(e); }
  };
  const load = (s: SavedScript) => { setViewing(null); setLibId(s.id); setName(s.name); setScript(s.script); setEnv(s.env); setSide("saved"); };
  const remove = async (s: SavedScript) => {
    if (!window.confirm(`Delete the saved script "${s.name}"?`)) return;
    try { await deleteScript(s.id); if (libId === s.id) setLibId(null); void qc.invalidateQueries({ queryKey: ["script-console", "library"] }); } catch (e) { guard(e); }
  };
  const openHistory = async (id: string) => { try { setViewing(await getHistoryRun(id)); } catch (e) { guard(e); } };

  const elapsed = startedAt ? Math.max(0, Math.round(((finishedAt ?? Date.now()) - startedAt) / 1000)) : 0;
  const shownChunks: Chunk[] = viewing ? [{ s: "o", t: viewing.output }] : chunks;
  const shownStatus = viewing ? viewing.status : runStatus;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-5">
        {/* Editor */}
        <div className="bg-card" style={{ border: RULE }}>
          <div className="flex flex-wrap items-center gap-2 px-4 py-3" style={{ borderBottom: RULE }}>
            <span className={HEAD}>Script</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (to save it)" maxLength={200} className={`${INPUT} h-8 min-w-0 flex-1 px-3 text-xs`} />
            <button type="button" className={`${KEY_LINE} h-8 px-3`} onClick={() => void save(false)}><Save size={12} /> {libId ? "Save" : "Save script"}</button>
            {libId && <button type="button" className={`${KEY_LINE} h-8 px-3`} onClick={() => void save(true)}><Plus size={12} /> Save as new</button>}
          </div>
          <textarea
            value={script} onChange={(e) => setScript(e.target.value)} spellCheck={false}
            className="block min-h-[300px] w-full resize-y border-0 bg-card px-4 py-3 text-xs leading-relaxed text-foreground outline-none"
            style={EDITOR_STYLE}
            aria-label="Script"
          />
          <div className="space-y-2 px-4 py-3" style={{ borderTop: RULE }}>
            <div className="flex items-center justify-between">
              <span className={LBL}>Environment variables (like <span className="normal-case tracking-normal">-e APPLY=1</span>)</span>
              <button type="button" className={`${KEY_LINE} h-7 px-2.5`} onClick={() => setEnv((e) => [...e, { key: "", value: "" }])}><Plus size={11} /> Add</button>
            </div>
            {env.map((r, i) => (
              <div key={i} className="flex gap-2">
                <input value={r.key} placeholder="NAME" onChange={(e) => setEnv((all) => all.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} className={`${INPUT} h-8 w-40 px-2 font-mono text-xs`} aria-label="Variable name" />
                <input value={r.value} placeholder="value" onChange={(e) => setEnv((all) => all.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} className={`${INPUT} h-8 min-w-0 flex-1 px-2 font-mono text-xs`} aria-label="Variable value" />
                <button type="button" className={`${KEY_LINE} h-8 w-8`} aria-label="Remove variable" onClick={() => setEnv((all) => all.filter((_, j) => j !== i))}><X size={12} /></button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ borderTop: RULE }}>
            <label className="flex items-center gap-2">
              <span className={LBL}>Stop after</span>
              <select value={timeoutMinutes} onChange={(e) => setTimeoutMinutes(Number(e.target.value))} className={`${INPUT} h-8 px-2 text-xs`}>
                {TIMEOUTS.map((m) => <option key={m} value={m}>{m} min</option>)}
              </select>
            </label>
            {running ? (
              <button type="button" className={`${KEY} h-10 border border-destructive bg-destructive px-6 text-destructive-foreground`} onClick={() => void stop()}><Square size={12} /> Stop</button>
            ) : (
              <button type="button" className={`${KEY_INK} h-10 px-6`} disabled={!script.trim()} onClick={() => void run()}><Play size={12} /> Run script</button>
            )}
          </div>
        </div>

        {/* Output */}
        <div className="bg-card" style={{ border: RULE }}>
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3" style={{ borderBottom: RULE }}>
            <span className="flex items-center gap-3">
              <span className={HEAD}>Output</span>
              {shownStatus && <SheetMark text={STATUS_TEXT[shownStatus]} tone={STATUS_TONE[shownStatus]} />}
              {viewing ? (
                <span className={LBL}>{viewing.userEmail} · {fmtIstDateTime(viewing.startedAt)}</span>
              ) : (
                runStatus && <span className={`${LBL} tabular-nums`}>{elapsed}s{exitCode !== null ? ` · exit ${exitCode}` : ""}</span>
              )}
            </span>
            <span className="flex gap-2">
              {viewing && <button type="button" className={`${KEY_LINE} h-7 px-2.5`} onClick={() => { setName(viewing.name ?? ""); setScript(viewing.script); setEnv(viewing.env); setLibId(null); setViewing(null); }}>Load into editor</button>}
              <button type="button" className={`${KEY_LINE} h-7 px-2.5`} onClick={() => void navigator.clipboard.writeText(shownChunks.map((c) => c.t).join(""))}><Copy size={10} /> Copy</button>
              {!viewing && !running && chunks.length > 0 && <button type="button" className={`${KEY_LINE} h-7 px-2.5`} onClick={() => { setChunks([]); setRunStatus(null); }}><Trash2 size={10} /> Clear</button>}
              {viewing && <button type="button" className={`${KEY_LINE} h-7 px-2.5`} onClick={() => setViewing(null)}><X size={10} /> Close</button>}
            </span>
          </div>
          <pre ref={outRef} className="m-0 max-h-[460px] min-h-[140px] overflow-auto px-4 py-3 text-[0.6875rem] leading-relaxed text-foreground" style={OUTPUT_STYLE}>
            {shownChunks.length === 0 ? <span className="text-muted-foreground">{running ? "Waiting for output…" : "Nothing run yet."}</span> : shownChunks.map((c, i) => <span key={i} className={c.s === "e" ? "text-destructive" : undefined}>{c.t}</span>)}
          </pre>
        </div>
      </div>

      {/* Saved scripts / history */}
      <div className="min-w-0 bg-card self-start" style={{ border: RULE }}>
        <div className="flex" style={{ borderBottom: RULE }}>
          {(["saved", "history"] as const).map((k) => (
            <button key={k} type="button" onClick={() => setSide(k)} aria-pressed={side === k}
              className={`flex-1 px-3 py-3 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] ${side === k ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground"}`}>
              {k === "saved" ? `Saved scripts${library.data ? ` · ${library.data.length}` : ""}` : "History"}
            </button>
          ))}
        </div>
        <div className="max-h-[640px] overflow-y-auto">
          {side === "saved" ? (
            library.isLoading ? <p className="p-4 text-xs text-muted-foreground">Loading…</p>
            : !library.data?.length ? <p className="p-4 text-xs text-muted-foreground">Nothing saved yet. Name a script and press Save: it is stored encrypted with the vault key.</p>
            : library.data.map((s) => (
              <div key={s.id} className={`group flex items-start gap-2 px-4 py-3 hover:bg-primary/5 ${libId === s.id ? "bg-primary/10" : ""}`} style={{ borderBottom: "1px solid hsl(var(--border) / 0.55)" }}>
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => load(s)}>
                  <p className="truncate text-sm font-semibold">{s.name}</p>
                  <p className={`${LBL} mt-0.5`}>{s.env.length ? `${s.env.length} variable(s) · ` : ""}{s.updatedAt ? fmtIstDateTime(s.updatedAt, { day: "2-digit", month: "short", year: "numeric" }) : ""}</p>
                </button>
                <button type="button" className={`${KEY_LINE} h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100`} aria-label={`Delete ${s.name}`} onClick={() => void remove(s)}><Trash2 size={10} /></button>
              </div>
            ))
          ) : history.isLoading ? <p className="p-4 text-xs text-muted-foreground">Loading…</p>
          : !history.data?.length ? <p className="p-4 text-xs text-muted-foreground">No runs yet.</p>
          : (
            <>
              <div className="flex justify-end px-4 py-2" style={{ borderBottom: "1px solid hsl(var(--border) / 0.55)" }}>
                <button type="button" className={`${KEY_LINE} h-6 px-2`} onClick={() => void history.refetch()}><RefreshCw size={10} /> Refresh</button>
              </div>
              {history.data.map((h) => (
                <button key={h.RunId} type="button" onClick={() => void openHistory(h.RunId)} className="block w-full px-4 py-3 text-left hover:bg-primary/5" style={{ borderBottom: "1px solid hsl(var(--border) / 0.55)" }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-semibold">{h.Name || "(unnamed)"}</span>
                    <SheetMark text={STATUS_TEXT[h.Status] ?? h.Status} tone={STATUS_TONE[h.Status] ?? "draft"} />
                  </div>
                  <p className={`${LBL} mt-1`}>{fmtIstDateTime(h.StartedAt, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true })} · {h.UserEmail}{h.ExitCode !== null && h.ExitCode !== undefined ? ` · exit ${h.ExitCode}` : ""}</p>
                </button>
              ))}
            </>
          )}
        </div>
        <p className="px-4 py-3 text-[0.6875rem] text-muted-foreground" style={{ borderTop: "1px solid hsl(var(--border) / 0.55)" }}>
          Locks itself after {idleMinutes} minutes without use. Every run is recorded, encrypted, with who ran it.
        </p>
      </div>
    </div>
  );
}

// ── The page ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export default function ScriptConsole() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["script-console", "status"], queryFn: getVaultStatus, refetchInterval: 15_000 });
  const [rotating, setRotating] = useState(false);
  const [currentKey, setCurrentKey] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [rotateError, setRotateError] = useState("");

  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: ["script-console"] }), [qc]);
  const lock = async () => { try { await lockVault(); } finally { await refresh(); } };
  const rotate = async () => {
    setRotateError("");
    try { setNewKey((await rotateVaultKey(currentKey)).key); setCurrentKey(""); } catch (e) { setRotateError(message(e)); }
  };

  const s = status.data;
  return (
    <>
      <Breadcrumbs items={["Dashboard", "Admin", "Script Console"]} />
      <SheetShell
        eyebrow="CivilierERP · Admin · Super admin only"
        title="Script Console"
        subtitle="Run server scripts from here, like docker exec, behind a 256-bit vault key."
        action={
          s?.unlocked ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className={TAGBOX}><MarkSquare tone="done" /> Vault open</span>
              <button type="button" className={`${KEY_LINE} h-8 px-3`} onClick={() => { setRotating(true); setNewKey(null); setRotateError(""); }}><KeyRound size={12} /> New key</button>
              <button type="button" className={`${KEY_INK} h-8 px-3`} onClick={() => void lock()}><Lock size={12} /> Lock now</button>
            </div>
          ) : undefined
        }
      >
        {status.isLoading || !s ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{status.error ? message(status.error) : "Loading…"}</p>
        ) : !s.configured ? (
          <VaultSetup onDone={() => void refresh()} />
        ) : !s.unlocked ? (
          <VaultUnlock lockedOutSec={s.lockedOutSec} onUnlocked={() => void refresh()} />
        ) : (
          <>
            {rotating && (
              <div className="bg-card" style={{ border: RULE }}>
                <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: RULE }}>
                  <span className={HEAD}>New vault key</span>
                  <button type="button" className={`${KEY_LINE} h-7 w-7`} aria-label="Close" onClick={() => { setRotating(false); setNewKey(null); }}><X size={12} /></button>
                </div>
                <div className="space-y-4 p-5">
                  {newKey ? (
                    <KeyReveal vaultKey={newKey} doneLabel="Done" onDone={() => { setRotating(false); setNewKey(null); void refresh(); }} />
                  ) : (
                    <>
                      <p className="text-sm">A new key replaces the old one, which stops working. Saved scripts and history are re-encrypted under the new key. Every open vault, on any sign-in, is locked.</p>
                      <label className="grid gap-1.5 text-sm">
                        <span className={LBL}>Current vault key</span>
                        <SecretInput masked value={currentKey} onChange={setCurrentKey} label="Current vault key" className={`${INPUT} h-10 px-3 font-mono text-sm tracking-wider`} />
                      </label>
                      {rotateError && <p className="text-sm text-destructive">{rotateError}</p>}
                      <button type="button" className={`${KEY_INK} h-10 px-6`} disabled={!currentKey} onClick={() => void rotate()}>Make a new key</button>
                    </>
                  )}
                </div>
              </div>
            )}
            <Runner idleMinutes={s.idleMinutes} onLocked={() => void refresh()} />
          </>
        )}
      </SheetShell>
    </>
  );
}
