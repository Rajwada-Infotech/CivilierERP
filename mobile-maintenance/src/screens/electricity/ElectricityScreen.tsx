// Electricity Maintenance — full parity with web's src/pages/maintenance/
// ElectricityMaintenance.tsx: Overview, Meters & Readings (record/correct
// readings, generate bills), Billing (verify/add-to-customer-bill/cancel),
// Reports, Audit Log. Provider/Tariff master CRUD stays out of scope, same
// as web (that's Meter Reading Master, a separate admin screen). Its own
// "Live Grid" amber identity — distinct from Security's cyan ops board and
// the app's own green ACCENT.
import { useMemo, useState } from "react";
import { View, Text, TextInput, Pressable, ActivityIndicator, ScrollView, RefreshControl, LayoutAnimation } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Zap, Gauge, Users, Clock3, Receipt, Wallet, Search, FileText,
  CheckCircle2, Ban, History as HistoryIcon, BarChart3, ShieldAlert,
} from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { toast } from "@/components/Toast";
import { Card, Line, Pill } from "@/components/list/DataList";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { TextField, NumberField, RemarksField } from "@/components/form/Form";
import { DateField } from "@/components/form/DateField";
import { PickerRow, OptionPickerModal, type PickerOption } from "@/components/OptionPicker";
import { RadialGauge } from "@/components/charts/RadialGauge";
import { SuccessBurst } from "@/components/SuccessBurst";
import { usePageRights } from "@/hooks/usePageRights";
import { formatINR } from "@/utils/formatCurrency";
import { getMaintenanceBills } from "@/api/maintenanceBillApi";
import {
  getMeters, getElectricityProviders, getNextReadingInfo, getMeterReadings,
  recordReading, correctReading, previewBill, generateBill, getElectricityBills,
  verifyBill, addBillToCustomerBill, cancelBill, getElectricityDashboard,
  getMonthlyReport, getProviderWiseReport, getCustomerWiseReport, getElectricityAuditLog,
  type MeterRow, type ElectricityBillRow, type BillPreview, type MeterReadingRow, type BillStatus,
  type AuditLogRow,
} from "@/api/electricityMaintenanceApi";

const ELEC_AMBER = "#f59e0b";
const ELEC_INK = "#1c1305";

const fmtDate = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString("en-IN") : "—");
const fmtDateTime = (d: string | null | undefined) => (d ? new Date(d).toLocaleString("en-IN") : "—");

const BILL_STATUS_TONE: Record<BillStatus, string> = {
  PendingVerification: "#f59e0b", Verified: "#38bdf8", AddedToCustomerBill: "#22c55e", Cancelled: "#f43f5e", Revised: "#8b5cf6",
};
const HANDOVER_TONE: Record<string, string | undefined> = {
  "Handover Completed": "#22c55e", "Handover Scheduled": "#f59e0b", "Not Handed Over": undefined,
};

const TABS = ["Overview", "Meters", "Bills", "Reports", "Audit"] as const;
type Tab = (typeof TABS)[number];

export default function ElectricityScreen() {
  const rights = usePageRights("maintenance-electricity");
  const [tab, setTab] = useState<Tab>("Meters");

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        {TABS.map((t) => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: tab === t ? ELEC_AMBER : colors.card, borderWidth: 1, borderColor: tab === t ? ELEC_AMBER : colors.border }}
          >
            <Text style={{ fontSize: 11.5, fontFamily: fonts.heading.semibold, color: tab === t ? "#1a1206" : colors.mutedForeground }}>{t}</Text>
          </Pressable>
        ))}
      </View>

      {tab === "Overview" && <OverviewTab />}
      {tab === "Meters" && <MetersTab rights={rights} />}
      {tab === "Bills" && <BillsTab rights={rights} />}
      {tab === "Reports" && <ReportsTab />}
      {tab === "Audit" && <AuditTab />}
    </View>
  );
}

