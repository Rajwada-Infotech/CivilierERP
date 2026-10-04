// Security Attendance — full parity with web's src/pages/maintenance/
// SecurityAttendance.tsx: Overview stats, Check-In/Out (today's roster,
// same headline action this screen always had), Personnel (add/edit),
// History (filterable, verify/reject/cancel, audit log), Shifts (add/edit).
// Same five tabs as web, native card lists instead of HTML tables.
import { useEffect, useMemo, useState } from "react";
import { View, Text, TextInput, Pressable, ActivityIndicator, ScrollView, RefreshControl, LayoutAnimation } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ShieldCheck, Users, UserCheck, UserX, Clock, ClipboardList,
  LogIn, LogOut, Plus, Search, Pencil, CheckCircle2, XCircle, Ban,
  History as HistoryIcon, CalendarClock,
} from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { toast } from "@/components/Toast";
import { Card, Line, Pill } from "@/components/list/DataList";
import { RadialGauge } from "@/components/charts/RadialGauge";
import { SuccessBurst } from "@/components/SuccessBurst";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { TextField, RemarksField } from "@/components/form/Form";
import { DateField } from "@/components/form/DateField";
import { TimeField } from "@/components/form/TimeField";
import { PickerRow, OptionPickerModal, type PickerOption } from "@/components/OptionPicker";
import { usePageRights } from "@/hooks/usePageRights";
import {
  getSecurityPersonnel, getSecurityShifts, getSecurityAttendance, getSecurityAttendanceDashboard,
  getSecurityAttendanceLogs,
  checkInSecurity, checkOutSecurity, markSecurityAbsent,
  createSecurityPersonnel, updateSecurityPersonnel,
  createSecurityShift, updateSecurityShift,
  verifySecurityAttendance, rejectSecurityAttendance, cancelSecurityAttendance,
  searchSecurityVendors, getProjectOptions,
  type SecurityPersonnelRow, type SecurityAttendanceRow, type SecurityShift,
  type AttendanceStatus, type VerificationStatus,
} from "@/api/securityAttendanceApi";

const ACCENT = "#65a30d";
const today = () => new Date().toISOString().slice(0, 10);

const STATUS_TONE: Record<AttendanceStatus, string> = {
  Present: "#10b981", Late: "#f59e0b", Absent: "#ef4444", HalfDay: "#38bdf8",
};
const VERIFICATION_TONE: Record<VerificationStatus, string> = {
  Verified: "#10b981", Rejected: "#ef4444", Pending: "#f59e0b",
};

const fmtTime = (t: string | null | undefined) => {
  if (!t) return "—";
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? String(t) : d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
};
const fmtTimeUtc = (t: string | null | undefined) => {
  if (!t) return "—";
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? String(t) : d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
};
const fmtDate = (d: string | null | undefined) => {
  if (!d) return "—";
  const [y, m, day] = d.slice(0, 10).split("-");
  return y && m && day ? `${day}/${m}/${y}` : d;
};

const TABS = ["Overview", "Today", "Personnel", "History", "Shifts"] as const;
type Tab = (typeof TABS)[number];

export default function AttendanceScreen() {
  const rights = usePageRights("maintenance-security-attendance");
  const [tab, setTab] = useState<Tab>("Today");

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        {TABS.map((t) => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: tab === t ? ACCENT : colors.card, borderWidth: 1, borderColor: tab === t ? ACCENT : colors.border }}
          >
            <Text style={{ fontSize: 11.5, fontFamily: fonts.heading.semibold, color: tab === t ? "#1a1a1a" : colors.mutedForeground }}>{t}</Text>
          </Pressable>
        ))}
      </View>

      {tab === "Overview" && <OverviewTab />}
      {tab === "Today" && <TodayTab rights={rights} />}
      {tab === "Personnel" && <PersonnelTab rights={rights} />}
      {tab === "History" && <HistoryTab rights={rights} />}
      {tab === "Shifts" && <ShiftsTab rights={rights} />}
    </View>
  );
}

// ─── Overview — "Ops Board" ──────────────────────────────────────────────
// Deliberately not another uniform stat-card grid: a live clock band up
// top (this screen is about who's on the ground *right now*), one
// oversized gauge tile for the number that actually matters on a phone at
// a glance (how many guards are on duty this second), then a tighter
// bento of the supporting counts. Its own small cyan/night-watch palette,
// distinct from the green ACCENT the rest of this app uses.
const OPS_CYAN = "#22d3ee";
const OPS_INK = "#0a1120";

function LiveClockBand() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <LinearGradient
      colors={[OPS_INK, "#0f2338", "#0a1120"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ borderRadius: 20, padding: 18, marginBottom: 14, overflow: "hidden", borderWidth: 1, borderColor: `${OPS_CYAN}30` }}
    >
      {/* Watermark icon — purely decorative, oversized and clipped */}
      <View style={{ position: "absolute", right: -14, top: -10, opacity: 0.08 }}>
        <ShieldCheck size={110} color={OPS_CYAN} />
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: OPS_CYAN }} />
        <Text style={{ color: OPS_CYAN, fontSize: 9.5, fontFamily: fonts.heading.bold, letterSpacing: 2 }}>LIVE</Text>
        <Text style={{ color: "rgba(226,232,240,0.5)", fontSize: 9.5, fontFamily: fonts.body.regular, letterSpacing: 0.4, marginLeft: 4 }}>
          SECURITY OPS
        </Text>
      </View>

      <Text style={{ color: "#f1f5f9", fontSize: 40, fontFamily: fonts.heading.bold, letterSpacing: 0.5, fontVariant: ["tabular-nums"] }}>
        {now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true })}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4 }}>
        <CalendarClock size={11} color="rgba(226,232,240,0.6)" />
        <Text style={{ color: "rgba(226,232,240,0.7)", fontSize: 11, fontFamily: fonts.body.regular }}>
          {now.toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
        </Text>
      </View>
    </LinearGradient>
  );
}

