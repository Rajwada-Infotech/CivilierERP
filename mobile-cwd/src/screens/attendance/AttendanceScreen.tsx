// Worker Attendance — the mobile take on the web's src/pages/civilworkdpr/WorkerAttendance.tsx, same
// /api/worker-attendance endpoints. Pick Project → (Floor) → Activity, then mark Present / Half / Absent
// per worker for a day (reuses the activity detail's AttendanceTab). Until an activity is picked, the screen
// shows the last 60 days' attendance log, grouped Date-wise or Work-wise like the web.
import { useMemo, useState } from "react";
import { RefreshControl, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, CalendarDays, ChevronDown, ChevronRight, ClipboardList, Layers, Search, Users, X } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { usePageRights } from "@/hooks/usePageRights";
import { OptionPickerModal, PickerRow } from "@/components/OptionPicker";
import { getAttendanceActivities, getAttendanceReport, getEnterpriseCompanies, getEnterpriseProjects, type AttendanceReportRow } from "@/api/cwdApi";
import { DateField } from "@/components/form/DateField";
import { AttendanceTab } from "@/screens/activities/tabs/AttendanceTab";
import { ATT_META, WorkerHistorySheet } from "@/screens/activities/tabs/WorkerHistorySheet";
import { ACCENT, Empty, ErrorText, Loading, card, fromYmd, todayYmd, ymd } from "@/screens/activities/tabs/ui";

