import React from "react";
import { ChevronDown } from "lucide-react";

// ─── Filter Select ────────────────────────────────────────────────────────────
export function FilterSelect({
  icon: Icon,
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
}) {
  return (
    <div className="flex-1 space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none z-10">
          <Icon size={14} className="text-muted-foreground" />
        </span>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full pl-9 pr-8 py-2.5 rounded-xl border border-border bg-background text-sm text-foreground outline-none appearance-none transition-colors focus:border-primary/60"
          style={{ colorScheme: "dark" }}
        >
          <option value="" className="bg-popover text-foreground">
            {placeholder}
          </option>
          {options.map((o) => (
            <option
              key={o.value}
              value={o.value}
              className="bg-popover text-foreground"
            >
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={13}
          className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground"
        />
      </div>
    </div>
  );
}
