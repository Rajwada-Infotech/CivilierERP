import React, { useEffect, useState } from "react";

// Making a user active or inactive asks for a written reason first (the server refuses the change without one, and keeps the
// reason in the activity log). Used by every screen that has a status button.
export const MIN_STATUS_REASON = 5;

export function UserStatusDialog({
  userName,
  makeActive,
  busy,
  onConfirm,
  onClose,
}: {
  userName: string;
  /** true: the user is being switched back on; false: being switched off */
  makeActive: boolean;
  busy?: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const ok = reason.trim().length >= MIN_STATUS_REASON;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={busy ? undefined : onClose} role="presentation">
      <form
        role="dialog"
        aria-modal="true"
        aria-label={`${makeActive ? "Activate" : "Deactivate"} ${userName}`}
        className="w-full max-w-sm bg-card p-6"
        style={{ border: "1px solid hsl(var(--foreground))", boxShadow: "8px 8px 0 hsl(var(--foreground) / 0.12)" }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); if (ok && !busy) onConfirm(reason.trim()); }}
      >
        <p className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {makeActive ? "Activate user" : "Deactivate user"}
        </p>
        <h2 className="font-heading text-lg font-bold tracking-tight text-foreground mt-1 truncate">{userName}</h2>
        <p className="text-sm text-muted-foreground mt-2">
          {makeActive
            ? "They will be able to sign in again."
            : "They are signed out at once and cannot sign in until someone switches them back on."}{" "}
          Say why: the reason is kept in the activity log with your name.
        </p>
        <textarea
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={100}
          placeholder="Reason (at least 5 characters)"
          className="mt-3 w-full border border-foreground/40 focus:border-foreground bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none resize-none"
        />
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" onClick={onClose} disabled={busy}
            className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] h-9 px-4 border border-foreground text-foreground hover:bg-primary/10 disabled:opacity-40">
            Cancel
          </button>
          <button type="submit" disabled={!ok || busy}
            className={`font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] h-9 px-4 border disabled:opacity-40 disabled:cursor-not-allowed ${makeActive ? "bg-foreground text-card border-foreground" : "bg-destructive text-destructive-foreground border-destructive"}`}>
            {busy ? "Saving…" : makeActive ? "Activate" : "Deactivate"}
          </button>
        </div>
      </form>
    </div>
  );
}