// ─── Overview — "Live Grid" ──────────────────────────────────────────────
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
    queryKey: ["elec-dashboard"],
    queryFn: getElectricityDashboard,
    refetchInterval: 60_000,
  });

  const total = data?.totalMeters ?? 0;
  const pending = data?.readingPending ?? 0;
  const read = Math.max(0, total - pending);
  const readPct = total > 0 ? read / total : 0;

  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} tintColor={ELEC_AMBER} />}
    >
      <LinearGradient
        colors={[ELEC_INK, "#3a2308", "#1c1305"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: 20, padding: 18, marginBottom: 14, overflow: "hidden", borderWidth: 1, borderColor: `${ELEC_AMBER}30` }}
      >
        <View style={{ position: "absolute", right: -14, top: -10, opacity: 0.09 }}>
          <Zap size={110} color={ELEC_AMBER} />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: ELEC_AMBER }} />
          <Text style={{ color: ELEC_AMBER, fontSize: 9.5, fontFamily: fonts.heading.bold, letterSpacing: 2 }}>LIVE GRID</Text>
          <Text style={{ color: "rgba(254,243,199,0.5)", fontSize: 9.5, fontFamily: fonts.body.regular, letterSpacing: 0.4, marginLeft: 4 }}>
            ELECTRICITY MAINTENANCE
          </Text>
        </View>
        <Text style={{ color: "#fef3c7", fontSize: 34, fontFamily: fonts.heading.bold, letterSpacing: 0.3, fontVariant: ["tabular-nums"] }}>
          {formatINR(data?.currentAmount ?? 0)}
        </Text>
        <Text style={{ color: "rgba(254,243,199,0.65)", fontSize: 11, fontFamily: fonts.body.regular, marginTop: 4 }}>
          pending across bills awaiting settlement
        </Text>
      </LinearGradient>

      {isLoading ? (
        <ActivityIndicator color={colors.mutedForeground} style={{ marginTop: 30 }} />
      ) : (
        <>
          <View
            style={{
              flexDirection: "row", alignItems: "center", gap: 16,
              backgroundColor: colors.card, borderRadius: 20, borderWidth: 1, borderColor: `${ELEC_AMBER}30`,
              padding: 16, marginBottom: 10,
            }}
          >
            <RadialGauge progress={readPct} size={92} strokeWidth={10} color={ELEC_AMBER} centerValue={String(read)} centerLabel="read" />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: colors.foreground, fontSize: 15, fontFamily: fonts.heading.bold }}>This Cycle's Readings</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular, marginTop: 3, lineHeight: 15 }}>
                {read} of {total} meters have a reading recorded this billing period.
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 8 }}>
                <View style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.muted, overflow: "hidden" }}>
                  <View style={{ width: `${Math.round(readPct * 100)}%`, height: "100%", backgroundColor: ELEC_AMBER, borderRadius: 2 }} />
                </View>
                <Text style={{ color: ELEC_AMBER, fontSize: 10.5, fontFamily: fonts.heading.bold }}>{Math.round(readPct * 100)}%</Text>
              </View>
            </View>
          </View>

          <View style={{ flexDirection: "row", gap: 10, marginBottom: 10 }}>
            <BentoTile label="Reading Pending" value={pending} icon={Clock3} color="#f43f5e" flex={1.3} />
            <BentoTile label="Total Meters" value={total} icon={Gauge} color="#8b5cf6" />
          </View>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <BentoTile label="Bills Generated" value={data?.billsGenerated ?? 0} icon={Receipt} color="#38bdf8" />
          </View>
        </>
      )}
    </ScrollView>
  );
}

