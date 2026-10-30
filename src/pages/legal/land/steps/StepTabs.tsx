import React, { useState } from "react";
import { LegalMasterTable } from "../../LegalMasterPage";

// Tabs of a pipeline step, each one a land-scoped Legal table (or custom content), as in Ownership.

export const stepCard = "rounded-2xl bg-card/80 backdrop-blur-lg border border-border shadow-sm";

export interface StepTab {
  key: string;
  label: string;
  /** Land-scoped masters shown in this tab, top to bottom. */
  tables?: { key: string; label: string; noAdd?: boolean }[];
  /** A note above the tables. */
  note?: React.ReactNode;
  /** Custom content instead of / above the tables. */
  content?: React.ReactNode;
}

export const StepTabs: React.FC<{ landId: number; tabs: StepTab[]; onSaved: () => void }> = ({ landId, tabs, onSaved }) => {
  const [active, setActive] = useState(tabs[0].key);
  const tab = tabs.find((t) => t.key === active) ?? tabs[0];
  return (
    <div className="space-y-4">
      <div className="-mx-1 flex gap-1 overflow-x-auto pb-1" role="tablist">
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={t.key === tab.key} onClick={() => setActive(t.key)}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${t.key === tab.key ? "bg-foreground text-background" : "border border-border hover:bg-muted"}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab.note && <p className="text-xs text-muted-foreground">{tab.note}</p>}
      {tab.content}
      {tab.tables?.map((tb) => (
        <div key={tb.key} className={stepCard}>
          <LegalMasterTable entry={{ pageKey: "legal-land-master", key: tb.key, label: tb.label }} parentId={landId} onSaved={onSaved} noAdd={tb.noAdd} />
        </div>
      ))}
    </div>
  );
};
