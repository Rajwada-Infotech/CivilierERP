import { Route as RouteIcon, Tag } from "lucide-react";

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
    <div className={`rounded-xl border p-4 transition-opacity ${active ? "border-border" : "border-dashed border-border/60 opacity-50"}`}>
      <div className="flex flex-col gap-1 mb-2">
        <span className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60 flex items-center gap-1">
          <RouteIcon size={9} /> Resolved Path
        </span>
        <span className="text-xs font-mono text-foreground/80 truncate">
          {resolvedPath || "Select Project through Room above to resolve the path"}
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        <label className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60 flex items-center gap-1">
          <Tag size={9} /> Alias <span className="text-destructive">*</span>
        </label>
        <input
          type="text"
          value={value}
          disabled={!active}
          onChange={(e) => onChange(e.target.value)}
          placeholder={active ? "e.g. Master Bedroom Wiring" : "Complete the scope above first…"}
          maxLength={200}
          className={`h-9 px-2.5 rounded-lg text-sm border focus:outline-none focus:ring-2 focus:ring-primary/30 ${
            active
              ? "border-border bg-background text-foreground"
              : "border-border bg-muted/40 text-muted-foreground cursor-not-allowed"
          }`}
        />
      </div>
    </div>
  );
}
