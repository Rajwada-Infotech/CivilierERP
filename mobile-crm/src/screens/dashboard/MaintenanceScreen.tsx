// The Maintenance tab: the Maintenance pages the person has a right on (the web's MaintenanceSidebar.ts keys), then
// the Maintenance overview — RN port of src/pages/maintenance/MaintenanceDashboard.tsx (web): the same four stat
// cards and Breakdown section, from the same three endpoints. Charts are hand-drawn with react-native-svg (see
// components/charts/*).
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { crmGet, crmSend, type Row } from "@/api/crmApi";
import { toast } from "@/components/Toast";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { NumberField, RemarksField, TextField } from "@/components/form/Form";
import { DateField } from "@/components/form/DateField";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Users, Receipt, ListChecks, Wallet, TrendingUp, ShieldCheck, Zap, Ticket, KeyRound } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import type { MainStackParamList } from "@/navigation/MainStack";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import { DonutChart } from "@/components/charts/DonutChart";
import { TrendLineChart } from "@/components/charts/TrendLineChart";
import { getMaintenanceDirectory } from "@/api/maintenanceApi";
import { getActiveChargeHeads } from "@/api/chargeHeadApi";
import { getMaintenanceBills } from "@/api/maintenanceBillApi";
import { Figure, Heading, MenuGroup, Section, TAB_BAR_CLEARANCE } from "@/screens/crm/ui";


type MaintenanceRoute = "Directory" | "Bills" | "ServiceRequests" | "Attendance" | "Electricity" | "KeyCustodian";
/** The Maintenance pages, each with the page right that shows it — one list for the tab, its visibility and Home. */
export const MAINTENANCE_ITEMS: { route: MaintenanceRoute; label: string; sub: string; icon: typeof Users; pageKey: string }[] = [
  { route: "Directory",       label: "Customer Directory",      sub: "Residents of handed-over homes", icon: Users,       pageKey: "maintenance-directory" },
  { route: "Bills",           label: "Maintenance Bills",       sub: "Raise and view bills",           icon: Receipt,     pageKey: "maintenance-bills" },
  { route: "ServiceRequests", label: "Service Requests",        sub: "Residents' tickets",             icon: Ticket,      pageKey: "crm-service-tickets" },
  { route: "Attendance",      label: "Security Attendance",     sub: "Guards' check-ins and shifts",   icon: ShieldCheck, pageKey: "maintenance-security-attendance" },
  { route: "Electricity",     label: "Electricity Maintenance", sub: "Meters, readings and bills",     icon: Zap,         pageKey: "maintenance-electricity" },
  { route: "KeyCustodian",    label: "Key Custodian",           sub: "Who holds the keys until handover", icon: KeyRound,  pageKey: "maintenance-key-custodian" },
];
// The Maintenance module's own pages. Service Requests is a CRM page the Maintenance team also works, so a right on it
// alone shows it under the CRM tab, not a Maintenance tab.
const MAINTENANCE_PAGES = ["maintenance-directory", "maintenance-bills", "maintenance-security-attendance", "maintenance-electricity", "maintenance-key-custodian"];

/** True when the person may open any Maintenance page — the Maintenance tab shows only then. */
export function useHasMaintenance() {
  const { canAccessPage } = useAuth();
  return MAINTENANCE_PAGES.some((p) => canAccessPage(p));
}

// The overview's figure tiles and chart cards, in the app's kit (screens/crm/ui.tsx).
function StatCard({ label, value, color }: { label: string; value: string; icon?: unknown; color: string }) {
  return <Figure label={label} value={value} tone={color} />;
}

function ChartCard({ title, icon, children }: { title: string; icon: React.ComponentType<{ size?: number; color?: string }>; children: React.ReactNode }) {
  return <Section title={title} icon={icon as never}>{children}</Section>;
}