// ─── Meters & Readings ───────────────────────────────────────────────────
function MetersTab({ rights }: { rights: ReturnType<typeof usePageRights> }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [providerId, setProviderId] = useState<number | null>(null);
  const [status, setStatus] = useState("");
  const [providerPickerOpen, setProviderPickerOpen] = useState(false);
  const [statusPickerOpen, setStatusPickerOpen] = useState(false);

  const [readingFor, setReadingFor] = useState<MeterRow | null>(null);
  const [billingFor, setBillingFor] = useState<MeterRow | null>(null);
  const [historyFor, setHistoryFor] = useState<MeterRow | null>(null);
  const [auditFor, setAuditFor] = useState<MeterRow | null>(null);
  const [burstLabel, setBurstLabel] = useState<string | null>(null);

  const fireBurst = (label: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setBurstLabel(label);
    setTimeout(() => setBurstLabel(null), 950);
  };

  const { data: providers = [] } = useQuery({ queryKey: ["elec-providers"], queryFn: getElectricityProviders });
  const filters = useMemo(
    () => ({ search: search || undefined, providerId: providerId || undefined, status: status || undefined }),
    [search, providerId, status],
  );
  const { data, isLoading, error } = useQuery({ queryKey: ["elec-meters", filters], queryFn: () => getMeters(filters) });
  const rows = data ?? [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["elec-meters"] });
    qc.invalidateQueries({ queryKey: ["elec-dashboard"] });
  };

  const providerOptions: PickerOption[] = providers.map((p) => ({ key: String(p.Id), label: p.Name }));
  const statusOptions: PickerOption[] = ["Active", "Inactive", "Transferred", "Disconnected"].map((s) => ({ key: s, label: s }));

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, marginBottom: 8 }}>
          <Search size={13} color={colors.mutedForeground} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search customer, flat, meter…"
            placeholderTextColor={`${colors.mutedForeground}99`}
            style={{ flex: 1, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 12.5, paddingVertical: 10 }}
          />
        </View>
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 14 }}>
          <View style={{ flex: 1 }}>
            <PickerRow label="Provider" value={providerOptions.find((o) => o.key === String(providerId))?.label ?? ""} placeholder="All" onPress={() => setProviderPickerOpen(true)} />
          </View>
          <View style={{ flex: 1 }}>
            <PickerRow label="Status" value={status} placeholder="All" onPress={() => setStatusPickerOpen(true)} />
          </View>
        </View>

        {isLoading ? (
          <ActivityIndicator color={colors.mutedForeground} style={{ marginTop: 30 }} />
        ) : error ? (
          <Text style={{ color: colors.destructive, fontSize: 12, fontFamily: fonts.body.regular }}>{(error as Error).message}</Text>
        ) : rows.length === 0 ? (
          <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, textAlign: "center", paddingVertical: 30 }}>
            No meters match these filters.
          </Text>
        ) : (
          rows.map((m) => {
            const pending = m.Status === "Active" && m.LatestBillStatus === null && !m.LatestUnitsConsumed;
            return (
              <Card key={m.Id}>
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                  <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: pending ? "rgba(245,158,11,0.14)" : "rgba(56,189,248,0.12)", alignItems: "center", justifyContent: "center" }}>
                    <Zap size={14} color={pending ? ELEC_AMBER : "#7dd3fc"} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.semibold }}>{m.MeterNumber}</Text>
                      <Pill label={m.Status} tone={m.Status === "Active" ? "#10b981" : undefined} />
                      {pending && <Pill label="Reading Due" tone={ELEC_AMBER} />}
                    </View>
                    <Line>{m.CustomerName}{m.UnitNo ? ` · ${m.UnitNo}` : ""}</Line>
                    <Line>{m.ProviderName} · {m.BillingCycle}{m.LatestCurrentReading != null ? ` · last ${m.LatestCurrentReading}` : ""}</Line>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
                      <Pill label={m.HandoverStatus} tone={HANDOVER_TONE[m.HandoverStatus]} />
                      {m.LatestBillStatus && <Pill label={m.LatestBillStatus} tone={BILL_STATUS_TONE[m.LatestBillStatus]} />}
                    </View>
                  </View>
                </View>

                <View style={{ flexDirection: "row", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                  {rights.canCreate && m.Status === "Active" && (
                    <Pressable
                      onPress={() => setReadingFor(m)}
                      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 9, backgroundColor: "rgba(245,158,11,0.16)", borderWidth: 1, borderColor: "rgba(245,158,11,0.35)", transform: [{ scale: pressed ? 0.95 : 1 }] })}
                    >
                      <Gauge size={12} color={ELEC_AMBER} />
                      <Text style={{ color: ELEC_AMBER, fontSize: 10.5, fontFamily: fonts.heading.semibold }}>Reading</Text>
                    </Pressable>
                  )}
                  {rights.canCreate && m.Status === "Active" && (
                    <Pressable onPress={() => setBillingFor(m)} style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 9, borderWidth: 1, borderColor: colors.border }}>
                      <FileText size={12} color={colors.foreground} />
                      <Text style={{ color: colors.foreground, fontSize: 10.5, fontFamily: fonts.heading.semibold }}>Bill</Text>
                    </Pressable>
                  )}
                  <Pressable onPress={() => setHistoryFor(m)} style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 9, borderWidth: 1, borderColor: colors.border }}>
                    <HistoryIcon size={12} color={colors.mutedForeground} />
                    <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.heading.semibold }}>History</Text>
                  </Pressable>
                  <Pressable onPress={() => setAuditFor(m)} style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 9, borderWidth: 1, borderColor: colors.border }}>
                    <ShieldAlert size={12} color={colors.mutedForeground} />
                    <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.heading.semibold }}>Audit</Text>
                  </Pressable>
                </View>
              </Card>
            );
          })
        )}
      </ScrollView>

      <OptionPickerModal visible={providerPickerOpen} title="Select Provider" options={providerOptions} selectedKey={providerId ? String(providerId) : null} clearable onSelect={(key) => { setProviderId(key ? Number(key) : null); setProviderPickerOpen(false); }} onClose={() => setProviderPickerOpen(false)} />
      <OptionPickerModal visible={statusPickerOpen} title="Select Status" options={statusOptions} selectedKey={status || null} clearable onSelect={(key) => { setStatus(key); setStatusPickerOpen(false); }} onClose={() => setStatusPickerOpen(false)} />

      {readingFor && (
        <AddReadingSheet
          meter={readingFor}
          onClose={() => setReadingFor(null)}
          onDone={(msg) => { setReadingFor(null); invalidate(); fireBurst(msg); }}
        />
      )}
      {billingFor && (
        <GenerateBillSheet
          meter={billingFor}
          onClose={() => setBillingFor(null)}
          onDone={(msg) => { setBillingFor(null); qc.invalidateQueries({ queryKey: ["elec-bills"] }); invalidate(); fireBurst(msg); }}
        />
      )}
      {historyFor && <MeterHistorySheet meter={historyFor} onClose={() => setHistoryFor(null)} />}
      {auditFor && <AuditLogSheet title={`Audit Log — ${auditFor.MeterNumber}`} filters={{ meterId: auditFor.Id }} onClose={() => setAuditFor(null)} />}

      <SuccessBurst visible={!!burstLabel} label={burstLabel ?? ""} color={ELEC_AMBER} ink={ELEC_INK} />
    </View>
  );
}

