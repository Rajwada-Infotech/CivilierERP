import React from "react";
import { ChevronRight } from "lucide-react";

type BreadcrumbItem = string | { label: string; path?: string };

export const Breadcrumbs: React.FC<{ items: BreadcrumbItem[] }> = ({
  items,
}) => (
  <nav className="flex items-center gap-1 text-xs text-muted-foreground mb-4 font-heading">
    {items.map((item, i) => {
      const label = typeof item === "string" ? item : item.label;
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
