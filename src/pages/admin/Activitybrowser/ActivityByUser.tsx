// By User: pick a person, see what they did. Holds the queries; PeopleList and PersonActivity draw them.
import React, { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  getActivityUsers,
  getUserActivity,
  type SessionEvent,
  type UserActivitySummary,
  type UserActivityType,
} from "@/api/userActivityApi";
import { toast } from "sonner";
import { buildWorkbook, downloadBlob, type XlsxCell } from "@/lib/xlsxBook";
import { PeopleList, type RangeKey } from "./PeopleList";
import { PersonActivity, TYPES, dayLabelIst, timeIst } from "./PersonActivity";
import { describeActivity } from "./describeActivity";

const IST = "Asia/Kolkata";

// Date-only boundaries, like the other activity filters (the server reads them as UTC days).
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const dayKeyIst = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: IST });

const KINDS: [string, string][] = [["create", "Created"], ["update", "Updated"], ["delete", "Deleted"], ["export", "Exported"], ["settings_change", "Settings"], ["read", "Pages opened"], ["login", "Sign-ins"], ["logout", "Sign-outs"]];
const H = (v: string): XlsxCell => ({ v, s: "header" });
const kindCounts = (items: SessionEvent[]) => KINDS.map(([k]) => items.filter((e) => describeActivity(e).kind === k).length);

/** Every activity of one person in the period (all pages, not just what's loaded on screen). */
async function fetchAllActivity(userId: string, params: { dateFrom?: string; dateTo?: string; type: UserActivityType }) {
  const all: SessionEvent[] = [];
  for (let page = 1; page <= 100; page++) {
    const res = await getUserActivity(userId, { ...params, page, limit: 500 });
    all.push(...res.data);
    if (page >= res.pages) break;
  }
  return all;
}

function rangeDates(key: RangeKey): { dateFrom?: string; dateTo?: string } {
  const today = new Date();
  if (key === "today") return { dateFrom: isoDay(today), dateTo: isoDay(today) };
  if (key === "yesterday") return { dateFrom: isoDay(addDays(today, -1)), dateTo: isoDay(addDays(today, -1)) };
  if (key === "7d") return { dateFrom: isoDay(addDays(today, -6)), dateTo: isoDay(today) };
  if (key === "30d") return { dateFrom: isoDay(addDays(today, -29)), dateTo: isoDay(today) };
  return {};
}

