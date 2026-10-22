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
            ? "text-orange-600 dark:text-orange-400"
            : "text-emerald-600 dark:text-emerald-400"
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
          className="w-full pl-9 pr-8 py-2.5 rounded-xl border border-border bg-background text-sm text-foreground outline-none appearance-none transition-colors focus:border-primary/60"
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
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-muted/30">
          <Warehouse size={12} className="text-muted-foreground shrink-0" />
          <p
            className={`text-xs font-semibold truncate ${
              isFrom
                ? "text-orange-700 dark:text-orange-400"
                : "text-emerald-700 dark:text-emerald-400"
            }`}
          >
            {selected.GodownName}
          </p>
        </div>
      )}
    </div>
  );
}
