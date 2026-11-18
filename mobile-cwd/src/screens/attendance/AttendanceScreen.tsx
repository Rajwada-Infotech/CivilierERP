// Worker Attendance — the mobile take on the web's src/pages/civilworkdpr/WorkerAttendance.tsx, same
// /api/worker-attendance endpoints. Pick Project → (Floor) → Activity, then mark Present / Half / Absent
// per worker for a day (reuses the activity detail's AttendanceTab). Until an activity is picked, the screen
// shows the last 60 days' attendance log, grouped Date-wise or Work-wise like the web.
import { useMemo, useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, X } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { Body, IconKey, Label, Notice, Panel, Press, RegisterHead, SearchBox, Seg, SheetShell, Skel } from "@/components/sheet/Sheet";
import { ChipRow, NoAccessPage } from "@/components/sheet/Page";
import { fonts } from "@/theme/fonts";
import { usePageRights } from "@/hooks/usePageRights";
import { OptionPickerModal, PickerRow } from "@/components/OptionPicker";
import { getAttendanceActivities, getAttendanceReport, getEnterpriseCompanies, getEnterpriseProjects, type AttendanceReportRow } from "@/api/cwdApi";
import { DateField } from "@/components/form/DateField";
import { AttendanceTab } from "@/screens/activities/tabs/AttendanceTab";
import { ATT_META, WorkerHistorySheet } from "@/screens/activities/tabs/WorkerHistorySheet";
import { fromYmd, todayYmd, ymd } from "@/screens/activities/tabs/ui";

const fmtLong = (s: string) => fromYmd(s).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
const fmtShort = (s: string) => fromYmd(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

/** Last-60-days log, grouped by day or by activity, each group collapsible. */
function RecentLog({ rows, onWorker }: { rows: AttendanceReportRow[]; onWorker: (w: { id: number; name: string }) => void }) {
  const [by, setBy] = useState<"date" | "activity">("date");
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; sub: string | null; rows: AttendanceReportRow[] }>();
    for (const r of rows) {
      const key = by === "date" ? r.date.slice(0, 10) : String(r.activityId);
      const g = map.get(key) ?? { label: by === "date" ? fmtLong(r.date) : r.activityLabel, sub: by === "date" ? null : r.projectName, rows: [] };
      g.rows.push(r);
      map.set(key, g);
    }
    return [...map.entries()].sort(([a], [b]) => (a < b ? 1 : -1)).map(([key, g]) => ({ key, ...g }));
  }, [rows, by]);

  return (
    <View style={{ gap: 12 }}>
      <Seg options={[{ value: "date", label: "Date-wise" }, { value: "activity", label: "Work-wise" }]} value={by} onChange={setBy} />
      {groups.length === 0 ? <Body size={13} color={S.graphite} style={{ paddingVertical: 16 }}>No attendance recorded in the last 60 days.</Body> : groups.map((g) => {
        const isClosed = !!closed[g.key];
        const n = { P: 0, H: 0, A: 0 };
        for (const r of g.rows) n[r.status]++;
        return (
          <View key={g.key} style={{ borderWidth: 1, borderColor: S.ink }}>
            <Press
              onPress={() => setClosed((p) => ({ ...p, [g.key]: !p[g.key] }))}
              style={(pressed) => ({ flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderBottomWidth: isClosed ? 0 : 1, borderBottomColor: S.ink, backgroundColor: pressed ? S.blueWash : "transparent" })}
            >
              {isClosed ? <ChevronRight size={14} color={S.graphite} /> : <ChevronDown size={14} color={S.graphite} />}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: S.ink }}>{g.label}</Text>
                {!!g.sub && <Text numberOfLines={1} style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: S.graphite }}>{g.sub}</Text>}
              </View>
              {/* At-a-glance split, so a folded group still says something useful. */}
              <View style={{ flexDirection: "row", gap: 8 }}>
                {(["P", "H", "A"] as const).filter((k) => n[k]).map((k) => (
                  <Text key={k} style={{ fontSize: 11, fontFamily: fonts.heading.semibold, color: ATT_META[k].color, fontVariant: ["tabular-nums"] }}>{n[k]}{k}</Text>
                ))}
              </View>
            </Press>
            {!isClosed && g.rows.map((r, i) => (
              <Press
                key={r.id}
                onPress={() => onWorker({ id: r.workerId, name: r.workerName })}
                style={(pressed) => ({ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderTopWidth: i ? 1 : 0, borderTopColor: S.ruleSoft, backgroundColor: pressed ? S.blueWash : "transparent" })}
              >
                <View style={{ width: 9, height: 9, borderWidth: 1, borderColor: ATT_META[r.status].color, backgroundColor: ATT_META[r.status].color }} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontSize: 13, fontFamily: fonts.body.medium, color: S.ink }}>{r.workerName}</Text>
                  <Text numberOfLines={1} style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: S.graphite }}>
                    {by === "date" ? `${r.activityLabel}${r.projectName ? ` · ${r.projectName}` : ""}` : fmtShort(r.date)}
                  </Text>
                </View>
                <Label color={ATT_META[r.status].color}>{ATT_META[r.status].label}</Label>
              </Press>
            ))}
          </View>
        );
      })}
    </View>
  );
}

