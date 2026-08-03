// RN port of src/pages/material/L1Chart.tsx. Web renders a spreadsheet-
// style grid (items × suppliers, sticky column, horizontal scroll) — that
// doesn't translate to RN, so this is a per-supplier card list instead:
// each card shows the supplier's grand total (trophy if lowest) and
// expands to a per-item rate breakdown with an L1 badge on the cheapest
// cell for that item. Same underlying data and ranking math as web
// (l1BySupplierId / supplierTotals / cheapestSupplierId), just a different
// layout. Award flow: pick a submitted supplier (defaults to the cheapest),
// "Create Purchase Order" fetches that supplier's PO prefill and hands off
// to the existing PurchaseOrder screen/form — same "prefill, user still
// reviews and saves" pattern as the MR→PO flow, not a direct silent create.
import { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TrendingUp, Trophy, CheckCircle2, Clock, Plus, X, ChevronDown, ChevronUp, ShoppingCart } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import { usePageRights } from "@/hooks/usePageRights";
import {
  getQuotations, getL1ChartData, addQuotationSuppliers, removeQuotationSupplier,
  type Quotation, type QuotationSupplier,
} from "@/api/quotationApi";
import { getSuppliers, getQTPOPrefill } from "@/api/purchaseOrdersApi";
import { PickerRow, OptionPickerModal, type PickerOption } from "@/screens/finance/payment/OptionPicker";
import type { MainStackParamList } from "@/navigation/MainStack";