export default function ActivityByUser() {
  const [range, setRange] = useState<RangeKey>("7d");
  const [type, setType] = useState<UserActivityType>("changes");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportingAll, setExportingAll] = useState<string | null>(null); // progress text while the everyone export runs
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

  // The whole selected period for this person (not just the days loaded on screen), as an Excel file: a sheet with one
  // line per day, and a sheet with every activity under its day, oldest day first.
  const handleExport = async () => {
    if (!selected || !current) return;
    setExporting(true);
    try {
      const all = await fetchAllActivity(selected, { ...dates, type });
      if (!all.length) {
        toast.info("Nothing to export for this period.");
        return;
      }
      all.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
      const byDay = new Map<string, SessionEvent[]>();
      for (const e of all) {
        const k = dayKeyIst(e.timestamp);
        byDay.set(k, [...(byDay.get(k) ?? []), e]);
      }
      const period = dates.dateFrom ? `${dates.dateFrom} to ${dates.dateTo}` : "all time";
      const typeLabel = TYPES.find((t) => t.key === type)?.label ?? type;
      const title = `${current.userName} — ${typeLabel}, ${period} (times in IST)`;

      const dayRows: XlsxCell[][] = [[{ v: title, s: "title" }], [], ["Date", "Total", ...KINDS.map(([, l]) => l)].map(H)];
      const totals = new Array(KINDS.length).fill(0);
      for (const [key, items] of byDay) {
        const counts = kindCounts(items);
        counts.forEach((c, i) => (totals[i] += c));
        dayRows.push([dayLabelIst(key), items.length, ...counts]);
      }
      dayRows.push([{ v: "Total", s: "label" }, { v: all.length, s: "label" }, ...totals.map((t) => ({ v: t, s: "label" as const }))]);

      const actRows: XlsxCell[][] = [[{ v: title, s: "title" }], [], ["Date", "Time (IST)", "Kind", "Action", "Subject", "Where", "Record", "IP"].map(H)];
      for (const [key, items] of byDay) {
        actRows.push([{ v: `${dayLabelIst(key)}  (${items.length})`, s: "label" }]);
        for (const e of items) {
          const d = describeActivity(e);
          actRows.push([dayLabelIst(key), timeIst(e.timestamp), d.kind, d.verb, d.subject || "", d.where || "", d.record || "", e.ipAddress && e.ipAddress !== "unknown" ? e.ipAddress : ""]);
        }
      }

      const blob = await buildWorkbook([
        { name: "By date", rows: dayRows, widths: [28, 8, ...KINDS.map(() => 12)], freezeBelowRow: 4 },
        { name: "Activity", rows: actRows, widths: [28, 11, 10, 22, 34, 30, 34, 16], freezeBelowRow: 4 },
      ]);
      const slug = current.userName.trim().replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "user";
      downloadBlob(blob, `activity-${slug}-${dates.dateFrom ?? "all"}-to-${dates.dateTo ?? "all"}.xlsx`);
      toast.success(`Exported ${all.length.toLocaleString("en-IN")} activities over ${byDay.size} day${byDay.size === 1 ? "" : "s"}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  // Everyone in the list (the period, kind and name search on screen) as one Excel file: per day, each person's counts;
  // per person, their totals; and every activity, day by day. People are fetched four at a time.
  const handleExportAll = async () => {
    if (!filteredUsers.length) return;
    setExportingAll(`0 / ${filteredUsers.length}`);
    try {
      const per: { user: UserActivitySummary; events: SessionEvent[] }[] = [];
      let done = 0;
      const queue = [...filteredUsers];
      await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
        for (let u = queue.shift(); u; u = queue.shift()) {
          per.push({ user: u, events: await fetchAllActivity(u.userId, { ...dates, type }) });
          setExportingAll(`${++done} / ${filteredUsers.length}`);
        }
      }));
      const withEvents = per.filter((p) => p.events.length).sort((a, b) => a.user.userName.localeCompare(b.user.userName));
      const everything = withEvents.flatMap((p) => p.events.map((e) => ({ e, user: p.user })));
      if (!everything.length) {
        toast.info("Nothing to export for this period.");
        return;
      }
      const period = dates.dateFrom ? `${dates.dateFrom} to ${dates.dateTo}` : "all time";
      const typeLabel = TYPES.find((t) => t.key === type)?.label ?? type;
      const who = search.trim() ? `Everyone matching "${search.trim()}"` : "Everyone";
      const title = `${who} — ${typeLabel}, ${period} (times in IST)`;

      // Day -> person -> their events that day, oldest day first.
      everything.sort((a, b) => Date.parse(a.e.timestamp) - Date.parse(b.e.timestamp));
      const byDay = new Map<string, Map<string, { user: UserActivitySummary; items: SessionEvent[] }>>();
      for (const { e, user } of everything) {
        const k = dayKeyIst(e.timestamp);
        if (!byDay.has(k)) byDay.set(k, new Map());
        const people = byDay.get(k)!;
        if (!people.has(user.userId)) people.set(user.userId, { user, items: [] });
        people.get(user.userId)!.items.push(e);
      }

      const dayRows: XlsxCell[][] = [[{ v: title, s: "title" }], [], ["Date", "Person", "Email", "Total", ...KINDS.map(([, l]) => l)].map(H)];
      for (const [key, people] of byDay) {
        const dayItems: SessionEvent[] = [];
        for (const { user, items } of [...people.values()].sort((a, b) => a.user.userName.localeCompare(b.user.userName))) {
          dayItems.push(...items);
          dayRows.push([dayLabelIst(key), user.userName, user.userEmail || "", items.length, ...kindCounts(items)]);
        }
        dayRows.push([
          { v: `${dayLabelIst(key)} total`, s: "label" },
          { v: `${people.size} ${people.size === 1 ? "person" : "people"}`, s: "label" },
          "",
          { v: dayItems.length, s: "label" },
          ...kindCounts(dayItems).map((c) => ({ v: c, s: "label" as const })),
        ]);
        dayRows.push([]);
      }

      const personRows: XlsxCell[][] = [[{ v: title, s: "title" }], [], ["Person", "Email", "Days active", "Total", ...KINDS.map(([, l]) => l)].map(H)];
      for (const { user, events: ev } of withEvents) {
        personRows.push([user.userName, user.userEmail || "", new Set(ev.map((e) => dayKeyIst(e.timestamp))).size, ev.length, ...kindCounts(ev)]);
      }
      const allEv = everything.map((x) => x.e);
      personRows.push([{ v: "Total", s: "label" }, "", "", { v: allEv.length, s: "label" }, ...kindCounts(allEv).map((c) => ({ v: c, s: "label" as const }))]);

      const actRows: XlsxCell[][] = [[{ v: title, s: "title" }], [], ["Date", "Time (IST)", "Person", "Kind", "Action", "Subject", "Where", "Record", "IP"].map(H)];
      for (const [key, people] of byDay) {
        const items = [...people.values()]
          .flatMap((p) => p.items.map((e) => ({ e, user: p.user })))
          .sort((a, b) => Date.parse(a.e.timestamp) - Date.parse(b.e.timestamp));
        actRows.push([{ v: `${dayLabelIst(key)}  (${items.length})`, s: "label" }]);
        for (const { e, user } of items) {
          const d = describeActivity(e);
          actRows.push([dayLabelIst(key), timeIst(e.timestamp), user.userName, d.kind, d.verb, d.subject || "", d.where || "", d.record || "", e.ipAddress && e.ipAddress !== "unknown" ? e.ipAddress : ""]);
        }
      }

      const blob = await buildWorkbook([
        { name: "By day", rows: dayRows, widths: [28, 24, 28, 8, ...KINDS.map(() => 12)], freezeBelowRow: 4 },
        { name: "By person", rows: personRows, widths: [24, 28, 11, 8, ...KINDS.map(() => 12)], freezeBelowRow: 4 },
        { name: "Activity", rows: actRows, widths: [28, 11, 22, 10, 22, 34, 30, 34, 16], freezeBelowRow: 4 },
      ]);
      downloadBlob(blob, `activity-everyone-${dates.dateFrom ?? "all"}-to-${dates.dateTo ?? "all"}.xlsx`);
      const n = withEvents.length;
      toast.success(`Exported ${allEv.length.toLocaleString("en-IN")} activities by ${n} ${n === 1 ? "person" : "people"} over ${byDay.size} day${byDay.size === 1 ? "" : "s"}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExportingAll(null);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <PeopleList
        users={filteredUsers}
        loading={loadingUsers}
        search={search}
        setSearch={setSearch}
        range={range}
        setRange={setRange}
        selected={selected}
        setSelected={setSelected}
        onExportAll={handleExportAll}
        exportingAll={exportingAll}
      />
      <PersonActivity
        current={current}
        type={type}
        setType={setType}
        total={total}
        days={days}
        loading={events.isLoading}
        hasMore={!!events.hasNextPage}
        loadingMore={events.isFetchingNextPage}
        loadMore={() => events.fetchNextPage()}
        onExport={handleExport}
        exporting={exporting}
      />
    </div>
  );
}