function AddReadingSheet({ meter, onClose, onDone }: { meter: MeterRow; onClose: () => void; onDone: (msg: string) => void }) {
  const { data: info, isLoading } = useQuery({ queryKey: ["elec-next-reading", meter.Id], queryFn: () => getNextReadingInfo(meter.Id) });
  const [currentReading, setCurrentReading] = useState("");
  const [readingType, setReadingType] = useState<"Regular" | "Handover">("Regular");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    const val = Number(currentReading);
    if (!currentReading || Number.isNaN(val)) { toast.error("Enter a valid reading."); return; }
    if (info && val < info.previousReading) { toast.error(`Current reading can't be less than the previous reading (${info.previousReading}).`); return; }
    setSaving(true);
    try {
      const res = await recordReading(meter.Id, { currentReading: val, readingDate: new Date().toISOString().slice(0, 10), readingType });
      onDone(`${meter.MeterNumber} — ${res.unitsConsumed} units recorded`);
    } catch (err) {
      toast.error((err as Error).message || "Failed to record reading.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ConfirmSheet
      visible
      title={`Add Reading — ${meter.MeterNumber}`}
      message={isLoading ? "Loading previous reading…" : info ? `Previous reading: ${info.previousReading} · period ${fmtDate(info.periodFrom)} → ${fmtDate(info.periodTo)}` : undefined}
      tone="primary"
      confirmLabel={saving ? "Saving…" : "Save Reading"}
      loading={saving || isLoading}
      onConfirm={handleSubmit}
      onClose={onClose}
    >
      {info?.handoverStatus === "Handover Completed" && (
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 14 }}>
          {(["Regular", "Handover"] as const).map((t) => (
            <Pressable
              key={t}
              onPress={() => setReadingType(t)}
              style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", borderWidth: 1, borderColor: readingType === t ? ELEC_AMBER : colors.border, backgroundColor: readingType === t ? `${ELEC_AMBER}1a` : "transparent" }}
            >
              <Text style={{ color: readingType === t ? ELEC_AMBER : colors.mutedForeground, fontSize: 11.5, fontFamily: fonts.heading.semibold }}>{t}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <NumberField label="Current Reading" value={currentReading} onChangeText={setCurrentReading} placeholder="Enter meter reading" required />
    </ConfirmSheet>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular }}>{label}</Text>
      <Text style={{ color: colors.foreground, fontSize: 11.5, fontFamily: fonts.body.medium }}>{value}</Text>
    </View>
  );
}

function GenerateBillSheet({ meter, onClose, onDone }: { meter: MeterRow; onClose: () => void; onDone: (msg: string) => void }) {
  const today = new Date();
  const defaultFrom = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const defaultTo = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);
  const [periodFrom, setPeriodFrom] = useState(defaultFrom);
  const [periodTo, setPeriodTo] = useState(defaultTo);
  const [preview, setPreview] = useState<BillPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [generating, setGenerating] = useState(false);

  const loadPreview = async () => {
    setLoadingPreview(true);
    setPreviewError(null);
    setPreview(null);
    try {
      setPreview(await previewBill(meter.Id, periodFrom, periodTo));
    } catch (err) {
      setPreviewError((err as Error).message || "Failed to preview bill.");
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await generateBill({ meterId: meter.Id, periodFrom, periodTo });
      onDone(`Bill generated — ${formatINR(preview?.totalAmount ?? 0)}`);
    } catch (err) {
      toast.error((err as Error).message || "Failed to generate bill.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <ConfirmSheet
      visible
      title={`Generate Bill — ${meter.MeterNumber}`}
      tone="primary"
      confirmLabel={preview ? (generating ? "Generating…" : "Generate Bill") : (loadingPreview ? "Loading…" : "Preview")}
      loading={generating || loadingPreview}
      onConfirm={preview ? handleGenerate : loadPreview}
      onClose={onClose}
    >
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}><DateField label="Period From" value={periodFrom} onChange={(v) => { setPeriodFrom(v); setPreview(null); }} /></View>
        <View style={{ flex: 1 }}><DateField label="Period To" value={periodTo} onChange={(v) => { setPeriodTo(v); setPreview(null); }} /></View>
      </View>

      {previewError && (
        <View style={{ borderWidth: 1, borderColor: "rgba(245,158,11,0.35)", backgroundColor: "rgba(245,158,11,0.08)", borderRadius: 10, padding: 10, marginBottom: 12 }}>
          <Text style={{ color: ELEC_AMBER, fontSize: 11.5, fontFamily: fonts.body.regular }}>{previewError}</Text>
        </View>
      )}

      {preview && (
        <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, marginBottom: 8 }}>
          <PreviewRow label="Previous Reading" value={String(preview.previousReading)} />
          <PreviewRow label="Current Reading" value={String(preview.currentReading)} />
          <PreviewRow label="Consumption" value={`${preview.totalUnits} Units`} />
          {preview.handoverDate && (
            <>
              <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 6 }} />
              <PreviewRow label="Handover Date" value={fmtDate(preview.handoverDate)} />
              <PreviewRow label="Rajwada Consumption" value={`${preview.rajwadaUnits} Units`} />
              <PreviewRow label="Post-Handover" value={`${preview.postHandoverUnits} Units`} />
            </>
          )}
          <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 6 }} />
          <PreviewRow label="Energy Charge" value={formatINR(preview.energyCharge)} />
          <PreviewRow label="Fixed Charge" value={formatINR(preview.fixedCharge)} />
          <PreviewRow label="Other Charge" value={formatINR(preview.otherCharge)} />
          <View style={{ flexDirection: "row", justifyContent: "space-between", paddingTop: 6, marginTop: 4, borderTopWidth: 1, borderTopColor: colors.border }}>
            <Text style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.heading.bold }}>Electricity Amount</Text>
            <Text style={{ color: colors.foreground, fontSize: 13.5, fontFamily: fonts.heading.bold }}>{formatINR(preview.totalAmount)}</Text>
          </View>
        </View>
      )}
    </ConfirmSheet>
  );
}

