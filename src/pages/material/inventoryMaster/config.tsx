import React from "react";

// ─── Field ────────────────────────────────────────────────────────────────────
export function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

export const inputCls =
  "w-full px-3 py-2 border border-foreground/40 bg-card text-sm text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-foreground transition-colors";