function BentoTile({ label, value, icon: Icon, color, flex = 1 }: {
  label: string; value: string | number; icon: React.ComponentType<{ size?: number; color?: string }>; color: string; flex?: number;
}) {
  return (
    <View style={{ flex, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: `${color}28`, padding: 13 }}>
      <View style={{ width: 24, height: 24, borderRadius: 7, backgroundColor: `${color}1f`, alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
        <Icon size={12} color={color} />
      </View>
      <Text style={{ fontSize: 19, fontFamily: fonts.heading.bold, color: colors.foreground, fontVariant: ["tabular-nums"] }}>{value}</Text>
      <Text style={{ fontSize: 9, fontFamily: fonts.heading.semibold, color: colors.mutedForeground, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 2 }}>
        {label}
      </Text>
    </View>
  );
}

function OverviewTab() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["sec-attendance-dashboard"],
    queryFn: getSecurityAttendanceDashboard,
    refetchInterval: 60_000,
  });

  const total = data?.totalPersonnel ?? 0;
  const onDuty = data?.currentlyOnDuty ?? 0;
  const dutyPct = total > 0 ? onDuty / total : 0;

  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} tintColor={OPS_CYAN} />}
    >
      <LiveClockBand />

      {isLoading ? (
        <ActivityIndicator color={colors.mutedForeground} style={{ marginTop: 30 }} />
      ) : (
        <>
          {/* Featured tile — the one number worth a glance-and-go. */}
          <View
            style={{
              flexDirection: "row", alignItems: "center", gap: 16,
              backgroundColor: colors.card, borderRadius: 20, borderWidth: 1, borderColor: `${OPS_CYAN}30`,
              padding: 16, marginBottom: 10,
            }}
          >
            <RadialGauge
              progress={dutyPct}
              size={92}
              strokeWidth={10}
              color={OPS_CYAN}
              centerValue={String(onDuty)}
              centerLabel="on duty"
            />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: colors.foreground, fontSize: 15, fontFamily: fonts.heading.bold }}>On Duty Right Now</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular, marginTop: 3, lineHeight: 15 }}>
                {onDuty} of {total} active personnel are checked in and haven't checked out yet.
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 8 }}>
                <View style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.muted, overflow: "hidden" }}>
                  <View style={{ width: `${Math.round(dutyPct * 100)}%`, height: "100%", backgroundColor: OPS_CYAN, borderRadius: 2 }} />
                </View>
                <Text style={{ color: OPS_CYAN, fontSize: 10.5, fontFamily: fonts.heading.bold }}>{Math.round(dutyPct * 100)}%</Text>
              </View>
            </View>
          </View>

          {/* Supporting counts — asymmetric bento, not a uniform grid. */}
          <View style={{ flexDirection: "row", gap: 10, marginBottom: 10 }}>
            <BentoTile label="Present Today" value={data?.presentToday ?? 0} icon={UserCheck} color="#22c55e" flex={1.3} />
            <BentoTile label="Absent" value={data?.absentToday ?? 0} icon={UserX} color="#f43f5e" />
          </View>
          <View style={{ flexDirection: "row", gap: 10, marginBottom: 10 }}>
            <BentoTile label="Late Today" value={data?.lateToday ?? 0} icon={Clock} color="#f59e0b" />
            <BentoTile label="Total Personnel" value={total} icon={Users} color="#8b5cf6" flex={1.3} />
          </View>

          {/* Footer strip — a quieter, less-urgent number. */}
          <View
            style={{
              flexDirection: "row", alignItems: "center", gap: 10,
              backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border,
              paddingVertical: 12, paddingHorizontal: 14,
            }}
          >
            <ClipboardList size={14} color={colors.mutedForeground} />
            <Text style={{ flex: 1, color: colors.mutedForeground, fontSize: 11.5, fontFamily: fonts.body.regular }}>
              Total attendance records on file
            </Text>
            <Text style={{ color: colors.foreground, fontSize: 13.5, fontFamily: fonts.heading.bold, fontVariant: ["tabular-nums"] }}>
              {data?.totalAttendanceRecords ?? 0}
            </Text>
          </View>
        </>
      )}
    </ScrollView>
  );
}

// ─── Today (Check-In / Check-Out) ───────────────────────────────────────
function SectionHeader({ label, icon: Icon }: { label: string; icon: React.ComponentType<{ size?: number; color?: string }> }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10, marginTop: 4 }}>
      <Icon size={13} color={ACCENT} />
      <Text style={{ color: colors.foreground, fontSize: 11.5, fontFamily: fonts.heading.semibold, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</Text>
    </View>
  );
}

