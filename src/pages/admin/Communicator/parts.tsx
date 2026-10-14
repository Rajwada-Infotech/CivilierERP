import React from "react";
import { Loader2, Save } from "lucide-react";
import { SheetMark } from "@/components/sheet/Sheet";

export const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
export const HEAD = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground";
export const RULE = "1px solid hsl(var(--foreground))";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const FIELD = "w-full h-9 px-2.5 border border-foreground/40 focus:border-foreground bg-card text-sm text-foreground placeholder:text-muted-foreground/60 outline-none disabled:opacity-60";
export const chip = (on: boolean) =>
  `${KEY} h-8 px-3 border ${on ? "bg-foreground text-card border-foreground" : "border-foreground/40 text-muted-foreground hover:text-foreground hover:border-foreground"}`;

/** A ruled box with an ink heading strip. */
export const Box: React.FC<{ title: string; note?: string; children: React.ReactNode; className?: string }> = ({ title, note, children, className }) => (
  <div className={`bg-card ${className || ""}`} style={{ border: RULE }}>
    <div className="px-4 py-3 flex items-baseline justify-between gap-3" style={{ borderBottom: RULE }}>
      <span className={HEAD}>{title}</span>
      {note && <span className="text-xs text-muted-foreground truncate">{note}</span>}
    </div>
    <div className="p-4">{children}</div>
  </div>
);

export const Field: React.FC<
  { id: string; label: string; wide?: boolean; hint?: React.ReactNode } & React.InputHTMLAttributes<HTMLInputElement>
> = ({ id, label, wide, hint, className, ...input }) => (
  <div className={`space-y-1.5 ${wide ? "sm:col-span-2" : ""}`}>
    <label htmlFor={id} className={`${LBL} block`}>{label}</label>
    <input id={id} className={`${FIELD} ${className || ""}`} {...input} />
    {hint && <p className="text-[0.6875rem] text-muted-foreground">{hint}</p>}
  </div>
);

/** Off / On switch drawn as two ink keys. */
export const DeliverySwitch: React.FC<{ label: string; sub: string; on: boolean; onChange: (on: boolean) => void; disabled?: boolean }> = ({ label, sub, on, onChange, disabled }) => (
  <div className="flex flex-wrap items-center justify-between gap-3 py-3 border-t border-b border-foreground/20">
    <div>
      <p className={HEAD}>{label}</p>
      <p className="text-xs text-muted-foreground mt-1">{sub}</p>
    </div>
    <div className="inline-flex items-stretch border border-foreground" role="group" aria-label={label}>
      <button type="button" disabled={disabled} aria-pressed={!on} onClick={() => onChange(false)} className={`${KEY} h-8 px-4 ${!on ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground"}`}>Off</button>
      <button type="button" disabled={disabled} aria-pressed={on} onClick={() => onChange(true)} className={`${KEY} h-8 px-4 border-l border-foreground ${on ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground"}`}>On</button>
    </div>
  </div>
);

export const SaveKey: React.FC<{ pending: boolean; onClick: () => void }> = ({ pending, onClick }) => (
  <div className="flex justify-end pt-1">
    <button type="button" onClick={onClick} disabled={pending} className={`${KEY} h-9 px-5 bg-foreground text-card border border-foreground`}>
      {pending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save configuration
    </button>
  </div>
);

/** Sending when switched on with every setting the server needs; red when switched on but incomplete. */
export const StatusBox: React.FC<{ on: boolean; missing: string[]; sendingText: string; offText: string }> = ({ on, missing, sendingText, offText }) => {
  const complete = missing.length === 0;
  return (
    <div className={`bg-card p-4 space-y-2 border ${on && complete ? "border-foreground" : on ? "border-destructive" : "border-dashed border-foreground"}`}>
      <p className={LBL}>Status</p>
      {on && complete ? <SheetMark text="Sending" tone="done" /> : on ? <SheetMark text="Incomplete" tone="stopped" /> : <SheetMark text="Switched off" tone="waiting" />}
      <p className={`text-xs leading-relaxed ${on && !complete ? "text-destructive" : "text-muted-foreground"}`}>
        {on && complete ? sendingText : on ? `Switched on, but missing ${missing.join(", ")}. Nothing is sent until they are filled and saved.` : offText}
      </p>
    </div>
  );
};

export const NoteBox: React.FC<{ title: string; items: React.ReactNode[] }> = ({ title, items }) => (
  <div className="bg-card" style={{ border: RULE }}>
    <p className={`${HEAD} px-4 py-2.5`} style={{ borderBottom: RULE }}>{title}</p>
    <ul className="px-4 py-1">
      {items.map((item, i) => (
        <li key={i} className="text-xs text-muted-foreground py-2 border-b border-foreground/10 last:border-b-0">{item}</li>
      ))}
    </ul>
  </div>
);

export const Loading = () => (
  <div className="flex justify-center py-10">
    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
  </div>
);
