// Civil Work DPR reports — the web Reports page's "User-Wise Daily Work Report" and "Tag-Wise Civil Work DPR
// Report" (same /api/civilworkdpr-reports endpoints, same filters and columns). One card per record:
// Tag (tag-wise), User, Date, Auto Name, Activity, Status, Chain, Location, Project, Progress, Start/End
// Date, QC and Attempt. Only the selected day's records are shown.
import { useMemo, useState } from "react";
import { RefreshControl, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import { Tag as TagIcon, UserRound } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { usePageRights } from "@/hooks/usePageRights";
import { STATUS_COLOR, STATUS_LABEL } from "@/components/StatusPill";
import { DateField, MultiPickerField } from "@/components/form";
import { dependencyAutoName } from "@/utils/dependencyAutoName";
import { getDailyWorkReport, getDprTags, getEngineers, getScopeProjects, type DailyWorkRow } from "@/api/cwdApi";
import { ACCENT, Empty, ErrorText, Loading, card, todayYmd } from "@/screens/activities/tabs/ui";

type Kind = "user" | "tag";
const PAGE = 25;

const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const pct = (v?: number | null) => (v == null ? "—" : `${Math.round(Number(v) * 10) / 10}%`);

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ width: "50%", paddingRight: 8, marginBottom: 6 }}>
      <Text style={{ fontSize: 9, fontFamily: fonts.heading.bold, color: colors.mutedForeground, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</Text>
      <Text numberOfLines={2} style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: colors.foreground }}>{value || "—"}</Text>
    </View>
  );
}

function RowCard({ r, kind, onOpen }: { r: DailyWorkRow; kind: Kind; onOpen: () => void }) {
  const autoName = dependencyAutoName({ flatName: r.flatName, alias: r.chain, roomName: r.roomName, storey: r.storey, activityName: r.activityName });
  const sc = STATUS_COLOR[r.status] ?? colors.mutedForeground;
  const made = r.progressMade == null ? "" : ` (${Number(r.progressMade) > 0 ? "+" : ""}${Math.round(Number(r.progressMade) * 10) / 10}% that day)`;
  return (
    <TouchableOpacity activeOpacity={0.7} onPress={onOpen} style={{ ...card, marginBottom: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
        <View style={{ flex: 1 }}>
          {kind === "tag" && !!r.tagName && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: `${ACCENT}22`, marginBottom: 4 }}>
              <TagIcon size={10} color={ACCENT} />
              <Text style={{ fontSize: 10, fontFamily: fonts.heading.bold, color: ACCENT }}>{r.tagName}</Text>
            </View>
          )}
          <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{autoName || r.activityName}</Text>
        </View>
        <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: `${sc}22` }}>
          <Text style={{ fontSize: 9.5, fontFamily: fonts.heading.bold, color: sc, textTransform: "uppercase" }}>{STATUS_LABEL[r.status] ?? r.status}</Text>
        </View>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 6, marginBottom: 8 }}>
        <UserRound size={11} color={colors.mutedForeground} />
        <Text style={{ fontSize: 11, fontFamily: fonts.body.medium, color: colors.mutedForeground }}>{r.userName || "—"} · {fmtDate(r.logDate)}</Text>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        <Field label="Activity" value={r.activityName ?? ""} />
        <Field label="Chain" value={r.chain ?? ""} />
        <Field label="Location" value={r.location ?? ""} />
        <Field label="Project" value={r.projectName ?? ""} />
        <Field label="Progress" value={r.progressPercent == null ? "—" : `${pct(r.progressPercent)}${made}`} />
        <Field label="Attempt" value={r.attemptNo != null ? String(r.attemptNo) : "—"} />
        <Field label="Start Date" value={fmtDate(r.startDate)} />
        <Field label="End Date" value={fmtDate(r.endDate)} />
        <Field label="QC" value={r.qcStatus ? (r.qcStatus === "APPROVED" ? "Approved" : "Rework") : "—"} />
      </View>
    </TouchableOpacity>
  );
}

