// By User, left side: everyone with activity in the period, with how much they changed.
import React from "react";
import { Loader2, Search } from "lucide-react";
import type { UserActivitySummary } from "@/api/userActivityApi";
import { INPUT, LBL, RULE, chip } from "./activityShared";

export const RANGES = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "all", label: "All time" },
] as const;
export type RangeKey = (typeof RANGES)[number]["key"];

export const ago = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};

export const PeopleList: React.FC<{
  users: UserActivitySummary[];
  loading: boolean;
  search: string;
  setSearch: (s: string) => void;
  range: RangeKey;
  setRange: (r: RangeKey) => void;
  selected: string | null;
  setSelected: (id: string) => void;
}> = ({ users, loading, search, setSearch, range, setRange, selected, setSelected }) => (
  <div className="bg-card flex flex-col lg:max-h-[calc(100vh-14rem)]" style={{ border: RULE }}>
    <div className="p-3 space-y-2.5" style={{ borderBottom: RULE }}>
      <div className="relative">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a person…" className={`${INPUT} h-9 pl-9 pr-3`} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {RANGES.map((r) => (
          <button key={r.key} onClick={() => setRange(r.key)} aria-pressed={range === r.key} className={chip(range === r.key)}>
            {r.label}
          </button>
        ))}
      </div>
    </div>
    <div className="overflow-y-auto flex-1">
      {loading ? (
        <p className="p-6 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </p>
      ) : users.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">No activity in this period.</p>
      ) : (
        users.map((u) => {
          const changes = u.creates + u.updates + u.deletes + u.others;
          const active = u.userId === selected;
          return (
            <button
              key={u.userId}
              onClick={() => setSelected(u.userId)}
              aria-pressed={active}
              className={`w-full text-left px-3.5 py-3 border-b border-foreground/10 transition-colors ${active ? "bg-primary/10" : "hover:bg-primary/5"}`}
              style={active ? { boxShadow: "inset 3px 0 0 hsl(var(--foreground))" } : undefined}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-foreground truncate">{u.userName}</p>
                <span className={`${LBL} shrink-0`}>{ago(u.lastSeen)}</span>
              </div>
              <p className="text-[0.6875rem] text-muted-foreground truncate">{u.userEmail || "—"}</p>
              <p className="mt-1 text-[0.6875rem] text-muted-foreground">
                <span className="font-heading font-semibold tabular-nums text-foreground">{changes.toLocaleString("en-IN")}</span> changes ·{" "}
                {u.reads.toLocaleString("en-IN")} pages · {u.sessions} session{u.sessions === 1 ? "" : "s"}
              </p>
            </button>
          );
        })
      )}
    </div>
  </div>
);