function MeterHistorySheet({ meter, onClose }: { meter: MeterRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [correcting, setCorrecting] = useState<MeterReadingRow | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ["elec-meter-readings", meter.Id], queryFn: () => getMeterReadings(meter.Id) });
  const rows = data ?? [];

  return (
    <>
      <ConfirmSheet visible title={`History — ${meter.MeterNumber}`} confirmLabel="Close" tone="primary" onConfirm={onClose} onClose={onClose}>
        {isLoading ? (
          <ActivityIndicator color={colors.mutedForeground} />
        ) : rows.length === 0 ? (
          <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular }}>No readings recorded yet.</Text>
        ) : (
          <View style={{ gap: 8 }}>
            {rows.map((r) => (
              <View key={r.Id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10, opacity: r.IsSuperseded ? 0.5 : 1 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.heading.semibold }}>{fmtDate(r.ReadingDate)} · {r.ReadingType}</Text>
                  {!r.IsSuperseded && (
                    <Pressable onPress={() => setCorrecting(r)} hitSlop={6}>
                      <Text style={{ color: ELEC_AMBER, fontSize: 10.5, fontFamily: fonts.heading.semibold }}>Correct</Text>
                    </Pressable>
                  )}
                </View>
                <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular, marginTop: 3 }}>
                  {r.PreviousReading} → {r.CurrentReading} · {r.UnitsConsumed} units{r.IsSuperseded ? " · Superseded" : ""}
                </Text>
              </View>
            ))}
          </View>
        )}
      </ConfirmSheet>
      {correcting && (
        <CorrectReadingSheet
          reading={correcting}
          onClose={() => setCorrecting(null)}
          onDone={() => { setCorrecting(null); qc.invalidateQueries({ queryKey: ["elec-meter-readings", meter.Id] }); toast.success("Reading corrected."); }}
        />
      )}
    </>
  );
}

function CorrectReadingSheet({ reading, onClose, onDone }: { reading: MeterReadingRow; onClose: () => void; onDone: () => void }) {
  const [correctedCurrentReading, setCorrectedCurrentReading] = useState(String(reading.CurrentReading));
  const [reason, setReason] = useState("");
  const [approvedBy, setApprovedBy] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!reason.trim() || !approvedBy.trim()) { toast.error("Reason and Approved By are required."); return; }
    setSaving(true);
    try {
      await correctReading(reading.Id, { correctedCurrentReading: Number(correctedCurrentReading), reason: reason.trim(), approvedBy: approvedBy.trim() });
      onDone();
    } catch (err) {
      toast.error((err as Error).message || "Failed to correct reading.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ConfirmSheet
      visible
      title="Correct Reading"
      message={`Original current reading: ${reading.CurrentReading}. The original is kept in history, never deleted.`}
      tone="danger"
      confirmLabel={saving ? "Saving…" : "Save Correction"}
      loading={saving}
      onConfirm={handleSubmit}
      onClose={onClose}
    >
      <NumberField label="Corrected Current Reading" value={correctedCurrentReading} onChangeText={setCorrectedCurrentReading} required />
      <RemarksField label="Reason" value={reason} onChangeText={setReason} required />
      <TextField label="Approved By" value={approvedBy} onChangeText={setApprovedBy} required />
    </ConfirmSheet>
  );
}