const fmtLong = (s: string) => fromYmd(s).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
const fmtShort = (s: string) => fromYmd(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: on ? ACCENT : colors.border, backgroundColor: on ? `${ACCENT}22` : "transparent" }}
    >
      <Text style={{ fontSize: 11.5, fontFamily: fonts.heading.semibold, color: on ? ACCENT : colors.mutedForeground }}>{label}</Text>
    </TouchableOpacity>
  );
}

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
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", padding: 3, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}>
        {(["date", "activity"] as const).map((m) => (
          <TouchableOpacity key={m} onPress={() => setBy(m)} style={{ flex: 1, alignItems: "center", paddingVertical: 7, borderRadius: 9, backgroundColor: by === m ? ACCENT : "transparent" }}>
            <Text style={{ fontSize: 11.5, fontFamily: fonts.heading.semibold, color: by === m ? "#04181d" : colors.mutedForeground }}>{m === "date" ? "Date-wise" : "Work-wise"}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {groups.length === 0 ? <Empty text="No attendance recorded in the last 60 days." /> : groups.map((g) => {
        const isClosed = !!closed[g.key];
        const n = { P: 0, H: 0, A: 0 };
        for (const r of g.rows) n[r.status]++;
        return (
          <View key={g.key} style={{ ...card, padding: 0, overflow: "hidden" }}>
            <TouchableOpacity onPress={() => setClosed((p) => ({ ...p, [g.key]: !p[g.key] }))} style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 12 }}>
              {isClosed ? <ChevronRight size={14} color={colors.mutedForeground} /> : <ChevronDown size={14} color={colors.mutedForeground} />}
              {by === "date" ? <CalendarDays size={14} color={ACCENT} /> : <ClipboardList size={14} color={ACCENT} />}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontSize: 12.5, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{g.label}</Text>
                {!!g.sub && <Text numberOfLines={1} style={{ fontSize: 10.5, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>{g.sub}</Text>}
              </View>
              {/* At-a-glance split, so a collapsed group still says something useful. */}
              <View style={{ flexDirection: "row", gap: 4 }}>
                {(["P", "H", "A"] as const).filter((k) => n[k]).map((k) => (
                  <View key={k} style={{ minWidth: 22, alignItems: "center", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: `${ATT_META[k].color}22` }}>
                    <Text style={{ fontSize: 10, fontFamily: fonts.heading.bold, color: ATT_META[k].color }}>{n[k]}{k}</Text>
                  </View>
                ))}
              </View>
            </TouchableOpacity>
            {!isClosed && g.rows.map((r) => (
              <TouchableOpacity key={r.id} onPress={() => onWorker({ id: r.workerId, name: r.workerName })} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: colors.border }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: ATT_META[r.status].color }} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: colors.foreground }}>{r.workerName}</Text>
                  <Text numberOfLines={1} style={{ fontSize: 10.5, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>
                    {by === "date" ? `${r.activityLabel}${r.projectName ? ` · ${r.projectName}` : ""}` : fmtShort(r.date)}
                  </Text>
                </View>
                <Text style={{ fontSize: 10.5, fontFamily: fonts.heading.semibold, color: ATT_META[r.status].color }}>{ATT_META[r.status].label}</Text>
              </TouchableOpacity>
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

  if (!rights.canView) {
    return <View style={{ flex: 1, backgroundColor: colors.background, padding: 16 }}><Empty text="You don't have access to Worker Attendance." /></View>;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 10, paddingTop: 14, paddingBottom: 96, gap: 12 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} tintColor={colors.mutedForeground} />}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Where ── */}
        <View style={{ ...card, paddingBottom: 0 }}>
          <PickerRow label="Company" value={company?.label ?? ""} placeholder="All companies" onPress={() => setPicker("company")} />
          <PickerRow label="Project" value={project?.label ?? ""} placeholder={projects.isLoading ? "Loading…" : "All projects"} onPress={() => setPicker("project")} />
          {!!projectId && floors.length > 0 && (
            <View style={{ marginTop: -4, marginBottom: 12, gap: 6 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <Layers size={11} color={colors.mutedForeground} />
                <Text style={{ fontSize: 10, fontFamily: fonts.body.medium, color: colors.mutedForeground, textTransform: "uppercase", letterSpacing: 0.4 }}>Floor</Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                <Chip label="All" on={!floor} onPress={() => { setFloor(null); setRungId(null); }} />
                {floors.map((f) => <Chip key={f} label={f} on={floor === f} onPress={() => { setFloor(f); setRungId(null); }} />)}
              </ScrollView>
            </View>
          )}
          <PickerRow
            label="Activity"
            value={activity?.label ?? ""}
            placeholder={!projectId ? "Pick a project first" : activities.isLoading ? "Loading…" : `Choose from ${actsForFloor.length} activities`}
            disabled={!projectId}
            onPress={() => setPicker("activity")}
          />
          <View style={{ marginBottom: 2 }}>
            <DateField label="Date" value={date} onChange={(d) => setDate(d > todayYmd() ? todayYmd() : d)} />
          </View>
          {/* Search worker — always available, like the web: filters the roster once an activity is picked,
              otherwise the recent attendance log. */}
          <View style={{ marginBottom: 14 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.card}80`, borderRadius: 12, paddingHorizontal: 12 }}>
              <Search size={14} color={colors.mutedForeground} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search worker…"
                placeholderTextColor={`${colors.mutedForeground}99`}
                style={{ flex: 1, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13, paddingVertical: 10 }}
              />
              {!!search && <TouchableOpacity onPress={() => setSearch("")} hitSlop={8}><X size={14} color={colors.mutedForeground} /></TouchableOpacity>}
            </View>
          </View>
        </View>

        {activity ? (
          <>
            {/* ── Selected activity ── */}
            <View style={{ ...card, flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: `${ACCENT}22` }}>
                <Users size={17} color={ACCENT} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={2} style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{activity.sequenceNo}. {activity.activityName}</Text>
                <Text numberOfLines={1} style={{ fontSize: 10.5, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>
                  {[activity.towerName, activity.floor, activity.flatName, activity.roomName].filter(Boolean).join(" › ")}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setRungId(null)} hitSlop={8} style={{ padding: 4 }}><X size={16} color={colors.mutedForeground} /></TouchableOpacity>
            </View>
            <AttendanceTab rungId={activity.rungId} canEdit={rights.canCreate || rights.canEdit} date={date} onDateChange={setDate} search={search} />
          </>
        ) : (
          <>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 2 }}>
              <Building2 size={14} color={ACCENT} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: colors.foreground }}>Recent attendance</Text>
                <Text style={{ fontSize: 10.5, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>Last 60 days{project ? ` · ${project.label}` : company ? ` · ${company.label}` : ""} — pick an activity above to mark today's.</Text>
              </View>
            </View>
            {log.isLoading ? <Loading /> : log.error ? <ErrorText error={log.error} /> : (
              <RecentLog
                rows={search.trim() ? (log.data ?? []).filter((r) => r.workerName.toLowerCase().includes(search.trim().toLowerCase())) : log.data ?? []}
                onWorker={setHistory}
              />
            )}
          </>
        )}
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
