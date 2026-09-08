// Electricity Maintenance — meters list with "record a reading" as the
// on-site headline action (see electricityMaintenanceApi.ts's own comment:
// this is the one screen here that gets full mutation depth).
import { useState } from "react";
import { View, Text, Pressable } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Zap, Gauge } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { toast } from "@/components/Toast";
import { DataList, Card, Line, Pill } from "@/components/list/DataList";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { NumberField } from "@/components/form/Form";
import { getMeters, getNextReadingInfo, recordReading, type MeterRow } from "@/api/electricityMaintenanceApi";

export default function ElectricityScreen() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["elec-meters"], queryFn: () => getMeters() });

  const [target, setTarget] = useState<MeterRow | null>(null);
  const [previousReading, setPreviousReading] = useState<number | null>(null);
  const [currentReading, setCurrentReading] = useState("");
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const openRecord = async (m: MeterRow) => {
    setTarget(m);
    setCurrentReading("");
    setLoadingInfo(true);
    try {
      const info = await getNextReadingInfo(m.Id);
      setPreviousReading(info.previousReading);
    } catch (err) {
      toast.error((err as Error).message || "Could not load reading info.");
      setPreviousReading(null);
    } finally {
      setLoadingInfo(false);
    }
  };

  const submit = async () => {
    if (!target) return;
    const val = Number(currentReading);
    if (!currentReading || Number.isNaN(val)) {
      toast.error("Enter a valid reading.");
      return;
    }
    if (previousReading != null && val < previousReading) {
      toast.error(`Current reading can't be less than the previous reading (${previousReading}).`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await recordReading(target.Id, { currentReading: val, readingDate: new Date().toISOString().slice(0, 10) });
      toast.success(`Reading recorded — ${res.unitsConsumed} units consumed.`);
      setTarget(null);
      qc.invalidateQueries({ queryKey: ["elec-meters"] });
    } catch (err) {
      toast.error((err as Error).message || "Failed to record reading.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <DataList<MeterRow>
        query={query}
        keyOf={(m) => String(m.Id)}
        emptyText="No meters on file yet."
        renderCard={(m) => {
          const pending = m.Status === "Active" && m.LatestBillStatus === null && !m.LatestUnitsConsumed;
          return (
            <Card>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: pending ? "rgba(245,158,11,0.14)" : "rgba(101,163,13,0.14)", alignItems: "center", justifyContent: "center" }}>
                  <Zap size={14} color={pending ? "#fbbf24" : "#bef264"} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.semibold }}>{m.MeterNumber}</Text>
                    <Pill label={m.Status} />
                    {pending && <Pill label="Reading Due" tone="#fbbf24" />}
                  </View>
                  <Line>{m.CustomerName ?? "—"}{m.UnitNo ? ` · ${m.UnitNo}` : ""}</Line>
                  <Line>{m.ProviderName} · {m.BillingCycle}{m.LatestCurrentReading != null ? ` · last ${m.LatestCurrentReading}` : ""}</Line>
                </View>
                {pending && m.Status === "Active" && (
                  <Pressable
                    onPress={() => openRecord(m)}
                    style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 11, paddingVertical: 8, borderRadius: 10, backgroundColor: "rgba(245,158,11,0.16)", borderWidth: 1, borderColor: "rgba(245,158,11,0.35)" }}
                  >
                    <Gauge size={12} color="#fbbf24" />
                    <Text style={{ color: "#fbbf24", fontSize: 11, fontFamily: fonts.heading.semibold }}>Record</Text>
                  </Pressable>
                )}
              </View>
            </Card>
          );
        }}
      />

      <ConfirmSheet
        visible={!!target}
        title={`Record reading — ${target?.MeterNumber ?? ""}`}
        message={loadingInfo ? "Loading previous reading…" : previousReading != null ? `Previous reading: ${previousReading}` : undefined}
        tone="primary"
        confirmLabel={submitting ? "Saving…" : "Save Reading"}
        loading={submitting || loadingInfo}
        onConfirm={submit}
        onClose={() => setTarget(null)}
      >
        <NumberField
          label="Current Reading"
          value={currentReading}
          onChangeText={setCurrentReading}
          placeholder="Enter meter reading"
          required
        />
      </ConfirmSheet>
    </>
  );
}