// ─── Billing ─────────────────────────────────────────────────────────────
function BillsTab({ rights }: { rights: ReturnType<typeof usePageRights> }) {
  const qc = useQueryClient();
  const [billStatus, setBillStatus] = useState("");
  const [statusPickerOpen, setStatusPickerOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);
  const [addingTo, setAddingTo] = useState<ElectricityBillRow | null>(null);
  const [cancelling, setCancelling] = useState<ElectricityBillRow | null>(null);
  const [auditFor, setAuditFor] = useState<ElectricityBillRow | null>(null);
  const [burstLabel, setBurstLabel] = useState<string | null>(null);

  const filters = useMemo(() => ({ billStatus: billStatus || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined }), [billStatus, dateFrom, dateTo]);
  const { data, isLoading, error } = useQuery({ queryKey: ["elec-bills", filters], queryFn: () => getElectricityBills(filters) });
  const rows = data ?? [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["elec-bills"] });
    qc.invalidateQueries({ queryKey: ["elec-dashboard"] });
  };
  const fireBurst = (label: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setBurstLabel(label);
    setTimeout(() => setBurstLabel(null), 950);
  };

  const handleVerify = async (bill: ElectricityBillRow) => {
    try {
      await verifyBill(bill.Id);
      invalidate();
      fireBurst(`Bill for ${bill.CustomerName} verified`);
    } catch (err) {
      toast.error((err as Error).message || "Failed to verify bill.");
    }
  };

  const statusOptions: PickerOption[] = ["PendingVerification", "Verified", "AddedToCustomerBill", "Cancelled", "Revised"].map((s) => ({ key: s, label: s }));

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <View style={{ marginBottom: 14, gap: 8 }}>
          <PickerRow label="Status" value={billStatus} placeholder="All Status" onPress={() => setStatusPickerOpen(true)} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}><DateField label="From" value={dateFrom} onChange={setDateFrom} /></View>
            <View style={{ flex: 1 }}><DateField label="To" value={dateTo} onChange={setDateTo} /></View>
          </View>
        </View>

        {isLoading ? (
          <ActivityIndicator color={colors.mutedForeground} style={{ marginTop: 30 }} />
        ) : error ? (
          <Text style={{ color: colors.destructive, fontSize: 12, fontFamily: fonts.body.regular }}>{(error as Error).message}</Text>
        ) : rows.length === 0 ? (
          <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, textAlign: "center", paddingVertical: 30 }}>
            No electricity bills match these filters.
          </Text>
        ) : (
          rows.map((b) => (
            <Card key={b.Id}>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.semibold }}>{b.CustomerName}</Text>
                    <Pill label={b.BillStatus} tone={BILL_STATUS_TONE[b.BillStatus]} />
                  </View>
                  <Line>{[b.BlockName, b.UnitNo].filter(Boolean).join(" / ") || "—"}</Line>
                  <Line>{fmtDate(b.BillingPeriodFrom)} – {fmtDate(b.BillingPeriodTo)} · {b.RajwadaUnits} units</Line>
                </View>
                <Text style={{ color: colors.foreground, fontSize: 13.5, fontFamily: fonts.heading.bold }}>{formatINR(b.TotalAmount)}</Text>
              </View>

              <View style={{ flexDirection: "row", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                {rights.canEdit && b.BillStatus === "PendingVerification" && (
                  <Pressable onPress={() => handleVerify(b)} style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 9, borderWidth: 1, borderColor: colors.border }}>
                    <CheckCircle2 size={12} color="#10b981" />
                    <Text style={{ color: colors.foreground, fontSize: 10.5, fontFamily: fonts.heading.semibold }}>Verify</Text>
                  </Pressable>
                )}
                {rights.canEdit && b.BillStatus === "Verified" && (
                  <Pressable onPress={() => setAddingTo(b)} style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 9, backgroundColor: "rgba(245,158,11,0.16)", borderWidth: 1, borderColor: "rgba(245,158,11,0.35)" }}>
                    <Text style={{ color: ELEC_AMBER, fontSize: 10.5, fontFamily: fonts.heading.semibold }}>Add to Bill</Text>
                  </Pressable>
                )}
                {rights.canDelete && (b.BillStatus === "PendingVerification" || b.BillStatus === "Verified") && (
                  <Pressable onPress={() => setCancelling(b)} style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 9, borderWidth: 1, borderColor: "rgba(220,40,40,0.35)" }}>
                    <Ban size={12} color={colors.destructive} />
                    <Text style={{ color: colors.destructive, fontSize: 10.5, fontFamily: fonts.heading.semibold }}>Cancel</Text>
                  </Pressable>
                )}
                <Pressable onPress={() => setAuditFor(b)} style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 9, borderWidth: 1, borderColor: colors.border }}>
                  <ShieldAlert size={12} color={colors.mutedForeground} />
                  <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.heading.semibold }}>Audit</Text>
                </Pressable>
              </View>
            </Card>
          ))
        )}
      </ScrollView>

      <OptionPickerModal visible={statusPickerOpen} title="Select Status" options={statusOptions} selectedKey={billStatus || null} clearable onSelect={(key) => { setBillStatus(key); setStatusPickerOpen(false); }} onClose={() => setStatusPickerOpen(false)} />

      {addingTo && (
        <AddToCustomerBillSheet
          bill={addingTo}
          onClose={() => setAddingTo(null)}
          onDone={() => { setAddingTo(null); invalidate(); fireBurst("Added to customer's bill"); }}
        />
      )}
      {cancelling && (
        <CancelBillSheet
          bill={cancelling}
          onClose={() => setCancelling(null)}
          onDone={() => { setCancelling(null); invalidate(); }}
        />
      )}
      {auditFor && <AuditLogSheet title={`Audit Log — Bill #${auditFor.Id}`} filters={{ billId: auditFor.Id }} onClose={() => setAuditFor(null)} />}

      <SuccessBurst visible={!!burstLabel} label={burstLabel ?? ""} color={ELEC_AMBER} ink={ELEC_INK} />
    </View>
  );
}