function TodayTab({ rights }: { rights: ReturnType<typeof usePageRights> }) {
  const qc = useQueryClient();
  const date = today();
  const personnelQ = useQuery({ queryKey: ["sec-personnel"], queryFn: () => getSecurityPersonnel() });
  const shiftsQ = useQuery({ queryKey: ["sec-shifts"], queryFn: getSecurityShifts });
  const attendanceQ = useQuery({ queryKey: ["sec-attendance", date], queryFn: () => getSecurityAttendance({ date }) });

  const [checkInTarget, setCheckInTarget] = useState<SecurityPersonnelRow | null>(null);
  const [checkOutTarget, setCheckOutTarget] = useState<SecurityAttendanceRow | null>(null);
  const [absentTarget, setAbsentTarget] = useState<SecurityPersonnelRow | null>(null);
  const [shiftPickerOpen, setShiftPickerOpen] = useState(false);
  const [selectedShiftId, setSelectedShiftId] = useState<number | null>(null);
  const [remarks, setRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [burstLabel, setBurstLabel] = useState<string | null>(null);

  const loading = personnelQ.isLoading || attendanceQ.isLoading;
  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([personnelQ.refetch(), attendanceQ.refetch()]);
    setRefreshing(false);
  };
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["sec-attendance"] });
    qc.invalidateQueries({ queryKey: ["sec-attendance-dashboard"] });
  };
  // Animates the row's move between sections (LayoutAnimation) under cover
  // of the SuccessBurst overlay (see its own comment) instead of a toast —
  // this screen is about a physical action just taken, so the feedback is
  // a full-screen moment, not a corner notification.
  const fireBurst = (label: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setBurstLabel(label);
    setTimeout(() => setBurstLabel(null), 950);
  };

  const activePersonnel = (personnelQ.data ?? []).filter((p) => p.Status === "Active");
  const attended = attendanceQ.data ?? [];
  const attendedIds = new Set(attended.map((a) => a.SecurityId));
  const notYetAttended = activePersonnel.filter((p) => !attendedIds.has(p.Id));

  const shiftOptions: PickerOption[] = (shiftsQ.data ?? [])
    .filter((s) => s.Status === "Active")
    .map((s) => ({ key: String(s.Id), label: s.Name, sublabel: `${fmtTimeUtc(s.StartTime)}–${fmtTimeUtc(s.EndTime)}` }));

  const openCheckIn = (p: SecurityPersonnelRow) => { setCheckInTarget(p); setSelectedShiftId(p.DefaultShiftId ?? null); setRemarks(""); };
  const openAbsent = (p: SecurityPersonnelRow) => { setAbsentTarget(p); setSelectedShiftId(p.DefaultShiftId ?? null); setRemarks(""); };

  const submitCheckIn = async () => {
    if (!checkInTarget || !selectedShiftId) { toast.error("Select a shift."); return; }
    setSubmitting(true);
    try {
      const res = await checkInSecurity({ securityId: checkInTarget.Id, shiftId: selectedShiftId, remarks: remarks || undefined });
      setCheckInTarget(null);
      invalidate();
      fireBurst(`${checkInTarget.Name} checked in — marked ${res.status}`);
    } catch (err) {
      toast.error((err as Error).message || "Check-in failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const submitCheckOut = async () => {
    if (!checkOutTarget) return;
    setSubmitting(true);
    try {
      const res = await checkOutSecurity(checkOutTarget.Id, remarks || undefined);
      setCheckOutTarget(null);
      invalidate();
      fireBurst(`${checkOutTarget.SecurityName} checked out — ${res.dutyHoursLabel} on duty`);
    } catch (err) {
      toast.error((err as Error).message || "Check-out failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const submitAbsent = async () => {
    if (!absentTarget || !selectedShiftId) { toast.error("Select a shift."); return; }
    setSubmitting(true);
    try {
      await markSecurityAbsent({ securityId: absentTarget.Id, shiftId: selectedShiftId, date, remarks: remarks || undefined });
      setAbsentTarget(null);
      invalidate();
      fireBurst(`${absentTarget.Name} marked absent`);
    } catch (err) {
      toast.error((err as Error).message || "Failed to mark absent.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <ActivityIndicator color={colors.mutedForeground} style={{ marginTop: 60 }} />;
  }

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} />}
      >
        <SectionHeader label={`Not Yet Checked In — ${fmtDate(date)}`} icon={LogIn} />
        {notYetAttended.length === 0 ? (
          <View style={{ borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, borderRadius: 12, padding: 18, alignItems: "center", marginBottom: 18 }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular }}>Everyone active has a record for today.</Text>
          </View>
        ) : (
          <View style={{ marginBottom: 18 }}>
            {notYetAttended.map((p) => (
              <Card key={p.Id}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: "rgba(101,163,13,0.14)", alignItems: "center", justifyContent: "center" }}>
                    <ShieldCheck size={14} color="#bef264" />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.semibold }}>{p.Name}</Text>
                    <Line>{p.SecurityCode}{p.DefaultShiftName ? ` · ${p.DefaultShiftName}` : ""}</Line>
                  </View>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    {rights.canEdit && (
                      <Pressable onPress={() => openAbsent(p)} style={{ paddingHorizontal: 9, paddingVertical: 7, borderRadius: 9, borderWidth: 1, borderColor: colors.border }}>
                        <UserX size={13} color={colors.mutedForeground} />
                      </Pressable>
                    )}
                    {rights.canCreate && (
                      <Pressable
                        onPress={() => openCheckIn(p)}
                        style={({ pressed }) => ({
                          flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 11, paddingVertical: 8, borderRadius: 10,
                          backgroundColor: "rgba(101,163,13,0.16)", borderWidth: 1, borderColor: "rgba(101,163,13,0.35)",
                          transform: [{ scale: pressed ? 0.94 : 1 }],
                        })}
                      >
                        <LogIn size={12} color="#bef264" />
                        <Text style={{ color: "#bef264", fontSize: 11, fontFamily: fonts.heading.semibold }}>Check In</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              </Card>
            ))}
          </View>
        )}

        <SectionHeader label="Today's Attendance" icon={ClipboardList} />
        {attended.length === 0 ? (
          <View style={{ borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, borderRadius: 12, padding: 18, alignItems: "center" }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular }}>No attendance recorded yet today.</Text>
          </View>
        ) : (
          attended.map((a) => {
            const canCheckOut = rights.canEdit && !a.CheckOut && !a.IsCancelled;
            return (
              <Card key={a.Id}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: "rgba(101,163,13,0.14)", alignItems: "center", justifyContent: "center" }}>
                    <ShieldCheck size={14} color="#bef264" />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.semibold }}>{a.SecurityName}</Text>
                      <Pill label={a.Status} tone={STATUS_TONE[a.Status]} />
                    </View>
                    <Line>{a.SecurityCode} · {a.ShiftName}</Line>
                    <Line>In {fmtTime(a.CheckIn)}{a.CheckOut ? ` · Out ${fmtTime(a.CheckOut)}` : ""}</Line>
                  </View>
                  {canCheckOut && (
                    <Pressable
                      onPress={() => { setCheckOutTarget(a); setRemarks(""); }}
                      style={({ pressed }) => ({
                        flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 11, paddingVertical: 8, borderRadius: 10,
                        backgroundColor: "rgba(56,189,248,0.14)", borderWidth: 1, borderColor: "rgba(56,189,248,0.32)",
                        transform: [{ scale: pressed ? 0.94 : 1 }],
                      })}
                    >
                      <LogOut size={12} color="#7dd3fc" />
                      <Text style={{ color: "#7dd3fc", fontSize: 11, fontFamily: fonts.heading.semibold }}>Check Out</Text>
                    </Pressable>
                  )}
                </View>
              </Card>
            );
          })
        )}
      </ScrollView>

      <ConfirmSheet
        visible={!!checkInTarget}
        title={`Check in ${checkInTarget?.Name ?? ""}`}
        message="Date & time are recorded automatically and can't be edited after submission."
        confirmLabel={submitting ? "Checking in…" : "Check In"}
        loading={submitting}
        onConfirm={submitCheckIn}
        onClose={() => setCheckInTarget(null)}
      >
        <PickerRow
          label="Shift"
          value={shiftOptions.find((o) => o.key === String(selectedShiftId))?.label ?? ""}
          required
          onPress={() => setShiftPickerOpen(true)}
        />
        <RemarksField label="Remarks (optional)" value={remarks} onChangeText={setRemarks} />
      </ConfirmSheet>

      <ConfirmSheet
        visible={!!checkOutTarget}
        title={`Check out ${checkOutTarget?.SecurityName ?? ""}`}
        message={`Checked in at ${fmtTime(checkOutTarget?.CheckIn)}. Duty hours are computed automatically.`}
        tone="primary"
        confirmLabel={submitting ? "Checking out…" : "Check Out"}
        loading={submitting}
        onConfirm={submitCheckOut}
        onClose={() => setCheckOutTarget(null)}
      >
        <RemarksField label="Remarks (optional)" value={remarks} onChangeText={setRemarks} />
      </ConfirmSheet>

      <ConfirmSheet
        visible={!!absentTarget}
        title={`Mark absent — ${absentTarget?.Name ?? ""}`}
        tone="danger"
        confirmLabel={submitting ? "Saving…" : "Mark Absent"}
        loading={submitting}
        onConfirm={submitAbsent}
        onClose={() => setAbsentTarget(null)}
      >
        <PickerRow
          label="Shift"
          value={shiftOptions.find((o) => o.key === String(selectedShiftId))?.label ?? ""}
          required
          onPress={() => setShiftPickerOpen(true)}
        />
        <RemarksField label="Reason" value={remarks} onChangeText={setRemarks} placeholder="Reason for the documented no-show" />
      </ConfirmSheet>

      <OptionPickerModal
        visible={shiftPickerOpen}
        title="Select Shift"
        options={shiftOptions}
        selectedKey={selectedShiftId ? String(selectedShiftId) : null}
        loading={shiftsQ.isLoading}
        onSelect={(key) => { setSelectedShiftId(key ? Number(key) : null); setShiftPickerOpen(false); }}
        onClose={() => setShiftPickerOpen(false)}
      />

      <SuccessBurst visible={!!burstLabel} label={burstLabel ?? ""} color={OPS_CYAN} ink={OPS_INK} />
    </View>
  );
}

