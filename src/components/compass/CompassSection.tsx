import type React from "react";
import { Command as CommandPrimitive } from "cmdk";

// A section of results, headed like a detail on the sheet: its name in capitals, a rule, and how many rows it holds.
export function CompassSection({
  title,
  count,
  className,
  children,
}: {
  title: React.ReactNode;
  count?: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <CommandPrimitive.Group
      className={className}
      heading={
        <span className="c-section-head">
          <span className="c-label c-title">{title}</span>
          <span className="c-rule" />
          {count != null && <span className="c-label">{count}</span>}
        </span>
      }
    >
      {children}
    </CommandPrimitive.Group>
  );
}
