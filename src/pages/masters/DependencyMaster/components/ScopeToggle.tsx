import type { WorkType } from "@/api/dependencyMasterApi";

interface Props {
  active: boolean;
  value: WorkType;
  onChange: (v: WorkType) => void;
}

// Step 3 — Internal / External, appears right after the alias is set.
export function ScopeToggle({ active, value, onChange }: Props) {
  if (!active) return null;
  return (
    <div className="flex items-center gap-3">
      <span className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60">
        Work Type
      </span>
      <div className="inline-flex rounded-lg border border-border overflow-hidden">
        {(["INTERNAL", "EXTERNAL"] as WorkType[]).map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={`px-3 py-1.5 text-xs font-heading font-semibold tracking-wide transition-colors ${
              value === opt
                ? opt === "INTERNAL"
                  ? "bg-orange-500 text-white"
                  : "bg-sky-500 text-white"
                : "bg-background text-muted-foreground hover:bg-muted"
            }`}
          >
            {opt === "INTERNAL" ? "Internal" : "External"}
          </button>
        ))}
      </div>
    </div>
  );
}
