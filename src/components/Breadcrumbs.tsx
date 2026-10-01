import React from "react";
import { ChevronRight } from "lucide-react";
import { useModule } from "@/contexts/ModuleContext";

type BreadcrumbItem = string | { label: string; path?: string };

// Follow-Up setup masters are also served under /crm/setup/*; there the
// trail should name the module the user is actually in.
const MODULE_ALIASES: Record<string, Record<string, string>> = {
  crm: { "Follow-Up": "CRM" },
};

export const Breadcrumbs: React.FC<{ items: BreadcrumbItem[] }> = ({
  items,
}) => {
  const { activeModule } = useModule();
  const aliases = (activeModule && MODULE_ALIASES[activeModule]) || {};
  return (
  <nav className="flex items-center gap-1 text-xs text-muted-foreground mb-4 font-heading">
    {items.map((item, i) => {
      const raw = typeof item === "string" ? item : item.label;
      const label = aliases[raw] ?? raw;
      return (
        <React.Fragment key={i}>
          {i > 0 && <ChevronRight size={12} />}
          <span
            className={
              i === items.length - 1 ? "text-foreground font-medium" : ""
            }
          >
            {label}
          </span>
        </React.Fragment>
      );
    })}
  </nav>
);
};
