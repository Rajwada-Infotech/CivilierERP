import React, { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import {
  getActivityUsers,
  getUserActivity,
  type SessionEvent,
  type UserActivitySummary,
  type UserActivityType,
} from "@/api/userActivityApi";
import { describeActivity } from "./describeActivity";
import { ROLE_COLORS } from "./constants";

const IST = "Asia/Kolkata";

// Date-only boundaries, like the other activity filters (the server reads them as UTC days).
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

const RANGES = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "all", label: "All time" },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

function rangeDates(key: RangeKey): { dateFrom?: string; dateTo?: string } {
  const today = new Date();
  if (key === "today") return { dateFrom: isoDay(today), dateTo: isoDay(today) };
  if (key === "yesterday") return { dateFrom: isoDay(addDays(today, -1)), dateTo: isoDay(addDays(today, -1)) };
  if (key === "7d") return { dateFrom: isoDay(addDays(today, -6)), dateTo: isoDay(today) };
  if (key === "30d") return { dateFrom: isoDay(addDays(today, -29)), dateTo: isoDay(today) };
  return {};
}

const KIND_STYLE: Record<string, string> = {
  login: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  logout: "bg-slate-500/10 text-slate-500 border-slate-500/20",
  create: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  update: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  delete: "bg-rose-500/10 text-rose-600 border-rose-500/20",
  export: "bg-cyan-500/10 text-cyan-600 border-cyan-500/20",
  settings_change: "bg-orange-500/10 text-orange-600 border-orange-500/20",
  read: "bg-sky-500/10 text-sky-600 border-sky-500/20",
};

const timeIst = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: IST });
const dayKeyIst = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: IST });
const dayLabelIst = (key: string) =>
  new Date(`${key}T12:00:00+05:30`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short", year: "numeric", timeZone: IST });
const ago = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-3.5 py-2.5 min-w-[88px]">
      <p className="text-[0.625rem] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${tone || "text-foreground"}`}>{value.toLocaleString("en-IN")}</p>
    </div>
  );
}