export default function MaintenanceScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const { canAccessPage } = useAuth();
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const pages = MAINTENANCE_ITEMS.filter((i) => canAccessPage(i.pageKey));
  // The overview reads the customer directory, charge heads and bills: shown to staff with both of those pages.
  const overview = canAccessPage("maintenance-directory") && canAccessPage("maintenance-bills");

  const directoryQ = useQuery({ queryKey: ["maint-directory", ""], queryFn: () => getMaintenanceDirectory(""), staleTime: 60_000, enabled: overview });
  const chargeHeadsQ = useQuery({ queryKey: ["charge-heads-active"], queryFn: getActiveChargeHeads, staleTime: 60_000, enabled: overview });
  const billsQ = useQuery({ queryKey: ["maint-bills", {}], queryFn: () => getMaintenanceBills(), staleTime: 60_000, enabled: overview });

  const directoryRows = directoryQ.data ?? [];
  const chargeHeadRows = chargeHeadsQ.data ?? [];
  const billRows = billsQ.data ?? [];
  const activeBills = billRows.filter((b) => b.Status === "Active");
  const cancelledBills = billRows.filter((b) => b.Status === "Cancelled");
  const totalBilled = activeBills.reduce((s, b) => s + (Number(b.GrandTotal) || 0), 0);

  const billedCustomerCount = new Set(activeBills.map((b) => b.BookingId)).size;
  const unbilledCustomerCount = Math.max(0, directoryRows.length - billedCustomerCount);

  const trendData = useMemo(() => {
    const days: { date: string; amount: number }[] = [];
    const byDate = new Map<string, number>();
    activeBills.forEach((b) => {
      if (!b.BillDate) return;
      const key = b.BillDate.slice(0, 10);
      byDate.set(key, (byDate.get(key) || 0) + (Number(b.GrandTotal) || 0));
    });
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      days.push({ date: key, amount: byDate.get(key) || 0 });
    }
    return days;
  }, [activeBills]);

  const loading = overview && (directoryQ.isLoading || chargeHeadsQ.isLoading || billsQ.isLoading);

  const onRefresh = async () => {
    setRefreshing(true);
    if (overview) await Promise.all([directoryQ.refetch(), chargeHeadsQ.refetch(), billsQ.refetch()]);
    setRefreshing(false);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: TAB_BAR_CLEARANCE }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <MenuGroup items={pages.map((p) => ({ key: p.route, label: p.label, sub: p.sub, icon: p.icon, tint: colors.primary, onPress: () => nav.navigate(p.route) }))} />
      <View style={{ height: 18 }} />

      {!overview ? null : <View style={{ marginBottom: 10 }}><Heading title="Maintenance Overview" /></View>}

      {!overview ? null : loading ? (
        <View style={{ paddingVertical: 60, alignItems: "center" }}>
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      ) : (
        <>
          <View style={{ gap: 10, marginBottom: 20 }}>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <StatCard label="Confirmed Customers" value={String(directoryRows.length)} icon={Users} color={colors.primary} />
              <StatCard label="Active Charge Heads" value={String(chargeHeadRows.length)} icon={ListChecks} color="#0ea5e9" />
            </View>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <StatCard label="Bills Issued" value={String(activeBills.length)} icon={Receipt} color="#f59e0b" />
              <StatCard label="Total Billed" value={formatINR(totalBilled)} icon={Wallet} color="#22c55e" />
            </View>
          </View>

          <View style={{ marginBottom: 10 }}><Heading title="Breakdown" /></View>

          <ChartCard title="Bill Status" icon={Receipt}>
            {billRows.length === 0 ? (
              <Text style={{ textAlign: "center", color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, paddingVertical: 24 }}>
                No data yet
              </Text>
            ) : (
              <DonutChart
                data={[
                  { name: "Active", value: activeBills.length, color: colors.primary },
                  { name: "Cancelled", value: cancelledBills.length, color: "#ef4444" },
                ]}
              />
            )}
          </ChartCard>

          <ChartCard title="Billed vs Unbilled Customers" icon={Users}>
            {directoryRows.length === 0 && billedCustomerCount === 0 ? (
              <Text style={{ textAlign: "center", color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, paddingVertical: 24 }}>
                No data yet
              </Text>
            ) : (
              <DonutChart
                data={[
                  { name: "Billed", value: billedCustomerCount, color: colors.primary },
                  { name: "Not Yet Billed", value: unbilledCustomerCount, color: "#94a3b8" },
                ]}
              />
            )}
          </ChartCard>

          <ChartCard title="Billing Amount — Last 14 Days" icon={TrendingUp}>
            <TrendLineChart data={trendData} color={colors.primary} />
          </ChartCard>
        </>
      )}

      {(directoryQ.error || chargeHeadsQ.error || billsQ.error) && (
        <Text style={{ color: colors.destructive, fontSize: 11, fontFamily: fonts.body.regular, marginTop: 4 }}>
          {(directoryQ.error as Error)?.message || (chargeHeadsQ.error as Error)?.message || (billsQ.error as Error)?.message}
        </Text>
      )}
    </ScrollView>
  );
}


