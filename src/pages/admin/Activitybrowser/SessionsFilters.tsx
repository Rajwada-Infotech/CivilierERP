// The Sessions & Log filter strip: period, year, month, the kind of action, search and role.
import React from "react";
import { format } from "date-fns";
import { ChevronDown, Search, X } from "lucide-react";
import type { ActivityActionType } from "@/api/userActivityApi";
import { PRESETS, YEARS, MONTHS } from "./constants";
import { INPUT, LBL, RULE, SELECT, chip, kindLabel } from "./activityShared";

export type RoleFilter = "all" | "super_admin" | "admin" | "user";

const QUICK: ActivityActionType[] = ["create", "update", "delete", "read", "export"];

const Select: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = ({ children, ...rest }) => (
  <div className="relative">
    <select {...rest} className={SELECT}>
      {children}
    </select>
    <ChevronDown size={12} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
  </div>
);

export const SessionsFilters: React.FC<{
  period?: string;
  setDateFilters: (f: Record<string, unknown>) => void;
  clearDateFilters: () => void;
  quickFilter: ActivityActionType | null;
  setQuickFilter: (f: ActivityActionType | null) => void;
  search: string;
  setSearch: (s: string) => void;
  filterRole: RoleFilter;
  setFilterRole: (r: RoleFilter) => void;
}> = ({ period, setDateFilters, clearDateFilters, quickFilter, setQuickFilter, search, setSearch, filterRole, setFilterRole }) => (
  <div className="bg-card" style={{ border: RULE }}>
    <div className="flex flex-wrap items-center gap-2 px-4 py-3" style={{ borderBottom: "1px solid hsl(var(--foreground) / 0.2)" }}>
      <span className={`${LBL} mr-1`}>When</span>
      <Select value={period || ""} onChange={(e) => setDateFilters({ period: e.target.value as any })}>
        <option value="" disabled>Period</option>
        {PRESETS.map((p) => (
          <option key={p.period} value={p.period}>{p.label}</option>
        ))}
      </Select>
      <Select
        defaultValue=""
        onChange={(e) => {
          const y = parseInt(e.target.value);
          setDateFilters({ dateFrom: `${y}-01-01`, dateTo: `${y}-12-31` });
        }}
      >
        <option value="" disabled>Year</option>
        {YEARS.map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </Select>
      <Select
        defaultValue=""
        onChange={(e) => {
          const m = parseInt(e.target.value);
          const y = new Date().getFullYear();
          setDateFilters({ dateFrom: format(new Date(y, m, 1), "yyyy-MM-dd"), dateTo: format(new Date(y, m + 1, 0), "yyyy-MM-dd") });
        }}
      >
        <option value="" disabled>Month</option>
        {MONTHS.map((m) => (
          <option key={m.value} value={m.value}>{m.label}</option>
        ))}
      </Select>
      <button onClick={clearDateFilters} className={`${chip(false)} inline-flex items-center gap-1`}>
        <X size={10} /> Clear
      </button>

      <span className={`${LBL} ml-3 mr-1`}>Kind</span>
      {QUICK.map((k) => (
        <button key={k} onClick={() => setQuickFilter(quickFilter === k ? null : k)} aria-pressed={quickFilter === k} className={chip(quickFilter === k)}>
          {kindLabel(k)}
        </button>
      ))}
    </div>

    <div className="flex flex-wrap items-center gap-2 px-4 py-3">
      <div className="relative flex-1 min-w-0 sm:min-w-[220px] max-w-md">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search user, IP, device, resource…" className={`${INPUT} h-9 pl-9 pr-3`} />
      </div>
      <Select value={filterRole} onChange={(e) => setFilterRole(e.target.value as RoleFilter)}>
        <option value="all">All roles</option>
        <option value="super_admin">Super Admin</option>
        <option value="admin">Admin</option>
        <option value="user">User</option>
      </Select>
    </div>
  </div>
);
