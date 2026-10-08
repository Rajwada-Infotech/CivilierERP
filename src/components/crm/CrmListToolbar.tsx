import React from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CrmStatusTab {
  key: string;
  label: string;
  count?: number;
  /** Tailwind bg class for the small status dot, e.g. "bg-green-500". */
  dot?: string;
}

interface Props {
  tabs: CrmStatusTab[];
  status: string;
  onStatus: (key: string) => void;
  searchValue: string;
  onSearch: (v: string) => void;
  placeholder?: string;
  /** Extra filters (e.g. the Company/Project/Block selects). */
  children?: React.ReactNode;
}

/** One compact row: status chips with server counts · search · filters. */
export function CrmListToolbar({ tabs, status, onStatus, searchValue, onSearch, placeholder = "Search…", children }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1 flex-wrap" role="group" aria-label="Filter by status">
        {tabs.map((t) => {
          const active = status === t.key;
          return (
            <button key={t.key} type="button" aria-pressed={active} onClick={() => onStatus(t.key)}
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border transition-colors",
                active ? "bg-foreground text-background border-foreground"
                       : "bg-background text-muted-foreground border-border hover:text-foreground hover:bg-muted/50",
              )}>
              {t.dot && <span className={cn("w-1.5 h-1.5 rounded-full", t.dot)} />}
              {t.label}
              {t.count !== undefined && <span className="tabular-nums opacity-70">{t.count}</span>}
            </button>
          );
        })}
      </div>
      <div className="ml-auto flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={searchValue} onChange={(e) => onSearch(e.target.value)} placeholder={placeholder}
            aria-label="Search"
            className="w-full sm:w-64 text-sm pl-7 pr-7 py-1.5 border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
          {searchValue && (
            <button type="button" onClick={() => onSearch("")} aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X size={12} />
            </button>
          )}
        </div>
      </div>
      {children && (
        <div className="w-full mt-1 flex justify-end">
          {children}
        </div>
      )}
    </div>
  );
}