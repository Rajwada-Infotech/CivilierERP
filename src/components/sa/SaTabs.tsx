import React from "react";

// One shared tab-switcher primitive — was hand-rolled independently in
// SaAdMaster.tsx (List/Performance) and, before this overhaul, in
// SaLeadManagement.tsx and SaLeadDistribution.tsx too (both now gone or
// reduced to 2 tabs using this same style). Same pill-in-a-muted-box look
// used throughout the module; no more per-page reinventions of it.
export interface SaTabDef<K extends string> {
  key: K;
  label: string;
  icon?: React.ElementType;
}

interface SaTabsProps<K extends string> {
  tabs: SaTabDef<K>[];
  active: K;
  onChange: (key: K) => void;
}

export function SaTabs<K extends string>({ tabs, active, onChange }: SaTabsProps<K>) {
  return (
    <div className="flex gap-1 p-1 rounded-lg border border-border bg-muted/30 w-fit">
      {tabs.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            active === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {Icon && <Icon size={13} />} {label}
        </button>
      ))}
    </div>
  );
}
