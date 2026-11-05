
interface Props {
  active: boolean;
  value: string;
  onChange: (v: string) => void;
  resolvedPath: string;
}

// Step 2 — only usable once all 5 scope levels are locked in. Shows the
// resolved path read-only right next to the input so the user isn't typing
// an alias blind, without them.
export function AliasInput({ active, value, onChange, resolvedPath }: Props) {
  return (
    <div className={`p-4 border transition-opacity ${active ? "border-foreground/40" : "border-dashed border-foreground/30 opacity-60"}`}>
      <div className="flex flex-col gap-1 mb-3">
        <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Resolved path</span>
        <span className="text-xs text-foreground break-words">
          {resolvedPath || "Select Project through Room above to resolve the path"}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <label className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Alias <span className="text-destructive">*</span>
        </label>
        <input
          type="text"
          value={value}
          disabled={!active}
          onChange={(e) => onChange(e.target.value)}
          placeholder={active ? "e.g. Master Bedroom Wiring" : "Complete the scope above first…"}
          maxLength={200}
          className={`h-10 px-3 text-sm border bg-card focus:outline-none ${
            active
              ? "border-foreground/40 focus:border-foreground text-foreground"
              : "border-dashed border-foreground/30 text-muted-foreground cursor-not-allowed"
          }`}
        />
      </div>
    </div>
  );
}