// ─── Personnel ───────────────────────────────────────────────────────────
function PersonnelTab({ rights }: { rights: ReturnType<typeof usePageRights> }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [formTarget, setFormTarget] = useState<SecurityPersonnelRow | "new" | null>(null);

  const shiftsQ = useQuery({ queryKey: ["sec-shifts"], queryFn: getSecurityShifts });
  const { data, isLoading, error } = useQuery({ queryKey: ["sec-personnel", search], queryFn: () => getSecurityPersonnel(search) });
  const rows = data ?? [];

  return (
    <>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, marginBottom: 14 }}>
          <Search size={13} color={colors.mutedForeground} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search code, name, phone…"
            placeholderTextColor={`${colors.mutedForeground}99`}
            style={{ flex: 1, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 12.5, paddingVertical: 10 }}
          />
        </View>

        {rights.canCreate && (
          <Pressable
            onPress={() => setFormTarget("new")}
            style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 12, backgroundColor: ACCENT, marginBottom: 14 }}
          >
            <Plus size={13} color="#1a1a1a" />
            <Text style={{ color: "#1a1a1a", fontSize: 12.5, fontFamily: fonts.heading.bold }}>Add Personnel</Text>
          </Pressable>
        )}

        {isLoading ? (
          <ActivityIndicator color={colors.mutedForeground} style={{ marginTop: 30 }} />
        ) : error ? (
          <Text style={{ color: colors.destructive, fontSize: 12, fontFamily: fonts.body.regular }}>{(error as Error).message}</Text>
        ) : rows.length === 0 ? (
          <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, textAlign: "center", paddingVertical: 30 }}>
            No security personnel yet.
          </Text>
        ) : (
          rows.map((p) => (
            <Card key={p.Id}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.semibold }}>{p.Name}</Text>
                    <Pill label={p.Status} tone={p.Status === "Active" ? "#10b981" : undefined} />
                  </View>
                  <Line>{p.SecurityCode}{p.Phone ? ` · ${p.Phone}` : ""}</Line>
                  {(p.VendorName || p.ProjectName) && (
                    <Line>{[p.VendorName, p.ProjectName].filter(Boolean).join(" · ")}</Line>
                  )}
                  <Line>{p.DefaultShiftName ?? "No default shift"}</Line>
                </View>
                {rights.canEdit && (
                  <Pressable onPress={() => setFormTarget(p)} hitSlop={8} style={{ padding: 6 }}>
                    <Pencil size={15} color={colors.mutedForeground} />
                  </Pressable>
                )}
              </View>
            </Card>
          ))
        )}
      </ScrollView>

      {formTarget !== null && (
        <PersonnelFormSheet
          person={formTarget === "new" ? null : formTarget}
          shifts={shiftsQ.data ?? []}
          onClose={() => setFormTarget(null)}
          onSaved={() => { setFormTarget(null); qc.invalidateQueries({ queryKey: ["sec-personnel"] }); }}
        />
      )}
    </>
  );
}

