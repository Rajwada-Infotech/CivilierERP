// Civil Work DPR reports — the web Reports page's "User-Wise Daily Work Report" and "Tag-Wise Civil Work DPR
// Report" (same /api/civilworkdpr-reports endpoints, same filters and columns). One card per record:
// Tag (tag-wise), User, Date, Auto Name, Activity, Status, Chain, Location, Project, Progress, Start/End
// Date, QC and Attempt. Only the selected day's records are shown.
import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { usePageRights } from "@/hooks/usePageRights";
import { StatusPill } from "@/components/StatusPill";
import { DateField, MultiPickerField } from "@/components/form";
import { dependencyAutoName } from "@/utils/dependencyAutoName";
import { getDailyWorkReport, getDprTags, getEngineers, getScopeProjects, type DailyWorkRow } from "@/api/cwdApi";
import { todayYmd } from "@/screens/activities/tabs/ui";
import { Body, InfoGrid, Key, Label, Notice, Panel, Press, RegisterHead, Seg, SheetShell, Skel } from "@/components/sheet/Sheet";
import { NoAccess, SheetPage } from "@/components/sheet/Register";

type Kind = "user" | "tag";
const PAGE = 25;

const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const pct = (v?: number | null) => (v == null ? "—" : `${Math.round(Number(v) * 10) / 10}%`);

/** One record as a ruled row: the tag (tag-wise), the activity and its status, who and when, then its facts two to a row. */
function RecordRow({ r, kind, onOpen }: { r: DailyWorkRow; kind: Kind; onOpen: () => void }) {
  const autoName = dependencyAutoName({ flatName: r.flatName, alias: r.chain, roomName: r.roomName, storey: r.storey, activityName: r.activityName });
  const made = r.progressMade == null ? "" : ` (${Number(r.progressMade) > 0 ? "+" : ""}${Math.round(Number(r.progressMade) * 10) / 10}% that day)`;
  return (
    <Press onPress={onOpen} style={(pressed) => ({ paddingVertical: 13, gap: 10, borderBottomWidth: 1, borderBottomColor: S.ruleSoft, backgroundColor: pressed ? S.blueWash : "transparent" })}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          {kind === "tag" && !!r.tagName && <Label color={S.blue}>{r.tagName}</Label>}
          <Text style={{ fontSize: 13.5, fontFamily: fonts.body.semibold, color: S.ink }}>{autoName || r.activityName}</Text>
          <Body size={11.5} color={S.graphite}>{r.userName || "—"} · {fmtDate(r.logDate)}</Body>
        </View>
        <StatusPill status={r.status} />
      </View>
      <InfoGrid
        items={[
          { label: "Activity", value: r.activityName || "—" },
          { label: "Chain", value: r.chain || "—" },
          { label: "Location", value: r.location || "—" },
          { label: "Project", value: r.projectName || "—" },
          { label: "Progress", value: r.progressPercent == null ? "—" : `${pct(r.progressPercent)}${made}` },
          { label: "Attempt", value: r.attemptNo != null ? String(r.attemptNo) : "—" },
          { label: "Start date", value: fmtDate(r.startDate) },
          { label: "End date", value: fmtDate(r.endDate) },
          { label: "QC", value: r.qcStatus ? (r.qcStatus === "APPROVED" ? "Approved" : "Rework") : "—" },
        ]}
      />
    </Press>
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

  if (!rights.canView) return <NoAccess eyebrow="Civil Work DPR" title="Reports" what="reports" />;

  return (
    <SheetPage refreshing={reportQ.isRefetching} onRefresh={() => void reportQ.refetch()}>
      <SheetShell eyebrow="Civil Work DPR" title="Reports" subtitle="What was reported on a day, by tag or by user. Tap a record to open its activity.">
        <Seg options={[{ value: "tag", label: "Tag-wise" }, { value: "user", label: "User-wise daily work" }]} value={kind} onChange={setKind} />

        <Panel title="Filters">
          <DateField label="Date" value={date} onChange={setDate} />
          <MultiPickerField label="Project" options={(projectsQ.data ?? []).map((p) => ({ key: String(p.id), label: p.name ?? `Project ${p.id}` }))} selected={projectIds} onChange={setProjectIds} placeholder="All projects" />
          {kind === "tag" && (
            <MultiPickerField label="Tag" options={(tagsQ.data ?? []).map((t) => ({ key: String(t.id), label: t.tagName }))} selected={tagIds} onChange={setTagIds} placeholder="All tags" />
          )}
          <MultiPickerField label="User" options={(usersQ.data ?? []).map((u) => ({ key: String(u.id), label: u.name }))} selected={userIds} onChange={setUserIds} placeholder="All users" />
        </Panel>

        <View>
          <RegisterHead title={`${kind === "tag" ? "Tag-wise" : "User-wise"} · ${fmtDate(date)}`} count={total} />
          {reportQ.isLoading ? (
            <View style={{ paddingTop: 12 }}><Skel h={90} /><Skel h={90} /></View>
          ) : reportQ.error ? (
            <View style={{ paddingTop: 12 }}><Notice>{(reportQ.error as Error).message}</Notice></View>
          ) : rows.length === 0 ? (
            <Body size={13} color={S.graphite} style={{ paddingVertical: 20 }}>{kind === "tag" ? "No tagged activity records for these filters." : "No work was reported for these filters."}</Body>
          ) : (
            <>
              {rows.map((r) => <RecordRow key={`${r.logId}-${r.userId ?? r.userName}`} r={r} kind={kind} onOpen={() => navigation.navigate("ActivityDetail", { rungId: r.rungId })} />)}
              {reportQ.hasNextPage && (
                <Key label={reportQ.isFetchingNextPage ? "Loading…" : "Load more"} disabled={reportQ.isFetchingNextPage} onPress={() => void reportQ.fetchNextPage()} style={{ marginTop: 14 }} />
              )}
            </>
          )}
        </View>
      </SheetShell>
    </SheetPage>
  );
}