export default function AttendanceScreen() {
  const rights = usePageRights("civilworkdpr-worker-attendance");
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [date, setDate] = useState(todayYmd());
  const [search, setSearch] = useState("");
  const [floor, setFloor] = useState<string | null>(null);
  const [rungId, setRungId] = useState<number | null>(null);
  const [picker, setPicker] = useState<"company" | "project" | "activity" | null>(null);
  const [history, setHistory] = useState<{ id: number; name: string } | null>(null);

  const companies = useQuery({ queryKey: ["cwd-att-companies"], queryFn: getEnterpriseCompanies, staleTime: 5 * 60_000, enabled: rights.canView });
  // Company → Project cascade, filtered server-side (includes projects tagged to the company).
  const projects = useQuery({ queryKey: ["cwd-att-projects", companyId], queryFn: () => getEnterpriseProjects(companyId), staleTime: 5 * 60_000, enabled: rights.canView });
  const activities = useQuery({
    queryKey: ["cwd-att-activities", projectId],
    queryFn: () => getAttendanceActivities(projectId!),
    enabled: !!projectId,
    staleTime: 30_000,
  });
  const from = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - 60); return ymd(d); }, []);
  const log = useQuery({
    queryKey: ["cwd-att-log", companyId, projectId, from],
    queryFn: () => getAttendanceReport({ companyId: companyId ?? undefined, projectId: projectId ?? undefined, dateFrom: from }),
    enabled: rights.canView && !rungId,
    staleTime: 30_000,
  });

  const acts = activities.data ?? [];
  const floors = useMemo(() => [...new Set(acts.map((a) => a.floor).filter((f): f is string => !!f))].sort(), [acts]);
  const actsForFloor = floor ? acts.filter((a) => a.floor === floor) : acts;
  const company = companies.data?.find((c) => c.id === companyId) ?? null;
  const project = projects.data?.find((p) => p.id === projectId) ?? null;
  const activity = acts.find((a) => a.rungId === rungId) ?? null;

  const refresh = () => qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("cwd-att") || q.queryKey[0] === "cwd-attendance" });

  if (!rights.canView) return <NoAccessPage title="Attendance" what="Worker Attendance" />;

  return (
    <View style={{ flex: 1, backgroundColor: S.paper }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 96 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} tintColor={S.ink} />}
        keyboardShouldPersistTaps="handled"
      >
        <SheetShell eyebrow="Civil Work DPR" title="Attendance" subtitle="Pick a project and an activity to mark its workers Present, Half day or Absent.">
          <Panel title="Where and when">
            <PickerRow label="Company" value={company?.label ?? ""} placeholder="All companies" onPress={() => setPicker("company")} />
            <PickerRow label="Project" value={project?.label ?? ""} placeholder={projects.isLoading ? "Loading…" : "All projects"} onPress={() => setPicker("project")} />
            {!!projectId && floors.length > 0 && (
              <View style={{ gap: 6 }}>
                <Label>Floor</Label>
                <ChipRow
                  options={[{ value: "", label: "All" }, ...floors.map((f) => ({ value: f, label: f }))]}
                  value={floor ?? ""}
                  onChange={(f) => { setFloor(f || null); setRungId(null); }}
                />
              </View>
            )}
            <PickerRow
              label="Activity"
              value={activity?.label ?? ""}
              placeholder={!projectId ? "Pick a project first" : activities.isLoading ? "Loading…" : `Choose from ${actsForFloor.length} activities`}
              disabled={!projectId}
              onPress={() => setPicker("activity")}
            />
            <DateField label="Date" value={date} onChange={(d) => setDate(d > todayYmd() ? todayYmd() : d)} />
            {/* Search worker: filters the roster once an activity is picked, otherwise the recent log. */}
            <SearchBox value={search} onChange={setSearch} placeholder="Search worker" />
          </Panel>

          {activity ? (
            <View style={{ gap: 14 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderWidth: 1.5, borderColor: S.blue, backgroundColor: S.blueWash }}>
                <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                  <Label>Marking attendance for</Label>
                  <Text numberOfLines={2} style={{ fontSize: 13.5, fontFamily: fonts.heading.semibold, color: S.ink }}>{activity.sequenceNo}. {activity.activityName}</Text>
                  <Text numberOfLines={1} style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: S.graphite }}>
                    {[activity.towerName, activity.floor, activity.flatName, activity.roomName].filter(Boolean).join(" › ")}
                  </Text>
                </View>
                <IconKey onPress={() => setRungId(null)}><X size={15} color={S.ink} /></IconKey>
              </View>
              <AttendanceTab rungId={activity.rungId} canEdit={rights.canCreate || rights.canEdit} date={date} onDateChange={setDate} search={search} />
            </View>
          ) : (
            <View style={{ gap: 12 }}>
              <View>
                <RegisterHead title="Recent attendance" count={(log.data ?? []).length} unit={["entry", "entries"]} />
                <Body size={12} color={S.graphite} style={{ marginTop: 8 }}>Last 60 days{project ? ` · ${project.label}` : company ? ` · ${company.label}` : ""}. Pick an activity above to mark today's.</Body>
              </View>
              {log.isLoading ? <><Skel h={50} /><Skel h={50} /></> : log.error ? <Notice>{(log.error as Error).message}</Notice> : (
                <RecentLog
                  rows={search.trim() ? (log.data ?? []).filter((r) => r.workerName.toLowerCase().includes(search.trim().toLowerCase())) : log.data ?? []}
                  onWorker={setHistory}
                />
              )}
            </View>
          )}
        </SheetShell>
      </ScrollView>

      <OptionPickerModal
        visible={picker === "company"}
        title="Company"
        searchable
        clearable
        loading={companies.isLoading}
        options={(companies.data ?? []).map((c) => ({ key: String(c.id), label: c.label }))}
        selectedKey={companyId ? String(companyId) : ""}
        onSelect={(k) => { setCompanyId(k ? Number(k) : null); setProjectId(null); setFloor(null); setRungId(null); setPicker(null); }}
        onClose={() => setPicker(null)}
      />
      <OptionPickerModal
        visible={picker === "project"}
        title="Project"
        searchable
        clearable
        loading={projects.isLoading}
        options={(projects.data ?? []).map((p) => ({ key: String(p.id), label: p.label }))}
        selectedKey={projectId ? String(projectId) : ""}
        onSelect={(k) => { setProjectId(k ? Number(k) : null); setFloor(null); setRungId(null); setPicker(null); }}
        onClose={() => setPicker(null)}
      />
      <OptionPickerModal
        visible={picker === "activity"}
        title="Activity"
        searchable
        loading={activities.isLoading}
        options={actsForFloor.map((a) => ({
          key: String(a.rungId),
          // Activity first (what the user is looking for); where it is + crew size underneath.
          label: `${a.sequenceNo}. ${a.activityName}`,
          sublabel: [[a.towerName, a.floor && `Floor ${a.floor}`, a.flatName, a.roomName].filter(Boolean).join(" › "), a.rosterCount ? `${a.rosterCount} worker${a.rosterCount === 1 ? "" : "s"}` : ""].filter(Boolean).join("  ·  "),
        }))}
        selectedKey={rungId ? String(rungId) : ""}
        onSelect={(k) => { setRungId(k ? Number(k) : null); setPicker(null); }}
        onClose={() => setPicker(null)}
      />
      <WorkerHistorySheet worker={history} onClose={() => setHistory(null)} />
    </View>
  );
}