function PersonnelFormSheet({
  person, shifts, onClose, onSaved,
}: { person: SecurityPersonnelRow | null; shifts: SecurityShift[]; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!person;
  const [securityCode, setSecurityCode] = useState(person?.SecurityCode || "");
  const [name, setName] = useState(person?.Name || "");
  const [phone, setPhone] = useState(person?.Phone || "");
  const [defaultShiftId, setDefaultShiftId] = useState<number | null>(person?.DefaultShiftId ?? null);
  const [status, setStatus] = useState<"Active" | "Inactive">(person?.Status || "Active");
  const [remarks, setRemarks] = useState("");
  const [shiftPickerOpen, setShiftPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // ── Vendor — server-driven typeahead across Supplier/Contractor/Broker/
  //     Customer heads, same set Vendor Ledger Report searches. ──────────
  const [vendorId, setVendorId] = useState<number | null>(person?.VendorId ?? null);
  const [vendorLabel, setVendorLabel] = useState(person?.VendorName || "");
  const [vendorQuery, setVendorQuery] = useState("");
  const [vendorDebounced, setVendorDebounced] = useState("");
  const [vendorPickerOpen, setVendorPickerOpen] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVendorDebounced(vendorQuery.trim()), 250);
    return () => clearTimeout(t);
  }, [vendorQuery]);
  const { data: vendorResults = [], isFetching: vendorSearching } = useQuery({
    queryKey: ["sec-vendor-search", vendorDebounced],
    queryFn: () => searchSecurityVendors(vendorDebounced),
    enabled: vendorDebounced.length >= 2,
  });
  const vendorOptions: PickerOption[] = vendorResults.map((v) => ({ key: String(v.id), label: v.name, sublabel: v.typeLabel }));

  // ── Project ───────────────────────────────────────────────────────────
  const [projectId, setProjectId] = useState<number | null>(person?.ProjectId ?? null);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const { data: projects = [] } = useQuery({ queryKey: ["project-options"], queryFn: getProjectOptions, staleTime: 5 * 60 * 1000 });
  const projectOptions: PickerOption[] = projects.map((p) => ({ key: String(p.id), label: p.label }));

  const shiftOptions: PickerOption[] = shifts.map((s) => ({ key: String(s.Id), label: s.Name }));

  const handleSave = async () => {
    if (!isEdit && !securityCode.trim()) { toast.error("Security ID is required."); return; }
    if (!name.trim()) { toast.error("Name is required."); return; }
    setSaving(true);
    try {
      if (isEdit) {
        await updateSecurityPersonnel(person!.Id, { name, phone: phone || undefined, defaultShiftId, vendorId, projectId, status, remarks: remarks || undefined });
        toast.success("Personnel updated.");
      } else {
        await createSecurityPersonnel({ securityCode, name, phone: phone || undefined, defaultShiftId, vendorId, projectId, remarks: remarks || undefined });
        toast.success("Personnel added.");
      }
      onSaved();
    } catch (err) {
      toast.error((err as Error).message || "Failed to save personnel.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <ConfirmSheet
        visible
        title={isEdit ? `Edit — ${person!.Name}` : "Add Security Personnel"}
        confirmLabel={saving ? "Saving…" : "Save"}
        tone="primary"
        loading={saving}
        onConfirm={handleSave}
        onClose={onClose}
      >
        <TextField label="Security ID" value={securityCode} onChangeText={setSecurityCode} required disabled={isEdit} />
        <TextField label="Name" value={name} onChangeText={setName} required />
        <TextField label="Phone" value={phone} onChangeText={setPhone} keyboardType="default" />
        <PickerRow
          label="Vendor (Supplier / Contractor / Broker / Customer)"
          value={vendorLabel}
          placeholder="Search vendor…"
          onPress={() => setVendorPickerOpen(true)}
        />
        <PickerRow
          label="Project"
          value={projectOptions.find((o) => o.key === String(projectId))?.label ?? ""}
          placeholder="Not assigned"
          onPress={() => setProjectPickerOpen(true)}
        />
        <PickerRow
          label="Default Shift"
          value={shiftOptions.find((o) => o.key === String(defaultShiftId))?.label ?? ""}
          placeholder="Not assigned"
          onPress={() => setShiftPickerOpen(true)}
        />
        {isEdit && (
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 14 }}>
            {(["Active", "Inactive"] as const).map((s) => (
              <Pressable
                key={s}
                onPress={() => setStatus(s)}
                style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", borderWidth: 1, borderColor: status === s ? ACCENT : colors.border, backgroundColor: status === s ? `${ACCENT}1a` : "transparent" }}
              >
                <Text style={{ color: status === s ? ACCENT : colors.mutedForeground, fontSize: 12, fontFamily: fonts.heading.semibold }}>{s}</Text>
              </Pressable>
            ))}
          </View>
        )}
        <RemarksField label="Remarks" value={remarks} onChangeText={setRemarks} />
      </ConfirmSheet>

      <OptionPickerModal
        visible={shiftPickerOpen}
        title="Select Default Shift"
        options={shiftOptions}
        selectedKey={defaultShiftId ? String(defaultShiftId) : null}
        clearable
        onSelect={(key) => { setDefaultShiftId(key ? Number(key) : null); setShiftPickerOpen(false); }}
        onClose={() => setShiftPickerOpen(false)}
      />

      <OptionPickerModal
        visible={vendorPickerOpen}
        title="Select Vendor"
        options={vendorOptions}
        selectedKey={vendorId ? String(vendorId) : null}
        searchable
        clearable
        loading={vendorSearching}
        query={vendorQuery}
        onQueryChange={setVendorQuery}
        searchPlaceholder="Search by name…"
        onSelect={(key) => {
          if (!key) { setVendorId(null); setVendorLabel(""); } else {
            const v = vendorResults.find((r) => String(r.id) === key);
            setVendorId(v ? v.id : null);
            setVendorLabel(v ? v.name : "");
          }
          setVendorPickerOpen(false);
        }}
        onClose={() => setVendorPickerOpen(false)}
      />

      <OptionPickerModal
        visible={projectPickerOpen}
        title="Select Project"
        options={projectOptions}
        selectedKey={projectId ? String(projectId) : null}
        searchable
        clearable
        onSelect={(key) => { setProjectId(key ? Number(key) : null); setProjectPickerOpen(false); }}
        onClose={() => setProjectPickerOpen(false)}
      />
    </>
  );
}

