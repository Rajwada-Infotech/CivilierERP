// Security Attendance — today's check-in/check-out, the on-site headline
// action this screen exists for (see securityAttendanceApi.ts's own
// comment). Merges active personnel with today's attendance rows: anyone
// not yet checked in gets a Check In button (shift picker first), anyone
// checked in but not out gets a Check Out button, everyone else just shows
// their final status.
import { useMemo, useState } from "react";
import { View, Text, Pressable, ActivityIndicator, FlatList, RefreshControl } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, LogIn, LogOut } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { toast } from "@/components/Toast";
import { Card, Line, Pill } from "@/components/list/DataList";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { PickerRow, OptionPickerModal, type PickerOption } from "@/components/OptionPicker";
import {
  getSecurityPersonnel, getSecurityShifts, getSecurityAttendance,
  checkInSecurity, checkOutSecurity,
  type SecurityPersonnelRow, type SecurityAttendanceRow,
} from "@/api/securityAttendanceApi";

const today = () => new Date().toISOString().slice(0, 10);

interface Row {
  personnel: SecurityPersonnelRow;
  attendance: SecurityAttendanceRow | null;
}

export default function AttendanceScreen() {
  const qc = useQueryClient();
  const personnelQ = useQuery({ queryKey: ["sec-personnel"], queryFn: () => getSecurityPersonnel() });
  const shiftsQ = useQuery({ queryKey: ["sec-shifts"], queryFn: getSecurityShifts });
  const attendanceQ = useQuery({ queryKey: ["sec-attendance-today"], queryFn: () => getSecurityAttendance({ date: today() }) });

  const [checkInTarget, setCheckInTarget] = useState<SecurityPersonnelRow | null>(null);
  const [checkOutTarget, setCheckOutTarget] = useState<SecurityAttendanceRow | null>(null);
  const [shiftPickerOpen, setShiftPickerOpen] = useState(false);
  const [selectedShiftId, setSelectedShiftId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loading = personnelQ.isLoading || attendanceQ.isLoading;
  const error = personnelQ.error || attendanceQ.error;
  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([personnelQ.refetch(), attendanceQ.refetch()]);
    setRefreshing(false);
  };

  const rows: Row[] = useMemo(() => {
    const personnel = (personnelQ.data ?? []).filter((p) => p.Status === "Active");
    const byId = new Map((attendanceQ.data ?? []).map((a) => [a.SecurityId, a]));
    return personnel.map((p) => ({ personnel: p, attendance: byId.get(p.Id) ?? null }));
  }, [personnelQ.data, attendanceQ.data]);

  const shiftOptions: PickerOption[] = (shiftsQ.data ?? [])
    .filter((s) => s.Status === "Active")
    .map((s) => ({ key: String(s.Id), label: s.Name, sublabel: `${s.StartTime}–${s.EndTime}` }));

  const openCheckIn = (p: SecurityPersonnelRow) => {
    setCheckInTarget(p);
    setSelectedShiftId(p.DefaultShiftId ?? null);
  };

  const submitCheckIn = async () => {
    if (!checkInTarget || !selectedShiftId) return;
    setSubmitting(true);
    try {
      await checkInSecurity({ securityId: checkInTarget.Id, shiftId: selectedShiftId });
      toast.success(`${checkInTarget.Name} checked in.`);
      setCheckInTarget(null);
      qc.invalidateQueries({ queryKey: ["sec-attendance-today"] });
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
      const res = await checkOutSecurity(checkOutTarget.Id);
      toast.success(`${checkOutTarget.SecurityName} checked out — ${res.dutyHoursLabel} on duty.`);
      setCheckOutTarget(null);
      qc.invalidateQueries({ queryKey: ["sec-attendance-today"] });
    } catch (err) {
      toast.error((err as Error).message || "Check-out failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const renderRow = ({ item }: { item: Row }) => {
    const { personnel: p, attendance: a } = item;
    const notCheckedIn = !a;
    const canCheckOut = !!a && !a.CheckOut && !a.IsCancelled;
    return (
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: "rgba(101,163,13,0.14)", alignItems: "center", justifyContent: "center" }}>
                  <ShieldCheck size={14} color="#bef264" />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.semibold }}>{p.Name}</Text>
                  <Line>{p.SecurityCode}{a ? ` · ${a.ShiftName}` : p.DefaultShiftName ? ` · ${p.DefaultShiftName}` : ""}</Line>
                  {a && (
                    <Line>
                      {a.CheckIn ? `In ${new Date(a.CheckIn).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : "—"}
                      {a.CheckOut ? ` · Out ${new Date(a.CheckOut).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : ""}
                    </Line>
                  )}
                </View>

                {notCheckedIn ? (
                  <Pressable
                    onPress={() => openCheckIn(p)}
                    style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 11, paddingVertical: 8, borderRadius: 10, backgroundColor: "rgba(101,163,13,0.16)", borderWidth: 1, borderColor: "rgba(101,163,13,0.35)" }}
                  >
                    <LogIn size={12} color="#bef264" />
                    <Text style={{ color: "#bef264", fontSize: 11, fontFamily: fonts.heading.semibold }}>Check In</Text>
                  </Pressable>
                ) : canCheckOut ? (
                  <Pressable
                    onPress={() => setCheckOutTarget(a)}
                    style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 11, paddingVertical: 8, borderRadius: 10, backgroundColor: "rgba(56,189,248,0.14)", borderWidth: 1, borderColor: "rgba(56,189,248,0.32)" }}
                  >
                    <LogOut size={12} color="#7dd3fc" />
                    <Text style={{ color: "#7dd3fc", fontSize: 11, fontFamily: fonts.heading.semibold }}>Check Out</Text>
                  </Pressable>
                ) : (
                  <Pill label={a?.Status ?? "Done"} />
                )}
              </View>
      </Card>
    );
  };

  return (
    <>
      <View className="flex-1" style={{ backgroundColor: colors.background }}>
        {loading ? (
          <View style={{ paddingVertical: 60, alignItems: "center" }}>
            <ActivityIndicator color={colors.mutedForeground} />
          </View>
        ) : error ? (
          <Text style={{ color: colors.destructive, fontSize: 12, fontFamily: fonts.body.regular, padding: 16 }}>
            {(error as Error).message}
          </Text>
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(r) => String(r.personnel.Id)}
            renderItem={renderRow}
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 112 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#65a30d" />}
            ListEmptyComponent={
              <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, textAlign: "center", paddingVertical: 40 }}>
                No active security personnel on file.
              </Text>
            }
          />
        )}
      </View>

      {/* ── Check-in sheet — shift picker, then confirm ─────────────────── */}
      <ConfirmSheet
        visible={!!checkInTarget}
        title={`Check in ${checkInTarget?.Name ?? ""}`}
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

      {/* ── Check-out confirmation ───────────────────────────────────────── */}
      <ConfirmSheet
        visible={!!checkOutTarget}
        title={`Check out ${checkOutTarget?.SecurityName ?? ""}`}
        message="This closes out today's shift for this person."
        tone="primary"
        confirmLabel={submitting ? "Checking out…" : "Check Out"}
        loading={submitting}
        onConfirm={submitCheckOut}
        onClose={() => setCheckOutTarget(null)}
      />
    </>
  );
}
