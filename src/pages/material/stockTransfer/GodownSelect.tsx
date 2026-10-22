import { Warehouse, ChevronDown } from "lucide-react";
import { type Godown } from "@/api/godownsApi";

// ─── Godown Select ────────────────────────────────────────────────────────────
export function GodownSelect({
  label,
  value,
  onChange,
  godowns,
  exclude,
  variant,
  placeholder,
}: {
  label: string;
  value: number | null;
  onChange: (id: number | null) => void;
  godowns: Godown[];
  exclude?: number | null;
  variant: "from" | "to";
  placeholder: string;
}) {
  const isFrom = variant === "from";
  const selected = godowns.find((g) => g.GodownID === value);

  return (
    <div className="flex-1 space-y-2">
      <p
        className={`text-xs font-semibold uppercase tracking-wider ${
          isFrom
            ? "text-foreground"
            : "text-foreground"
        }`}
      >
        {label}
      </p>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none z-10">
          <Warehouse size={14} className="text-muted-foreground" />
        </span>
        <select
          value={value != null ? String(value) : ""}
          onChange={(e) =>
            onChange(e.target.value === "" ? null : Number(e.target.value))
          }
          className="w-full pl-9 pr-8 py-2.5 border border-foreground bg-card text-sm text-foreground outline-none appearance-none transition-colors focus:border-primary/60"
          style={{ colorScheme: "dark" }}
        >
          <option value="" className="bg-popover text-foreground">
            {placeholder}
          </option>
          {godowns
            .filter((g) => g.GodownID !== exclude)
            .map((g) => (
              <option
                key={g.GodownID}
                value={g.GodownID}
                className="bg-popover text-foreground"
              >
                {g.GodownName}
              </option>
            ))}
        </select>
        <ChevronDown
          size={13}
          className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground"
        />
      </div>
      {selected && (
        <div className="flex items-center gap-2 px-3 py-2 border border-foreground bg-card">
          <Warehouse size={12} className="text-muted-foreground shrink-0" />
          <p
            className={`text-xs font-semibold truncate ${
              isFrom
                ? "text-foreground"
                : "text-foreground"
            }`}
          >
            {selected.GodownName}
          </p>
        </div>
      )}
    </div>
  );
}