// ── Key Custodian ────────────────────────────────────────────────────────────
// The web's Maintenance > Key Custodian (src/pages/maintenance/KeyCustodian.tsx, maintenanceKeyCustodian.js): every unit
// not yet handed over, who holds its keys, and the unit's confirmed booking. Tap a unit to record its custodian
// (the server's own list of custodian types; Owner fills in the buyer).
export function KeyCustodianScreen() {
  const qc = useQueryClient();
  const { canDoAction } = useAuth();
  const canEdit = canDoAction("maintenance-key-custodian", "edit");
  const listQ = useQuery({ queryKey: ["key-custodian-units"], queryFn: () => crmGet<Row[]>("/api/maintenance-key-custodian/units") });
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const rows = (listQ.data ?? []).filter((u) => {
    const t = search.trim().toLowerCase();
    return !t || [u.UnitName, u.BlockName, u.ProjectName, u.ApplicantName, u.BookingNo, u.CustodianName].some((x) => String(x ?? "").toLowerCase().includes(t));
  });
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, paddingBottom: 96 }}
      refreshControl={<RefreshControl refreshing={listQ.isRefetching} onRefresh={() => { listQ.refetch(); }} tintColor={colors.primary} />}>
      <TextInput value={search} onChangeText={setSearch} placeholder="Search unit, block, buyer, custodian…" placeholderTextColor={`${colors.mutedForeground}99`}
        style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 14, backgroundColor: colors.card, marginBottom: 12 }} />
      {listQ.isLoading ? <ActivityIndicator color={colors.mutedForeground} /> : listQ.error ? (
        <Text style={{ color: colors.destructive, fontSize: 12.5, fontFamily: fonts.body.regular }}>{(listQ.error as Error).message}</Text>
      ) : (
        <Section title={`Units not yet handed over (${rows.length})`}>
          {/* A phone lists the first 100; search narrows the rest. */}
          {rows.length > 100 ? <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginBottom: 6 }}>{`Showing the first 100 of ${rows.length}. Search to find any other unit.`}</Text> : null}
          {rows.slice(0, 100).map((u) => (
            <Pressable key={u.UnitId} onPress={() => setOpenId(u.UnitId)} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Text style={{ fontSize: 14, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{[u.ProjectName, u.BlockName, u.UnitName].filter(Boolean).join(" · ")}</Text>
              <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginTop: 2 }}>
                {[u.BookingNo ? `${u.BookingNo} · ${u.ApplicantName ?? ""}` : "Unsold", u.CustodianName ? `Keys: ${u.CustodianName} (${u.CustodianType})` : "No custodian recorded"].join("  ·  ")}
              </Text>
            </Pressable>
          ))}
        </Section>
      )}
      {openId != null ? <KeyCustodianSheet unitId={openId} canEdit={canEdit} onClose={() => setOpenId(null)}
        onSaved={() => { setOpenId(null); qc.invalidateQueries({ queryKey: ["key-custodian-units"] }); }} /> : null}
    </ScrollView>
  );
}