// ─── History ─────────────────────────────────────────────────────────────
function HistoryTab({ rights }: { rights: ReturnType<typeof usePageRights> }) {
  const qc = useQueryClient();
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);
  const [securityId, setSecurityId] = useState<number | null>(null);
  const [shiftId, setShiftId] = useState<number | null>(null);
  const [status, setStatus] = useState<string>("");
  const [verificationStatus, setVerificationStatus] = useState<string>("");

  const [personnelPickerOpen, setPersonnelPickerOpen] = useState(false);
  const [shiftPickerOpen, setShiftPickerOpen] = useState(false);
  const [statusPickerOpen, setStatusPickerOpen] = useState(false);
  const [verifPickerOpen, setVerifPickerOpen] = useState(false);

  const [rejectTarget, setRejectTarget] = useState<SecurityAttendanceRow | null>(null);
  const [cancelTarget, setCancelTarget] = useState<SecurityAttendanceRow | null>(null);
  const [logsTarget, setLogsTarget] = useState<SecurityAttendanceRow | null>(null);
  const [remarks, setRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const personnelQ = useQuery({ queryKey: ["sec-personnel"], queryFn: () => getSecurityPersonnel() });
  const shiftsQ = useQuery({ queryKey: ["sec-shifts"], queryFn: getSecurityShifts });

  const filters = useMemo(
    () => ({ dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, securityId: securityId || undefined, shiftId: shiftId || undefined, status: status || undefined, verificationStatus: verificationStatus || undefined }),
    [dateFrom, dateTo, securityId, shiftId, status, verificationStatus],
  );
  const { data, isLoading, error } = useQuery({ queryKey: ["sec-attendance-history", filters], queryFn: () => getSecurityAttendance(filters) });
  const rows = data ?? [];

  const invalidate = () => qc.invalidateQueries({ queryKey: ["sec-attendance-history"] });

  const personnelOptions: PickerOption[] = (personnelQ.data ?? []).map((p) => ({ key: String(p.Id), label: p.Name }));
  const shiftOptions: PickerOption[] = (shiftsQ.data ?? []).map((s) => ({ key: String(s.Id), label: s.Name }));
  const statusOptions: PickerOption[] = ["Present", "Late", "Absent", "HalfDay"].map((s) => ({ key: s, label: s }));
  const verifOptions: PickerOption[] = ["Pending", "Verified", "Rejected"].map((s) => ({ key: s, label: s }));

  const handleVerify = async (row: SecurityAttendanceRow) => {
    try {
      await verifySecurityAttendance(row.Id);
      toast.success("Attendance verified.");
      invalidate();
    } catch (err) {
      toast.error((err as Error).message || "Failed to verify.");
    }
  };

  const submitReject = async () => {
    if (!rejectTarget) return;
    if (!remarks.trim()) { toast.error("Remarks are required."); return; }
    setSubmitting(true);
    try {
      await rejectSecurityAttendance(rejectTarget.Id, remarks.trim());
      toast.success("Attendance rejected.");
      setRejectTarget(null);
      invalidate();
    } catch (err) {
      toast.error((err as Error).message || "Failed to reject.");
    } finally {
      setSubmitting(false);
    }
  };

  const submitCancel = async () => {
    if (!cancelTarget) return;
    if (!remarks.trim()) { toast.error("Remarks are required."); return; }
    setSubmitting(true);
    try {
      await cancelSecurityAttendance(cancelTarget.Id, remarks.trim());
      toast.success("Attendance record cancelled.");
      setCancelTarget(null);
      invalidate();
    } catch (err) {
      toast.error((err as Error).message || "Failed to cancel.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <View style={{ marginBottom: 14, gap: 8 }}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}><DateField label="From" value={dateFrom} onChange={setDateFrom} /></View>
            <View style={{ flex: 1 }}><DateField label="To" value={dateTo} onChange={setDateTo} /></View>
          </View>
          <PickerRow label="Personnel" value={personnelOptions.find((o) => o.key === String(securityId))?.label ?? ""} placeholder="All Personnel" onPress={() => setPersonnelPickerOpen(true)} />
          <PickerRow label="Shift" value={shiftOptions.find((o) => o.key === String(shiftId))?.label ?? ""} placeholder="All Shifts" onPress={() => setShiftPickerOpen(true)} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <PickerRow label="Status" value={status} placeholder="All Status" onPress={() => setStatusPickerOpen(true)} />
            </View>
            <View style={{ flex: 1 }}>
              <PickerRow label="Verification" value={verificationStatus} placeholder="All" onPress={() => setVerifPickerOpen(true)} />
            </View>
          </View>
        </View>

        {isLoading ? (
          <ActivityIndicator color={colors.mutedForeground} style={{ marginTop: 30 }} />
        ) : error ? (
          <Text style={{ color: colors.destructive, fontSize: 12, fontFamily: fonts.body.regular }}>{(error as Error).message}</Text>
        ) : rows.length === 0 ? (
          <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, textAlign: "center", paddingVertical: 30 }}>
            No attendance records match these filters.
          </Text>
        ) : (
          rows.map((r) => (
            <Card key={r.Id}>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.semibold }}>{r.SecurityName}</Text>
                    <Pill label={r.Status} tone={STATUS_TONE[r.Status]} />
                    <Pill label={r.VerificationStatus} tone={VERIFICATION_TONE[r.VerificationStatus]} />
                  </View>
                  <Line>{fmtDate(r.AttendanceDate)} · {r.SecurityCode} · {r.ShiftName}</Line>
                  <Line>In {fmtTime(r.CheckIn)}{r.CheckOut ? ` · Out ${fmtTime(r.CheckOut)}` : ""}</Line>
                </View>
                <View style={{ flexDirection: "row", gap: 6 }}>
                  <Pressable onPress={() => setLogsTarget(r)} hitSlop={6} style={{ padding: 5 }}>
                    <HistoryIcon size={14} color={colors.mutedForeground} />
                  </Pressable>
                  {rights.canEdit && r.VerificationStatus === "Pending" && (
                    <>
                      <Pressable onPress={() => handleVerify(r)} hitSlop={6} style={{ padding: 5 }}>
                        <CheckCircle2 size={14} color="#10b981" />
                      </Pressable>
                      <Pressable onPress={() => { setRejectTarget(r); setRemarks(""); }} hitSlop={6} style={{ padding: 5 }}>
                        <XCircle size={14} color="#ef4444" />
                      </Pressable>
                    </>
                  )}
                  {rights.canDelete && !r.IsCancelled && (
                    <Pressable onPress={() => { setCancelTarget(r); setRemarks(""); }} hitSlop={6} style={{ padding: 5 }}>
                      <Ban size={14} color={colors.destructive} />
                    </Pressable>
                  )}
                </View>
              </View>
            </Card>
          ))
        )}
      </ScrollView>

      <ConfirmSheet
        visible={!!rejectTarget}
        title={`Reject Attendance — ${rejectTarget?.SecurityName ?? ""}`}
        tone="danger"
        confirmLabel={submitting ? "Rejecting…" : "Reject"}
        loading={submitting}
        onConfirm={submitReject}
        onClose={() => setRejectTarget(null)}
      >
        <RemarksField label="Remarks" value={remarks} onChangeText={setRemarks} required />
      </ConfirmSheet>

      <ConfirmSheet
        visible={!!cancelTarget}
        title={`Cancel Attendance — ${cancelTarget?.SecurityName ?? ""}`}
        tone="danger"
        confirmLabel={submitting ? "Cancelling…" : "Cancel Record"}
        loading={submitting}
        onConfirm={submitCancel}
        onClose={() => setCancelTarget(null)}
      >
        <RemarksField label="Remarks" value={remarks} onChangeText={setRemarks} required />
      </ConfirmSheet>

      {logsTarget && <AttendanceLogsSheet row={logsTarget} onClose={() => setLogsTarget(null)} />}

      <OptionPickerModal visible={personnelPickerOpen} title="Select Personnel" options={personnelOptions} selectedKey={securityId ? String(securityId) : null} searchable clearable onSelect={(key) => { setSecurityId(key ? Number(key) : null); setPersonnelPickerOpen(false); }} onClose={() => setPersonnelPickerOpen(false)} />
      <OptionPickerModal visible={shiftPickerOpen} title="Select Shift" options={shiftOptions} selectedKey={shiftId ? String(shiftId) : null} clearable onSelect={(key) => { setShiftId(key ? Number(key) : null); setShiftPickerOpen(false); }} onClose={() => setShiftPickerOpen(false)} />
      <OptionPickerModal visible={statusPickerOpen} title="Select Status" options={statusOptions} selectedKey={status || null} clearable onSelect={(key) => { setStatus(key); setStatusPickerOpen(false); }} onClose={() => setStatusPickerOpen(false)} />
      <OptionPickerModal visible={verifPickerOpen} title="Select Verification" options={verifOptions} selectedKey={verificationStatus || null} clearable onSelect={(key) => { setVerificationStatus(key); setVerifPickerOpen(false); }} onClose={() => setVerifPickerOpen(false)} />
    </>
  );
}

