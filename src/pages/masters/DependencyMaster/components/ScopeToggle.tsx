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
    <div className="flex items-center gap-3 flex-wrap">
      <div className="seg">
        {(["INTERNAL", "EXTERNAL"] as WorkType[]).map((opt) => (
          <button key={opt} type="button" onClick={() => onChange(opt)} aria-pressed={value === opt} className={value === opt ? "on" : undefined}>
            {opt === "INTERNAL" ? "Internal" : "External"}
          </button>
        ))}
      </div>
      <span className="text-[0.6875rem] text-muted-foreground">
        {value === "INTERNAL" ? "Work inside the unit." : "Work outside the unit."}
      </span>
    </div>
  );
}
