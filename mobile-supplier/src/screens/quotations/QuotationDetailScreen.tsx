// RN port of the "respond to an RFQ" flow from
// src/pages/supplier/SupplierQuotationDetail.tsx (web) — enter a rate (and
// optionally supply date / quality note) per item, then submit. Pre-fills
// from whatever's already on file so re-opening a Submitted quotation
// shows what was actually sent, editable in case it needs correcting
// before the due date.
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, AlertCircle, Building2, CalendarDays } from "lucide-react-native";
import * as spApi from "@/api/supplierPortalApi";
import { fonts } from "@/theme/fonts";
import type { MainStackParamList } from "@/navigation/MainStack";

type Props = NativeStackScreenProps<MainStackParamList, "QuotationDetail">;

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

interface RowState {
  rate: string;
  supplyDate: string;
  quality: string;
}

export default function QuotationDetailScreen({ route }: Props) {
  const { id } = route.params;
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Record<number, RowState>>({});
  const [submitting, setSubmitting] = useState(false);

  const detailQ = useQuery({
    queryKey: ["supplier-quotation-detail", id],
    queryFn: () => spApi.getSupplierQuotationDetail(id),
  });
  const detail = detailQ.data;

  useEffect(() => {
    if (!detail) return;
    const next: Record<number, RowState> = {};
    for (const it of detail.items) {
      next[it.QuotationItemId] = {
        rate: it.Rate != null ? String(it.Rate) : "",
        supplyDate: it.SupplyDate ? it.SupplyDate.slice(0, 10) : "",
        quality: it.Quality ?? "",
      };
    }
    setRows(next);
  }, [detail]);

  const setRow = (itemId: number, patch: Partial<RowState>) =>
    setRows((prev) => ({ ...prev, [itemId]: { ...prev[itemId], ...patch } }));

  const allRated = useMemo(
    () => !!detail && detail.items.every((it) => Number(rows[it.QuotationItemId]?.rate) > 0),
    [detail, rows],
  );

  const onSubmit = async () => {
    if (!detail || !allRated) {
      Alert.alert("Missing rates", "Enter a rate greater than 0 for every item before submitting.");
      return;
    }
    setSubmitting(true);
    try {
      await spApi.submitSupplierPrices(
        id,
        detail.items.map((it) => {
          const r = rows[it.QuotationItemId];
          return {
            QuotationItemId: it.QuotationItemId,
            Rate: Number(r.rate),
            SupplyDate: r.supplyDate || null,
            Quality: r.quality || null,
          };
        }),
      );
      Alert.alert("Submitted", "Your rates have been submitted.");
      queryClient.invalidateQueries({ queryKey: ["supplier-quotation-detail", id] });
      queryClient.invalidateQueries({ queryKey: ["supplier-quotations"] });
    } catch (err: any) {
      Alert.alert("Submit failed", err?.message ?? "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  if (detailQ.isLoading) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: "#0c0c12" }}>
        <ActivityIndicator color="#818898" />
      </View>
    );
  }
  if (!detail) {
    return (
      <View className="flex-1 items-center justify-center gap-2" style={{ backgroundColor: "#0c0c12" }}>
        <AlertCircle size={22} color="#818898" />
        <Text style={{ color: "#818898", fontFamily: fonts.body.regular, fontSize: 13 }}>Couldn't load this quotation.</Text>
      </View>
    );
  }

  const submitted = detail.MySubmissionStatus === "Submitted";

  return (
    <ScrollView className="flex-1" style={{ backgroundColor: "#0c0c12" }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <View style={{ borderRadius: 14, borderWidth: 1, borderColor: "#272735", backgroundColor: "#15151e", padding: 16, marginBottom: 16 }}>
        <View className="flex-row items-center flex-wrap gap-2 mb-1.5">
          <Text style={{ fontSize: 16, fontFamily: fonts.heading.bold, color: "#6ee7b7" }}>{detail.DocNo}</Text>
          {submitted ? (
            <Pill icon={CheckCircle2} label="Submitted" color="#6ee7b7" bg="rgba(16,185,129,0.10)" />
          ) : (
            <Pill icon={Clock} label="Pending" color="#f59e0b" bg="rgba(245,158,11,0.10)" />
          )}
        </View>
        <View className="flex-row flex-wrap gap-x-4 gap-y-1 mt-1">
          {detail.CompanyName && (
            <View className="flex-row items-center gap-1">
              <Building2 size={11} color="#818898" />
              <Text style={{ fontSize: 12, color: "#818898", fontFamily: fonts.body.regular }}>{detail.CompanyName}</Text>
            </View>
          )}
          {detail.DueDate && (
            <View className="flex-row items-center gap-1">
              <CalendarDays size={11} color="#818898" />
              <Text style={{ fontSize: 12, color: "#818898", fontFamily: fonts.body.regular }}>Due {fmtDate(detail.DueDate)}</Text>
            </View>
          )}
        </View>
        {detail.Remarks && (
          <Text style={{ fontSize: 12, color: "#818898", fontFamily: fonts.body.regular, marginTop: 8, fontStyle: "italic" }}>
            {detail.Remarks}
          </Text>
        )}
      </View>

      <Text style={{ fontSize: 11, fontFamily: fonts.heading.bold, color: "#818898", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 10 }}>
        Items ({detail.items.length})
      </Text>

      <View style={{ gap: 12 }}>
        {detail.items.map((it) => {
          const r = rows[it.QuotationItemId] ?? { rate: "", supplyDate: "", quality: "" };
          return (
            <View key={it.QuotationItemId} style={{ borderRadius: 12, borderWidth: 1, borderColor: "#272735", backgroundColor: "#15151e", padding: 14 }}>
              <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: "#e7e9ef" }}>{it.ItemName}</Text>
              <Text style={{ fontSize: 11, fontFamily: fonts.body.regular, color: "#818898", marginTop: 2 }}>
                {it.Quantity} {it.UOMName ?? it.UOMCode}
                {it.Remarks ? ` · ${it.Remarks}` : ""}
              </Text>

              <View style={{ marginTop: 10, gap: 8 }}>
                <FieldRow label="Rate (₹)">
                  <TextInput
                    value={r.rate}
                    onChangeText={(t) => setRow(it.QuotationItemId, { rate: t.replace(/[^0-9.]/g, "") })}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor="rgba(148,163,184,0.4)"
                    style={inputStyle}
                  />
                </FieldRow>
                <FieldRow label="Supply date">
                  <TextInput
                    value={r.supplyDate}
                    onChangeText={(t) => setRow(it.QuotationItemId, { supplyDate: t })}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="rgba(148,163,184,0.4)"
                    style={inputStyle}
                  />
                </FieldRow>
                <FieldRow label="Quality note">
                  <TextInput
                    value={r.quality}
                    onChangeText={(t) => setRow(it.QuotationItemId, { quality: t })}
                    placeholder="Optional"
                    placeholderTextColor="rgba(148,163,184,0.4)"
                    style={inputStyle}
                  />
                </FieldRow>
              </View>
            </View>
          );
        })}
      </View>

      <Pressable
        disabled={submitting || !allRated}
        onPress={onSubmit}
        style={{
          marginTop: 18,
          borderRadius: 12,
          paddingVertical: 14,
          alignItems: "center",
          backgroundColor: "#059669",
          opacity: submitting || !allRated ? 0.5 : 1,
        }}
      >
        <Text style={{ color: "#fff", fontSize: 14, fontFamily: fonts.body.semibold }}>
          {submitting ? "Submitting…" : submitted ? "Update rates" : "Submit rates"}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const inputStyle = {
  flex: 1,
  borderRadius: 8,
  borderWidth: 1,
  borderColor: "#272735",
  backgroundColor: "#0c0c12",
  color: "#e7e9ef",
  paddingHorizontal: 10,
  paddingVertical: 8,
  fontSize: 12,
  textAlign: "right" as const,
};

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="flex-row items-center justify-between gap-3">
      <Text style={{ fontSize: 11, fontFamily: fonts.body.medium, color: "#818898" }}>{label}</Text>
      {children}
    </View>
  );
}

function Pill({ icon: Icon, label, color, bg }: { icon: React.ComponentType<{ size?: number; color?: string }>; label: string; color: string; bg: string }) {
  return (
    <View className="flex-row items-center gap-1" style={{ backgroundColor: bg, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999 }}>
      <Icon size={10} color={color} />
      <Text style={{ fontSize: 10, fontFamily: fonts.heading.semibold, color }}>{label}</Text>
    </View>
  );
}