function AttendanceLogsSheet({ row, onClose }: { row: SecurityAttendanceRow; onClose: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ["sec-attendance-logs", row.Id], queryFn: () => getSecurityAttendanceLogs(row.Id) });
  const logs = data ?? [];

  return (
    <ConfirmSheet
      visible
      title={`Audit Log — ${row.SecurityName}`}
      message={fmtDate(row.AttendanceDate)}
      confirmLabel="Close"
      tone="primary"
      onConfirm={onClose}
      onClose={onClose}
    >
      {isLoading ? (
        <ActivityIndicator color={colors.mutedForeground} />
      ) : logs.length === 0 ? (
        <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular }}>No log entries.</Text>
      ) : (
        <View style={{ gap: 8 }}>
          {logs.map((l) => (
            <View key={l.Id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.heading.semibold }}>{l.Action}</Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.regular }}>
                  {new Date(l.PerformedAt).toLocaleString("en-IN")}
                </Text>
              </View>
              <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.body.regular, marginTop: 3 }}>
                By: {l.PerformedBy || "—"}
              </Text>
              {!!l.Remarks && (
                <Text style={{ color: colors.foreground, fontSize: 11, fontFamily: fonts.body.regular, marginTop: 3 }}>{l.Remarks}</Text>
              )}
            </View>
          ))}
        </View>
      )}
    </ConfirmSheet>
  );
}