function EventRow({ e }: { e: SessionEvent }) {
  const d = describeActivity(e);
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-border/60 last:border-0">
      <span className="w-16 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">{timeIst(e.timestamp)}</span>
      <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-wider ${KIND_STYLE[d.kind] || KIND_STYLE.read}`}>
        {d.kind === "settings_change" ? "settings" : d.kind === "read" ? "opened" : d.kind}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground">
          {d.verb}
          {d.subject ? <span className="font-semibold"> {d.subject}</span> : null}
          {d.where ? <span className="text-muted-foreground"> · from {d.where}</span> : null}
        </p>
        {(e.event !== "action" || e.ipAddress) && (
          <p className="text-[0.6875rem] text-muted-foreground truncate">
            {e.ipAddress && e.ipAddress !== "unknown" ? e.ipAddress : ""}
            {e.event === "login" && e.deviceInfo && e.deviceInfo !== "unknown" ? ` · ${e.deviceInfo}` : ""}
          </p>
        )}
      </div>
    </div>
  );
}

export default function ActivityByUser() {
  const [range, setRange] = useState<RangeKey>("7d");
  const [type, setType] = useState<UserActivityType>("changes");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const dates = useMemo(() => rangeDates(range), [range]);

  const { data: users = [], isLoading: loadingUsers } = useQuery({
    queryKey: ["activity-users", dates],
    queryFn: () => getActivityUsers(dates),
    refetchInterval: 60_000,
  });

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? users.filter((u) => `${u.userName} ${u.userEmail ?? ""}`.toLowerCase().includes(q)) : users;
  }, [users, search]);

  // Keep a valid person selected: the first one until the viewer picks, and again if the list changes under them.
  useEffect(() => {
    if (!filteredUsers.length) return;
    if (!selected || !filteredUsers.some((u) => u.userId === selected)) setSelected(filteredUsers[0].userId);
  }, [filteredUsers, selected]);

  const current: UserActivitySummary | undefined = users.find((u) => u.userId === selected);

  const events = useInfiniteQuery({
    queryKey: ["activity-user", selected, dates, type],
    enabled: !!selected,
    initialPageParam: 1,
    queryFn: ({ pageParam }) => getUserActivity(selected as string, { ...dates, type, page: pageParam, limit: 100 }),
    getNextPageParam: (last) => (last.page < last.pages ? last.page + 1 : undefined),
  });

  const rows = events.data?.pages.flatMap((p) => p.data) ?? [];
  const total = events.data?.pages[0]?.total ?? 0;
  const days = useMemo(() => {
    const groups: { key: string; items: SessionEvent[] }[] = [];
    for (const r of rows) {
      const k = dayKeyIst(r.timestamp);
      const g = groups[groups.length - 1];
      if (g && g.key === k) g.items.push(r);
      else groups.push({ key: k, items: [r] });
    }
    return groups;
  }, [rows]);

  const TYPES: { key: UserActivityType; label: string }[] = [
    { key: "changes", label: "Changes" },
    { key: "all", label: "Everything" },
    { key: "reads", label: "Pages opened" },
    { key: "logins", label: "Sign-ins" },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      {/* People */}
      <div className="rounded-2xl border border-border bg-card flex flex-col lg:max-h-[calc(100vh-14rem)]">
        <div className="p-3 space-y-2.5 border-b border-border">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find a person…"
              className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-primary"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={`rounded-full border px-2.5 py-1 text-[0.6875rem] font-medium transition-colors ${
                  range === r.key ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-y-auto flex-1">
          {loadingUsers ? (
            <p className="p-6 text-center text-sm text-muted-foreground flex items-center justify-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</p>
          ) : filteredUsers.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">No activity in this period.</p>
          ) : (
            filteredUsers.map((u) => {
              const changes = u.creates + u.updates + u.deletes + u.others;
              const active = u.userId === selected;
              return (
                <button
                  key={u.userId}
                  onClick={() => setSelected(u.userId)}
                  className={`w-full text-left px-3.5 py-3 border-b border-border/60 transition-colors ${active ? "bg-primary/10" : "hover:bg-muted/50"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground truncate">{u.userName}</p>
                    <span className="shrink-0 text-[0.6875rem] text-muted-foreground">{ago(u.lastSeen)}</span>
                  </div>
                  <p className="text-[0.6875rem] text-muted-foreground truncate">{u.userEmail || "—"}</p>
                  <p className="mt-1 text-[0.6875rem] text-muted-foreground">
                    <span className="font-semibold text-foreground">{changes.toLocaleString("en-IN")}</span> changes · {u.reads.toLocaleString("en-IN")} pages · {u.sessions} session{u.sessions === 1 ? "" : "s"}
                  </p>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* One person */}
      <div className="rounded-2xl border border-border bg-card min-w-0">
        {!current ? (
          <p className="p-10 text-center text-sm text-muted-foreground">Pick a person to see what they did.</p>
        ) : (
          <>
            <div className="p-4 border-b border-border space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-bold text-foreground">{current.userName}</h3>
                {current.userRole && (
                  <span className={`rounded-md border px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-wider ${ROLE_COLORS[current.userRole] || ROLE_COLORS.user}`}>
                    {current.userRole.replace("_", " ")}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">{current.userEmail}</span>
                <span className="ml-auto text-xs text-muted-foreground">Last seen {ago(current.lastSeen)}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Stat label="Sessions" value={current.sessions} />
                <Stat label="Created" value={current.creates} tone="text-emerald-600" />
                <Stat label="Updated" value={current.updates} tone="text-amber-600" />
                <Stat label="Deleted" value={current.deletes} tone="text-rose-600" />
                <Stat label="Pages opened" value={current.reads} tone="text-sky-600" />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {TYPES.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setType(t.key)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      type === t.key ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
                <span className="ml-auto self-center text-xs text-muted-foreground">{total.toLocaleString("en-IN")} event{total === 1 ? "" : "s"}</span>
              </div>
            </div>

            <div className="px-4 pb-4 lg:max-h-[calc(100vh-24rem)] overflow-y-auto">
              {events.isLoading ? (
                <p className="py-10 text-center text-sm text-muted-foreground flex items-center justify-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</p>
              ) : days.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">Nothing of this kind in the selected period.</p>
              ) : (
                days.map((g) => (
                  <section key={g.key}>
                    <h4 className="sticky top-0 z-[1] bg-card/95 backdrop-blur py-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      {dayLabelIst(g.key)} <span className="font-normal">· {g.items.length}</span>
                    </h4>
                    {g.items.map((e) => (
                      <EventRow key={e.id || `${e.timestamp}-${e.resource}`} e={e} />
                    ))}
                  </section>
                ))
              )}
              {events.hasNextPage && (
                <button
                  onClick={() => events.fetchNextPage()}
                  disabled={events.isFetchingNextPage}
                  className="mt-3 w-full rounded-lg border border-border py-2 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50"
                >
                  {events.isFetchingNextPage ? "Loading…" : "Load older"}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