export default function L1ChartScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const queryClient = useQueryClient();
  const rights = usePageRights("l1-chart");
  const [quotationId, setQuotationId] = useState<number | null>(null);
  const [picker, setPicker] = useState<"quotation" | "addSupplier" | "winner" | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [winnerId, setWinnerId] = useState<number | null>(null);

  const { data: quotations = [], isLoading: loadingQuotations } = useQuery({
    queryKey: ["l1-quotations"],
    queryFn: () => getQuotations(),
    enabled: rights.canView,
  });
  const sendableQuotations = useMemo(() => quotations.filter((q) => q.Status !== "Draft"), [quotations]);
  const selectedQuotation = sendableQuotations.find((q) => q.QuotationId === quotationId) ?? null;

  const { data: chart, isLoading: loadingChart } = useQuery({
    queryKey: ["l1-chart", quotationId],
    queryFn: () => getL1ChartData(quotationId!),
    enabled: quotationId != null,
  });

  const { data: allSuppliers = [] } = useQuery({ queryKey: ["l1-all-suppliers"], queryFn: getSuppliers, enabled: picker === "addSupplier" });

  const addSupplierMutation = useMutation({
    mutationFn: (supplierLHeadId: string) => addQuotationSuppliers(quotationId!, [supplierLHeadId]),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["l1-chart", quotationId] }); setPicker(null); },
    onError: (err: any) => Alert.alert("Failed to add supplier", err.message ?? "Something went wrong."),
  });
  const removeSupplierMutation = useMutation({
    mutationFn: (supplierId: number) => removeQuotationSupplier(quotationId!, supplierId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["l1-chart", quotationId] }),
    onError: (err: any) => Alert.alert("Failed to remove supplier", err.message ?? "Something went wrong."),
  });

  const priceMap = useMemo(() => {
    const m = new Map<string, { Rate: number; SupplyDate: string | null; Quality: string | null }>();
    (chart?.prices ?? []).forEach((p) => m.set(`${p.QuotationItemId}:${p.SupplierLHeadId}`, p));
    return m;
  }, [chart]);

  const itemL1 = useMemo(() => {
    const m = new Map<number, { supplierId: number; rate: number }>();
    (chart?.items ?? []).forEach((item) => {
      const best = (chart?.suppliers ?? []).reduce<{ supplierId: number; rate: number } | null>((acc, s) => {
        const price = priceMap.get(`${item.QuotationItemId}:${s.SupplierLHeadId}`);
        if (price && price.Rate > 0 && (!acc || price.Rate < acc.rate)) return { supplierId: s.SupplierLHeadId, rate: price.Rate };
        return acc;
      }, null);
      if (best) m.set(item.QuotationItemId, best);
    });
    return m;
  }, [chart, priceMap]);

  const supplierTotals = useMemo(() => {
    const m = new Map<number, number>();
    (chart?.suppliers ?? []).forEach((s) => {
      const total = (chart?.items ?? []).reduce((sum, item) => {
        const price = priceMap.get(`${item.QuotationItemId}:${s.SupplierLHeadId}`);
        return sum + (price ? price.Rate * item.Quantity : 0);
      }, 0);
      m.set(s.SupplierLHeadId, total);
    });
    return m;
  }, [chart, priceMap]);

  const submittedSuppliers = useMemo(() => (chart?.suppliers ?? []).filter((s) => s.Status === "Submitted"), [chart]);

  const cheapestSupplierId = useMemo(() => {
    const best = submittedSuppliers.reduce<{ id: number; total: number } | null>((acc, s) => {
      const total = supplierTotals.get(s.SupplierLHeadId) ?? 0;
      if (total > 0 && (!acc || total < acc.total)) return { id: s.SupplierLHeadId, total };
      return acc;
    }, null);
    return best?.id ?? null;
  }, [submittedSuppliers, supplierTotals]);

  useEffect(() => { setWinnerId(cheapestSupplierId); }, [cheapestSupplierId, quotationId]);

  const [prefillLoading, setPrefillLoading] = useState(false);
  const handleCreatePO = async () => {
    if (!quotationId || !winnerId) return;
    setPrefillLoading(true);
    try {
      const prefill = await getQTPOPrefill(quotationId, winnerId);
      navigation.navigate("PurchaseOrder", { qtPrefill: prefill });
    } catch (err: any) {
      Alert.alert("Could not prepare Purchase Order", err.message ?? "Something went wrong.");
    } finally {
      setPrefillLoading(false);
    }
  };

  const toggleExpand = (supplierId: number) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(supplierId)) next.delete(supplierId); else next.add(supplierId);
    return next;
  });

  const taggedIds = new Set((chart?.suppliers ?? []).map((s) => s.SupplierLHeadId));
  const addableSuppliers: PickerOption[] = allSuppliers.filter((s) => !taggedIds.has(Number(s.id))).map((s) => ({ key: s.id, label: s.name }));
  const quotationOptions: PickerOption[] = sendableQuotations.map((q) => ({ key: String(q.QuotationId), label: q.DocNo || `QT-${q.QuotationId}`, sublabel: [q.CompanyName, q.ProjectName].filter(Boolean).join(" · ") || undefined }));
  const winnerOptions: PickerOption[] = submittedSuppliers.map((s) => ({
    key: String(s.SupplierLHeadId),
    label: s.SupplierName,
    sublabel: `${formatINR(supplierTotals.get(s.SupplierLHeadId) ?? 0)}${s.SupplierLHeadId === cheapestSupplierId ? " · Lowest" : ""}`,
  }));
  const winnerSupplier = submittedSuppliers.find((s) => s.SupplierLHeadId === winnerId);

  if (!rights.canView) {
    return (
      <View className="flex-1 items-center justify-center px-8" style={{ backgroundColor: colors.background }}>
        <TrendingUp size={28} color={colors.mutedForeground} />
        <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold, marginTop: 12 }}>No access</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, marginTop: 4, textAlign: "center" }}>
          You don't have permission to view the L1 Chart.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + (winnerId ? 100 : 24) }}>
        <View className="flex-row items-center gap-2.5 mb-3">
          <View className="w-9 h-9 rounded-xl items-center justify-center" style={{ backgroundColor: "#8b5cf626", borderWidth: 1, borderColor: "#8b5cf64d" }}>
            <TrendingUp size={16} color="#8b5cf6" />
          </View>
          <Text style={{ color: colors.foreground, fontFamily: fonts.heading.bold, fontSize: 18, flex: 1 }}>L1 Chart</Text>
        </View>

        <PickerRow
          label="Quotation"
          value={selectedQuotation ? `${selectedQuotation.DocNo || `QT-${selectedQuotation.QuotationId}`}` : ""}
          placeholder={loadingQuotations ? "Loading…" : "Select a quotation"}
          onPress={() => setPicker("quotation")}
        />

        {quotationId == null ? (
          <View className="rounded-xl px-3.5 py-6 items-center mt-2" style={{ borderWidth: 1, borderColor: colors.border, borderStyle: "dashed" }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 12, textAlign: "center" }}>Pick a quotation to compare supplier bids.</Text>
          </View>
        ) : loadingChart ? (
          <View className="py-16 items-center"><ActivityIndicator color={colors.mutedForeground} /></View>
        ) : !chart ? null : (
          <>
            <View className="flex-row items-center justify-between mt-4 mb-2.5">
              <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.heading.semibold, textTransform: "uppercase", letterSpacing: 0.6 }}>
                Suppliers ({chart.suppliers.length})
              </Text>
              <Pressable onPress={() => setPicker("addSupplier")} className="flex-row items-center gap-1 px-2.5 py-1.5 rounded-lg" style={{ borderWidth: 1, borderColor: colors.border }}>
                <Plus size={12} color={colors.primary} />
                <Text style={{ color: colors.primary, fontSize: 10.5, fontFamily: fonts.heading.medium }}>Add</Text>
              </Pressable>
            </View>

            {chart.suppliers.length === 0 && (
              <View className="rounded-xl px-3.5 py-5 items-center mb-2" style={{ borderWidth: 1, borderColor: colors.border, borderStyle: "dashed" }}>
                <Text style={{ color: colors.mutedForeground, fontSize: 12, textAlign: "center" }}>No suppliers tagged to this quotation yet.</Text>
              </View>
            )}

            {chart.suppliers.map((s) => {
              const isCheapest = s.SupplierLHeadId === cheapestSupplierId;
              const total = supplierTotals.get(s.SupplierLHeadId) ?? 0;
              const isExpanded = expanded.has(s.SupplierLHeadId);
              return (
                <View key={s.SupplierLHeadId} className="rounded-2xl mb-2.5 overflow-hidden" style={{ borderWidth: 1, borderColor: isCheapest ? "#059669" : `${colors.border}99`, backgroundColor: `${colors.card}80` }}>
                  <Pressable onPress={() => toggleExpand(s.SupplierLHeadId)} className="p-3.5">
                    <View className="flex-row items-center justify-between">
                      <View className="flex-row items-center gap-1.5 flex-1 min-w-0 mr-2">
                        {s.Status === "Submitted" ? <CheckCircle2 size={13} color="#059669" /> : <Clock size={13} color="#d97706" />}
                        <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.heading.bold, flex: 1 }}>{s.SupplierName}</Text>
                        {isCheapest && (
                          <View className="flex-row items-center gap-1 px-1.5 py-0.5 rounded" style={{ backgroundColor: "#0596691a", borderWidth: 1, borderColor: "#05966940" }}>
                            <Trophy size={10} color="#059669" />
                            <Text style={{ color: "#059669", fontSize: 8.5, fontFamily: fonts.heading.bold }}>Lowest</Text>
                          </View>
                        )}
                      </View>
                      <Pressable onPress={() => Alert.alert("Remove supplier?", `${s.SupplierName} will be removed from this quotation.`, [
                        { text: "Cancel", style: "cancel" },
                        { text: "Remove", style: "destructive", onPress: () => removeSupplierMutation.mutate(s.SupplierLHeadId) },
                      ])} className="p-1">
                        <X size={13} color={colors.mutedForeground} />
                      </Pressable>
                    </View>
                    <View className="flex-row items-center justify-between mt-2">
                      <Text style={{ color: colors.mutedForeground, fontSize: 10.5 }}>{s.Status}</Text>
                      <View className="flex-row items-center gap-1.5">
                        <Text style={{ color: isCheapest ? "#059669" : colors.foreground, fontSize: 13, fontFamily: fonts.heading.bold }}>{total > 0 ? formatINR(total) : "—"}</Text>
                        {isExpanded ? <ChevronUp size={13} color={colors.mutedForeground} /> : <ChevronDown size={13} color={colors.mutedForeground} />}
                      </View>
                    </View>
                  </Pressable>

                  {isExpanded && (
                    <View style={{ borderTopWidth: 1, borderTopColor: colors.border }}>
                      {chart.items.map((item, i) => {
                        const price = priceMap.get(`${item.QuotationItemId}:${s.SupplierLHeadId}`);
                        const isL1 = itemL1.get(item.QuotationItemId)?.supplierId === s.SupplierLHeadId;
                        return (
                          <View
                            key={item.QuotationItemId}
                            className="flex-row items-center justify-between px-3.5 py-2.5"
                            style={{ borderTopWidth: i > 0 ? 1 : 0, borderTopColor: `${colors.border}60`, backgroundColor: isL1 ? "#0596690d" : "transparent" }}
                          >
                            <View style={{ flex: 1, marginRight: 8 }}>
                              <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 11.5 }}>{item.ItemName}</Text>
                              <Text style={{ color: colors.mutedForeground, fontSize: 9.5, marginTop: 1 }}>{item.Quantity} {item.UOMCode}</Text>
                            </View>
                            <View style={{ alignItems: "flex-end" }}>
                              <View className="flex-row items-center gap-1">
                                {isL1 && <Trophy size={10} color="#059669" />}
                                <Text style={{ color: isL1 ? "#059669" : colors.foreground, fontSize: 12, fontFamily: fonts.heading.semibold }}>
                                  {price ? formatINR(price.Rate) : "—"}
                                </Text>
                              </View>
                              {!!price?.SupplyDate && <Text style={{ color: colors.mutedForeground, fontSize: 9 }}>{price.SupplyDate.slice(0, 10)}</Text>}
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              );
            })}
          </>
        )}
      </ScrollView>

      {quotationId != null && !!chart && submittedSuppliers.length > 0 && rights.canCreate && (
        <View className="absolute left-0 right-0 bottom-0 px-4" style={{ paddingBottom: insets.bottom + 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background }}>
          <View className="flex-row items-center justify-between mb-2.5">
            <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.medium, textTransform: "uppercase" }}>Award to</Text>
            <Pressable onPress={() => setPicker("winner")} className="flex-row items-center gap-1.5">
              <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.heading.semibold }}>{winnerSupplier?.SupplierName ?? "Select supplier"}</Text>
              <ChevronDown size={12} color={colors.mutedForeground} />
            </Pressable>
          </View>
          <Pressable
            onPress={handleCreatePO} disabled={!winnerId || prefillLoading}
            className="flex-row items-center justify-center gap-1.5 py-3 rounded-xl"
            style={{ backgroundColor: colors.primary, opacity: !winnerId || prefillLoading ? 0.6 : 1 }}
          >
            {prefillLoading ? <ActivityIndicator size="small" color="#fff" /> : <ShoppingCart size={14} color="#fff" />}
            <Text style={{ color: "#fff", fontSize: 13, fontFamily: fonts.heading.semibold }}>Create Purchase Order</Text>
          </Pressable>
        </View>
      )}

      <OptionPickerModal visible={picker === "quotation"} title="Select Quotation" options={quotationOptions} selectedKey={quotationId != null ? String(quotationId) : ""}
        onSelect={(k) => { setQuotationId(k ? Number(k) : null); setExpanded(new Set()); setPicker(null); }}
        onClose={() => setPicker(null)} searchable loading={loadingQuotations} />
      <OptionPickerModal visible={picker === "addSupplier"} title="Add Supplier" options={addableSuppliers} selectedKey=""
        onSelect={(k) => addSupplierMutation.mutate(k)} onClose={() => setPicker(null)} searchable loading={addSupplierMutation.isPending} />
      <OptionPickerModal visible={picker === "winner"} title="Award To" options={winnerOptions} selectedKey={winnerId != null ? String(winnerId) : ""}
        onSelect={(k) => { setWinnerId(Number(k)); setPicker(null); }} onClose={() => setPicker(null)} />
    </View>
  );
}