// ─── Shifts ──────────────────────────────────────────────────────────────
function ShiftsTab({ rights }: { rights: ReturnType<typeof usePageRights> }) {
  const qc = useQueryClient();
  const [formTarget, setFormTarget] = useState<SecurityShift | "new" | null>(null);
  const { data, isLoading, error } = useQuery({ queryKey: ["sec-shifts"], queryFn: getSecurityShifts });
  const rows = data ?? [];

  return (
    <>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {rights.canCreate && (
          <Pressable
            onPress={() => setFormTarget("new")}
            style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 12, backgroundColor: ACCENT, marginBottom: 14 }}
          >
            <Plus size={13} color="#1a1a1a" />
            <Text style={{ color: "#1a1a1a", fontSize: 12.5, fontFamily: fonts.heading.bold }}>Add Shift</Text>
          </Pressable>
        )}

        {isLoading ? (
          <ActivityIndicator color={colors.mutedForeground} style={{ marginTop: 30 }} />
        ) : error ? (
          <Text style={{ color: colors.destructive, fontSize: 12, fontFamily: fonts.body.regular }}>{(error as Error).message}</Text>
        ) : rows.length === 0 ? (
          <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, textAlign: "center", paddingVertical: 30 }}>No shifts on file.</Text>
        ) : (
          rows.map((s) => (
            <Card key={s.Id}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.semibold }}>{s.Name}</Text>
                    <Pill label={s.Status} tone={s.Status === "Active" ? "#10b981" : undefined} />
                  </View>
                  <Line>{fmtTimeUtc(s.StartTime)} – {fmtTimeUtc(s.EndTime)} · {s.GraceMinutes} min grace</Line>
                </View>
                {rights.canEdit && (
                  <Pressable onPress={() => setFormTarget(s)} hitSlop={8} style={{ padding: 6 }}>
                    <Pencil size={15} color={colors.mutedForeground} />
                  </Pressable>
                )}
              </View>
            </Card>
          ))
        )}
      </ScrollView>

      {formTarget !== null && (
        <ShiftFormSheet
          shift={formTarget === "new" ? null : formTarget}
          onClose={() => setFormTarget(null)}
          onSaved={() => { setFormTarget(null); qc.invalidateQueries({ queryKey: ["sec-shifts"] }); }}
        />
      )}
    </>
  );
}

function ShiftFormSheet({ shift, onClose, onSaved }: { shift: SecurityShift | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!shift;
  const toHm = (t?: string | null) => {
    if (!t) return "";
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? "" : `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  };
  const [name, setName] = useState(shift?.Name || "");
  const [startTime, setStartTime] = useState(toHm(shift?.StartTime));
  const [endTime, setEndTime] = useState(toHm(shift?.EndTime));
  const [graceMinutes, setGraceMinutes] = useState(shift ? String(shift.GraceMinutes) : "10");
  const [status, setStatus] = useState<"Active" | "Inactive">(shift?.Status || "Active");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim() || !startTime || !endTime) { toast.error("Name, start and end time are required."); return; }
    setSaving(true);
    try {
      const payload = { name, startTime: `${startTime}:00`, endTime: `${endTime}:00`, graceMinutes: Number(graceMinutes) || 0 };
      if (isEdit) {
        await updateSecurityShift(shift!.Id, { ...payload, status });
        toast.success("Shift updated.");
      } else {
        await createSecurityShift(payload);
        toast.success("Shift created.");
      }
      onSaved();
    } catch (err) {
      toast.error((err as Error).message || "Failed to save shift.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ConfirmSheet
      visible
      title={isEdit ? `Edit — ${shift!.Name}` : "Add Shift"}
      confirmLabel={saving ? "Saving…" : "Save"}
      tone="primary"
      loading={saving}
      onConfirm={handleSave}
      onClose={onClose}
    >
      <TextField label="Name" value={name} onChangeText={setName} required />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}><TimeField label="Start Time" value={startTime} onChange={setStartTime} required /></View>
        <View style={{ flex: 1 }}><TimeField label="End Time" value={endTime} onChange={setEndTime} required /></View>
      </View>
      <TextField label="Grace Minutes" value={graceMinutes} onChangeText={setGraceMinutes} keyboardType="numeric" />
      {isEdit && (
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 14 }}>
          {(["Active", "Inactive"] as const).map((s) => (
            <Pressable
              key={s}
              onPress={() => setStatus(s)}
              style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", borderWidth: 1, borderColor: status === s ? ACCENT : colors.border, backgroundColor: status === s ? `${ACCENT}1a` : "transparent" }}
            >
              <Text style={{ color: status === s ? ACCENT : colors.mutedForeground, fontSize: 12, fontFamily: fonts.heading.semibold }}>{s}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </ConfirmSheet>
  );
}
