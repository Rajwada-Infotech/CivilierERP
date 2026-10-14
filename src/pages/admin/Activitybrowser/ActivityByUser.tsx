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
import { PeopleList, type RangeKey } from "./PeopleList";
import { PersonActivity } from "./PersonActivity";

const IST = "Asia/Kolkata";

// Date-only boundaries, like the other activity filters (the server reads them as UTC days).
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const dayKeyIst = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: IST });

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
      />
    </div>
  );
}
