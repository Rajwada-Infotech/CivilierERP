import React from "react";
import { ChevronRight } from "lucide-react";

export const Breadcrumbs: React.FC<{ items: string[] }> = ({ items }) => (
  <nav className="flex items-center gap-1 text-xs text-muted-foreground mb-4 font-heading">
    {items.map((item, i) => (
      <React.Fragment key={i}>
        {i > 0 && <ChevronRight size={12} />}
        <span className={i === items.length - 1 ? "text-foreground font-medium" : ""}>{item}</span>
      </React.Fragment>
    ))}
  </nav>
);