export default function ReportsScreen() {
  const rights = usePageRights("civilworkdpr-activity-reporting");
  const navigation = useNavigation<{ navigate: (name: string, params?: object) => void }>();
  const [kind, setKind] = useState<Kind>("tag");
  const [date, setDate] = useState(todayYmd());
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [userIds, setUserIds] = useState<string[]>([]);
  const [tagIds, setTagIds] = useState<string[]>([]);

  const projectsQ = useQuery({ queryKey: ["cwd-scope-projects"], queryFn: getScopeProjects, enabled: rights.canView, staleTime: 300_000 });
  const usersQ = useQuery({ queryKey: ["cwd-engineers"], queryFn: getEngineers, enabled: rights.canView, staleTime: 300_000 });
  const tagsQ = useQuery({ queryKey: ["cwd-dpr-tags"], queryFn: getDprTags, enabled: rights.canView && kind === "tag", staleTime: 60_000 });

  const reportQ = useInfiniteQuery({
    queryKey: ["cwd-report", kind, date, projectIds, userIds, tagIds],
    enabled: rights.canView,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      getDailyWorkReport(kind, {
        date: date || undefined,
        projectId: projectIds.map(Number),
        userId: userIds.map(Number),
        tagId: kind === "tag" ? tagIds.map(Number) : undefined,
        page: pageParam,
        limit: PAGE,
      }),
    getNextPageParam: (last, all) => (all.flatMap((p) => p.rows).length < last.total ? all.length + 1 : undefined),
  });
  const rows = useMemo(() => reportQ.data?.pages.flatMap((p) => p.rows) ?? [], [reportQ.data]);
  const total = reportQ.data?.pages[0]?.total ?? 0;

  if (!rights.canView) {
    return <View style={{ flex: 1, backgroundColor: colors.background, padding: 16 }}><Empty text="You don't have access to reports." /></View>;
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingHorizontal: 10, paddingTop: 14, paddingBottom: 96 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={reportQ.isRefetching} onRefresh={() => reportQ.refetch()} tintColor={colors.mutedForeground} />}
    >
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
        {([{ k: "tag", label: "Tag-Wise Report" }, { k: "user", label: "User-Wise Daily Work" }] as const).map((t) => {
          const on = kind === t.k;
          return (
            <TouchableOpacity key={t.k} onPress={() => setKind(t.k)} style={{ flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 1, alignItems: "center", borderColor: on ? ACCENT : colors.border, backgroundColor: on ? `${ACCENT}22` : colors.card }}>
              <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: on ? ACCENT : colors.mutedForeground }}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={{ ...card, marginBottom: 12 }}>
        <DateField label="Date" value={date} onChange={setDate} />
        <MultiPickerField label="Project" options={(projectsQ.data ?? []).map((p) => ({ key: String(p.id), label: p.name ?? `Project ${p.id}` }))} selected={projectIds} onChange={setProjectIds} placeholder="All projects" />
        {kind === "tag" && (
          <MultiPickerField label="Tag" options={(tagsQ.data ?? []).map((t) => ({ key: String(t.id), label: t.tagName }))} selected={tagIds} onChange={setTagIds} placeholder="All tags" />
        )}
        <MultiPickerField label="User" options={(usersQ.data ?? []).map((u) => ({ key: String(u.id), label: u.name }))} selected={userIds} onChange={setUserIds} placeholder="All users" />
      </View>

      {reportQ.isLoading ? <Loading /> : reportQ.error ? <ErrorText error={reportQ.error} /> : rows.length === 0 ? (
        <Empty text={kind === "tag" ? "No tagged activity records for these filters." : "No work was reported for these filters."} />
      ) : (
        <>
          <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: fonts.body.regular, marginBottom: 8 }}>{total} record{total === 1 ? "" : "s"} on {fmtDate(date)}</Text>
          {rows.map((r) => <RowCard key={`${r.logId}-${r.userId}`} r={r} kind={kind} onOpen={() => navigation.navigate("ActivityDetail", { rungId: r.rungId })} />)}
          {reportQ.hasNextPage && (
            <TouchableOpacity onPress={() => reportQ.fetchNextPage()} disabled={reportQ.isFetchingNextPage} style={{ alignItems: "center", paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: ACCENT }}>
              <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: ACCENT }}>{reportQ.isFetchingNextPage ? "Loading…" : "Load more"}</Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </ScrollView>
  );
}