function CancelBillSheet({ bill, onClose, onDone }: { bill: ElectricityBillRow; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!reason.trim()) { toast.error("A reason is required."); return; }
    setSaving(true);
    try {
      await cancelBill(bill.Id, reason.trim());
      toast.success("Bill cancelled.");
      onDone();
    } catch (err) {
      toast.error((err as Error).message || "Failed to cancel bill.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ConfirmSheet
      visible
      title="Cancel Electricity Bill"
      tone="danger"
      confirmLabel={saving ? "Cancelling…" : "Cancel Bill"}
      loading={saving}
      onConfirm={submit}
      onClose={onClose}
    >
      <RemarksField label="Reason" value={reason} onChangeText={setReason} required />
    </ConfirmSheet>
  );
}

function AddToCustomerBillSheet({ bill, onClose, onDone }: { bill: ElectricityBillRow; onClose: () => void; onDone: () => void }) {
  const [maintenanceBillId, setMaintenanceBillId] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const { data = [], isLoading } = useQuery({
    queryKey: ["maint-bills-for-elec", bill.BookingId],
    queryFn: () => getMaintenanceBills({ bookingId: bill.BookingId, status: "Active" }),
  });

  const options: PickerOption[] = data.map((mb) => ({ key: String(mb.Id), label: `${mb.BillNo} — ${formatINR(mb.GrandTotal)}` }));

  const handleSubmit = async () => {
    if (!maintenanceBillId) { toast.error("Select the customer's maintenance bill."); return; }
    setSaving(true);
    try {
      await addBillToCustomerBill(bill.Id, maintenanceBillId);
      onDone();
    } catch (err) {
      toast.error((err as Error).message || "Failed to add to customer bill.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <ConfirmSheet
        visible
        title="Add to Customer's Bill"
        message={`Electricity Amount: ${formatINR(bill.TotalAmount)}`}
        tone="primary"
        confirmLabel={saving ? "Saving…" : "Add to Bill"}
        loading={saving}
        onConfirm={handleSubmit}
        onClose={onClose}
      >
        {isLoading ? (
          <ActivityIndicator color={colors.mutedForeground} />
        ) : options.length === 0 ? (
          <Text style={{ color: colors.mutedForeground, fontSize: 11.5, fontFamily: fonts.body.regular }}>
            No Active maintenance bill exists for this customer yet — create one first from Bills.
          </Text>
        ) : (
          <PickerRow
            label="Maintenance Bill"
            value={options.find((o) => o.key === String(maintenanceBillId))?.label ?? ""}
            required
            onPress={() => setPickerOpen(true)}
          />
        )}
      </ConfirmSheet>
      <OptionPickerModal visible={pickerOpen} title="Select Maintenance Bill" options={options} selectedKey={maintenanceBillId ? String(maintenanceBillId) : null} onSelect={(key) => { setMaintenanceBillId(key ? Number(key) : null); setPickerOpen(false); }} onClose={() => setPickerOpen(false)} />
    </>
  );
}

// ─── Reports ─────────────────────────────────────────────────────────────
function ReportsTab() {
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);
  const { data: monthly, isLoading: monthlyLoading } = useQuery({ queryKey: ["elec-report-monthly", dateFrom, dateTo], queryFn: () => getMonthlyReport(dateFrom ?? undefined, dateTo ?? undefined) });
  const { data: providerWise = [], isLoading: providerLoading } = useQuery({ queryKey: ["elec-report-provider", dateFrom, dateTo], queryFn: () => getProviderWiseReport(dateFrom ?? undefined, dateTo ?? undefined) });
  const { data: customerWise = [], isLoading: customerLoading } = useQuery({ queryKey: ["elec-report-customer", dateFrom, dateTo], queryFn: () => getCustomerWiseReport(dateFrom ?? undefined, dateTo ?? undefined) });

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 18 }}>
        <View style={{ flex: 1 }}><DateField label="From" value={dateFrom} onChange={setDateFrom} /></View>
        <View style={{ flex: 1 }}><DateField label="To" value={dateTo} onChange={setDateTo} /></View>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 }}>
        <BarChart3 size={13} color={ELEC_AMBER} />
        <Text style={{ color: colors.foreground, fontSize: 11.5, fontFamily: fonts.heading.semibold, textTransform: "uppercase", letterSpacing: 0.4 }}>Summary</Text>
      </View>
      {monthlyLoading ? (
        <ActivityIndicator color={colors.mutedForeground} style={{ marginBottom: 20 }} />
      ) : (
        <View style={{ marginBottom: 20, gap: 10 }}>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <BentoTile label="Total Meters" value={monthly?.totalMeters ?? 0} icon={Gauge} color={ELEC_AMBER} />
            <BentoTile label="Readings Done" value={monthly?.readingsCompleted ?? 0} icon={CheckCircle2} color="#38bdf8" />
          </View>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <BentoTile label="Units Consumed" value={monthly?.totalUnitsConsumed ?? 0} icon={Zap} color="#f43f5e" />
            <BentoTile label="Rajwada Units" value={monthly?.rajwadaSupplyUnits ?? 0} icon={Users} color="#8b5cf6" />
          </View>
          <BentoTile label="Total Electricity" value={formatINR(monthly?.totalElectricityAmount ?? 0)} icon={Wallet} color="#22c55e" />
        </View>
      )}

      <Text style={{ color: colors.foreground, fontSize: 11.5, fontFamily: fonts.heading.semibold, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 10 }}>Provider-wise</Text>
      {providerLoading ? (
        <ActivityIndicator color={colors.mutedForeground} style={{ marginBottom: 20 }} />
      ) : providerWise.length === 0 ? (
        <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, marginBottom: 20 }}>No billed data in this range.</Text>
      ) : (
        <View style={{ marginBottom: 20 }}>
          {providerWise.map((p) => (
            <Card key={p.ProviderName}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <View>
                  <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.semibold }}>{p.ProviderName}</Text>
                  <Line>{p.MeterCount} meters · {p.TotalUnits} units</Line>
                </View>
                <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.bold }}>{formatINR(p.TotalAmount)}</Text>
              </View>
            </Card>
          ))}
        </View>
      )}

      <Text style={{ color: colors.foreground, fontSize: 11.5, fontFamily: fonts.heading.semibold, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 10 }}>Customer-wise</Text>
      {customerLoading ? (
        <ActivityIndicator color={colors.mutedForeground} />
      ) : customerWise.length === 0 ? (
        <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular }}>No billed data in this range.</Text>
      ) : (
        customerWise.map((b) => (
          <Card key={b.Id}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.semibold }}>{b.CustomerName}</Text>
                <Line>{[b.BlockName, b.UnitNo].filter(Boolean).join(" / ") || "—"} · {b.MeterNumber}</Line>
                <Line>{fmtDate(b.BillingPeriodFrom)} – {fmtDate(b.BillingPeriodTo)} · {b.TotalUnits} units</Line>
              </View>
              <View style={{ alignItems: "flex-end", gap: 4 }}>
                <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.bold }}>{formatINR(b.TotalAmount)}</Text>
                <Pill label={b.BillStatus} tone={BILL_STATUS_TONE[b.BillStatus]} />
              </View>
            </View>
          </Card>
        ))
      )}
    </ScrollView>
  );
}