function KeyCustodianSheet({ unitId, canEdit, onClose, onSaved }: { unitId: number; canEdit: boolean; onClose: () => void; onSaved: () => void }) {
  const q = useQuery({ queryKey: ["key-custodian-unit", unitId], staleTime: 0, queryFn: () => crmGet<Row>(`/api/maintenance-key-custodian/units/${unitId}`) });
  const d = q.data;
  const bk = d?.booking;
  const [f, setF] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  if (d && !loaded) {
    const c = d.custodian ?? {};
    setLoaded(true);
    setF({ CustodianType: c.CustodianType ?? "", CustodianName: c.CustodianName ?? "", CustodianPhone: c.CustodianPhone ?? "", KeyCount: c.KeyCount != null ? String(c.KeyCount) : "",
      KeyTagNo: c.KeyTagNo ?? "", HandedOverOn: c.HandedOverOn ? String(c.HandedOverOn).slice(0, 10) : "", HandedOverBy: c.HandedOverBy ?? "", Remarks: c.Remarks ?? "" });
  }
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const editable = canEdit && !d?.handedOver;
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!f.CustodianType || !f.CustodianName?.trim()) return toast.error("Pick the custodian type and enter the name.");
    setSaving(true);
    try {
      await crmSend(`/api/maintenance-key-custodian/units/${unitId}`, "PUT", { ...f, KeyCount: f.KeyCount === "" ? null : Number(f.KeyCount), HandedOverOn: f.HandedOverOn || null });
      toast.success("Key custodian saved"); onSaved();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };
  const types: string[] = d?.custodianTypes ?? [];
  return (
    <ConfirmSheet visible title={d?.unit?.UnitName ?? "Unit"} tone="primary" confirmLabel={editable ? (saving ? "Saving…" : "Save") : "Close"}
      loading={saving || q.isLoading} onConfirm={editable ? save : onClose} onClose={onClose}>
      {d ? (
        <>
          <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginBottom: 8 }}>{[d.unit?.ProjectName, d.unit?.BlockName].filter(Boolean).join(" · ")}</Text>
          <Text style={{ fontSize: 13.5, fontFamily: fonts.heading.semibold, color: colors.foreground }}>Booking confirmation</Text>
          <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginBottom: 12 }}>
            {bk ? [bk.BookingNo, bk.ApplicantName, [bk.Mobile, bk.AltMobile].filter(Boolean).join(" / ")].filter(Boolean).join(" · ") : "This unit has no confirmed booking in CRM."}
          </Text>
          {d.handedOver ? <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: colors.foreground, marginBottom: 8 }}>This unit has been handed over — its keys are with the customer now.</Text> : null}
          <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: colors.mutedForeground, marginBottom: 6 }}>Custodian type *</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {types.map((t) => {
              const on = f.CustodianType === t;
              return (
                <Pressable key={t} disabled={!editable}
                  onPress={() => (t === "Owner" && bk ? setF((x) => ({ ...x, CustodianType: t, CustodianName: bk.ApplicantName ?? "", CustodianPhone: bk.Mobile ?? "" })) : set("CustodianType", t))}
                  style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? `${colors.primary}1f` : "transparent" }}>
                  <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: on ? colors.primary : colors.mutedForeground }}>{t}</Text>
                </Pressable>
              );
            })}
          </View>
          <TextField label="Custodian name" required value={f.CustodianName ?? ""} onChangeText={(v) => set("CustodianName", v)} disabled={!editable} />
          <TextField label="Phone" value={f.CustodianPhone ?? ""} onChangeText={(v) => set("CustodianPhone", v)} keyboardType="numeric" disabled={!editable} />
          <NumberField label="Number of keys" value={f.KeyCount ?? ""} onChangeText={(v) => set("KeyCount", v)} disabled={!editable} />
          <TextField label="Key tag no" value={f.KeyTagNo ?? ""} onChangeText={(v) => set("KeyTagNo", v)} disabled={!editable} />
          <DateField label="Handed over on" value={f.HandedOverOn ?? ""} onChange={(v: string) => set("HandedOverOn", v)} disabled={!editable} />
          <TextField label="Handed over by" value={f.HandedOverBy ?? ""} onChangeText={(v) => set("HandedOverBy", v)} disabled={!editable} />
          <RemarksField label="Remarks" value={f.Remarks ?? ""} onChangeText={(v) => set("Remarks", v)} disabled={!editable} />
        </>
      ) : null}
    </ConfirmSheet>
  );
}
