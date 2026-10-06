// Every allocated activity (current attempt), newest first — a read-only first cut of the web
// Work Reporting list: scope, engineers, dates, progress and status. Search and status chips filter
// client-side. Detail, reporting, allocation and QC screens are the next things to build here.
import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, TextInput, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { StatusPill, displayStatus, STATUS_COLOR, STATUS_LABEL } from "@/components/StatusPill";
import { getActivityAssignments, type ActivityAssignment } from "@/api/cwdApi";
import { usePageRights } from "@/hooks/usePageRights";

const ACCENT = "#0891b2";
const FILTERS = ["ALL", "IN_PROGRESS", "HOLD", "REWORK", "COMPLETED", "ALLOCATED", "APPROVED"] as const;

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—";

function Row({ a }: { a: ActivityAssignment }) {
  const shown = displayStatus(a.status, a.resumedAt);
  const pct = Math.max(0, Math.min(100, a.progressPercent ?? 0));
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <Text style={{ flex: 1, fontSize: 13, fontFamily: fonts.heading.semibold, color: colors.foreground }} numberOfLines={2}>
          {a.sequenceNo != null ? `${a.sequenceNo}. ` : ""}{a.activityName ?? "Activity"}
        </Text>
        <StatusPill status={shown} />
      </View>
      {!!a.scopePath && (
        <Text style={{ fontSize: 10.5, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginTop: 3 }} numberOfLines={2}>
          {[a.projectName, a.scopePath].filter(Boolean).join(" · ")}
        </Text>
      )}
      <View style={{ height: 5, borderRadius: 3, backgroundColor: colors.muted, marginTop: 10, overflow: "hidden" }}>
        <View style={{ width: `${pct}%`, height: 5, borderRadius: 3, backgroundColor: STATUS_COLOR[shown] ?? ACCENT }} />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8, gap: 8 }}>
        <Text style={{ flex: 1, fontSize: 10.5, fontFamily: fonts.body.regular, color: colors.mutedForeground }} numberOfLines={1}>
          {a.engineerNames || "No engineer"}
        </Text>
        <Text style={{ fontSize: 10.5, fontFamily: fonts.body.medium, color: colors.mutedForeground }}>
          {pct}% · {fmtDate(a.startDate)} → {fmtDate(a.endDate)}
        </Text>
      </View>
    </View>
  );
}

export default function ActivitiesScreen() {
  const rights = usePageRights("civilworkdpr-activity-reporting");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("ALL");
  const [refreshing, setRefreshing] = useState(false);
  const q = useQuery({ queryKey: ["cwd-activities"], queryFn: () => getActivityAssignments(), staleTime: 60_000, enabled: rights.canView });

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (q.data ?? []).filter((a) => {
      if (filter !== "ALL" && a.status !== filter) return false;
      if (!needle) return true;
      return [a.activityName, a.scopePath, a.projectName, a.engineerNames].some((v) => (v ?? "").toLowerCase().includes(needle));
    });
  }, [q.data, search, filter]);

  if (!rights.canView) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", padding: 32 }}>
        <Text style={{ color: colors.foreground, fontFamily: fonts.heading.semibold, fontSize: 14 }}>No access</Text>
        <Text style={{ color: colors.mutedForeground, fontFamily: fonts.body.regular, fontSize: 12, marginTop: 4, textAlign: "center" }}>
          You don't have permission to view Work Reporting.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ padding: 16, paddingBottom: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, borderRadius: 12, paddingHorizontal: 12 }}>
          <Search size={14} color={colors.mutedForeground} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search activity, location or engineer…"
            placeholderTextColor={`${colors.mutedForeground}99`}
            style={{ flex: 1, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13, paddingVertical: 10 }}
          />
          {!!search && (
            <Pressable onPress={() => setSearch("")}>
              <X size={14} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={FILTERS as unknown as string[]}
          keyExtractor={(f) => f}
          style={{ marginTop: 10 }}
          contentContainerStyle={{ gap: 8 }}
          renderItem={({ item }) => {
            const on = filter === item;
            return (
              <Pressable
                onPress={() => setFilter(item as (typeof FILTERS)[number])}
                style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: on ? ACCENT : colors.border, backgroundColor: on ? `${ACCENT}22` : "transparent" }}
              >
                <Text style={{ fontSize: 11, fontFamily: fonts.heading.semibold, color: on ? ACCENT : colors.mutedForeground }}>
                  {item === "ALL" ? "All" : STATUS_LABEL[item]}
                </Text>
              </Pressable>
            );
          }}
        />
      </View>

      {q.isLoading ? (
        <View style={{ paddingVertical: 60, alignItems: "center" }}>
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      ) : q.error ? (
        <Text style={{ color: colors.destructive, fontSize: 12, fontFamily: fonts.body.regular, padding: 16 }}>{(q.error as Error).message}</Text>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(a) => String(a.assignmentId)}
          renderItem={({ item }) => <Row a={item} />}
          contentContainerStyle={{ padding: 16, paddingTop: 8, paddingBottom: 96 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await q.refetch();
                setRefreshing(false);
              }}
              tintColor={ACCENT}
            />
          }
          ListEmptyComponent={
            <Text style={{ textAlign: "center", color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, paddingVertical: 40 }}>
              No activities match.
            </Text>
          }
        />
      )}
    </View>
  );
}