// ─── Audit Log ───────────────────────────────────────────────────────────
function AuditLogList({ rows }: { rows: AuditLogRow[] }) {
  if (rows.length === 0) {
    return <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, textAlign: "center", paddingVertical: 30 }}>No audit entries yet.</Text>;
  }
  return (
    <View style={{ gap: 8 }}>
      {rows.map((l) => (
        <View key={l.Id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.heading.semibold }}>{l.Action}</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.regular }}>{fmtDateTime(l.PerformedAt)}</Text>
          </View>
          <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.body.regular, marginTop: 3 }}>
            By: {l.PerformedBy || "—"}{l.Remarks ? ` — ${l.Remarks}` : ""}
          </Text>
        </View>
      ))}
    </View>
  );
}

function AuditTab() {
  const { data = [], isLoading } = useQuery({ queryKey: ["elec-audit-log"], queryFn: () => getElectricityAuditLog() });
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      {isLoading ? <ActivityIndicator color={colors.mutedForeground} style={{ marginTop: 30 }} /> : <AuditLogList rows={data} />}
    </ScrollView>
  );
}

function AuditLogSheet({ title, filters, onClose }: { title: string; filters: { meterId?: number; billId?: number }; onClose: () => void }) {
  const { data = [], isLoading } = useQuery({ queryKey: ["elec-audit-log", filters], queryFn: () => getElectricityAuditLog(filters) });
  return (
    <ConfirmSheet visible title={title} confirmLabel="Close" tone="primary" onConfirm={onClose} onClose={onClose}>
      {isLoading ? <ActivityIndicator color={colors.mutedForeground} /> : <AuditLogList rows={data} />}
    </ConfirmSheet>
  );
}
