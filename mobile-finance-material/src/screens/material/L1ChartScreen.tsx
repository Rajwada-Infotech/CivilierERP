// RN port of src/pages/material/L1Chart.tsx, on the drawing sheet as the web draws it (title block, the quotation
// panel, the figures, a ruled register of supplier bids, the award bar along the foot). Web renders a spreadsheet-
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
import { View, Text, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X, ChevronDown, ChevronRight, ShoppingCart } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { Body, IconKey, Key, Label, Panel, Press, RegisterHead, SheetMark, SheetShell, StatRow } from "@/components/sheet/Sheet";
import { NoAccess, RegisterBox, RegisterLoading, SheetPage, fmtDate } from "@/components/sheet/Register";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import { usePageRights } from "@/hooks/usePageRights";
import {
  getQuotations, getL1ChartData, addQuotationSuppliers, removeQuotationSupplier,
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
      navigation.navigate("PurchaseOrderForm", { qtPrefill: prefill });
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

  if (!rights.canView) return <NoAccess eyebrow="CivilierERP · Material" title="L1 comparative chart" what="the L1 chart" />;

  const showAward = quotationId != null && !!chart && submittedSuppliers.length > 0 && rights.canCreate;

  return (
    <View style={{ flex: 1 }}>
      <SheetPage>
        <SheetShell
          eyebrow="CivilierERP · Material"
          title="L1 comparative chart"
          subtitle="Supplier prices side by side, the lowest (L1) on each item marked; pick the winner and raise a purchase order."
        >
          <Panel title="Quotation">
            <View>
              <PickerRow
                label="Quotation"
                value={selectedQuotation ? selectedQuotation.DocNo || `QT-${selectedQuotation.QuotationId}` : ""}
                placeholder={loadingQuotations ? "Loading…" : "Select a quotation…"}
                onPress={() => setPicker("quotation")}
              />
            </View>
            {!!selectedQuotation && <Body size={12} color={S.graphite}>{[selectedQuotation.CompanyName, selectedQuotation.ProjectName].filter(Boolean).join(" · ")}</Body>}
          </Panel>

          {quotationId == null ? (
            <Body color={S.graphite}>Pick a quotation to compare supplier bids.</Body>
          ) : loadingChart ? (
            <RegisterLoading />
          ) : !chart ? null : (
            <>
              {submittedSuppliers.length > 0 && (
                <StatRow
                  items={[
                    { label: "Suppliers", value: String(chart.suppliers.length), note: `${submittedSuppliers.length} submitted` },
                    { label: "Items", value: String(chart.items.length), note: "on the quotation" },
                    {
                      label: "Lowest bid",
                      value: cheapestSupplierId ? formatINR(supplierTotals.get(cheapestSupplierId) ?? 0) : "—",
                      note: submittedSuppliers.find((s) => s.SupplierLHeadId === cheapestSupplierId)?.SupplierName ?? "no priced bid yet",
                    },
                  ]}
                />
              )}

              <RegisterBox>
                <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <RegisterHead title="Supplier bids" count={chart.suppliers.length} unit={["supplier", "suppliers"]} />
                  </View>
                  <Key label="Add" icon={<Plus size={13} color={S.ink} />} onPress={() => setPicker("addSupplier")} style={{ minHeight: 36, paddingHorizontal: 12, marginBottom: 10 }} />
                </View>

                {chart.suppliers.length === 0 ? (
                  <Body color={S.graphite}>No suppliers tagged to this quotation yet.</Body>
                ) : (
                  <View>
                    {chart.suppliers.map((s, si) => {
                      const isCheapest = s.SupplierLHeadId === cheapestSupplierId;
                      const total = supplierTotals.get(s.SupplierLHeadId) ?? 0;
                      const open = expanded.has(s.SupplierLHeadId);
                      return (
                        <View key={s.SupplierLHeadId} style={{ borderTopWidth: si ? 1 : 0, borderTopColor: S.ruleSoft }}>
                          <Press
                            onPress={() => toggleExpand(s.SupplierLHeadId)}
                            style={(pressed) => ({ paddingVertical: 12, gap: 6, backgroundColor: pressed ? S.blueWash : "transparent" })}
                          >
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                              {open ? <ChevronDown size={14} color={S.graphite} /> : <ChevronRight size={14} color={S.graphite} />}
                              <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.heading.semibold, fontSize: 13, color: S.ink }}>{s.SupplierName}</Text>
                              <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 14, color: S.ink, fontVariant: ["tabular-nums"] }}>{total > 0 ? formatINR(total) : "—"}</Text>
                            </View>
                            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 22 }}>
                              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                                <SheetMark text={s.Status} tone={s.Status === "Submitted" ? "done" : "waiting"} />
                                {isCheapest && <SheetMark text="Lowest (L1)" tone="done" />}
                              </View>
                              <IconKey
                                size={30}
                                red
                                onPress={() =>
                                  Alert.alert("Remove supplier?", `${s.SupplierName} will be removed from this quotation.`, [
                                    { text: "Cancel", style: "cancel" },
                                    { text: "Remove", style: "destructive", onPress: () => removeSupplierMutation.mutate(s.SupplierLHeadId) },
                                  ])
                                }
                              >
                                <X size={13} color={S.red} />
                              </IconKey>
                            </View>
                          </Press>

                          {open && (
                            <View style={{ marginLeft: 22, marginBottom: 12, borderWidth: 1, borderColor: S.ink }}>
                              {chart.items.map((item, i) => {
                                const price = priceMap.get(`${item.QuotationItemId}:${s.SupplierLHeadId}`);
                                const isL1 = itemL1.get(item.QuotationItemId)?.supplierId === s.SupplierLHeadId;
                                return (
                                  <View key={item.QuotationItemId} style={{ flexDirection: "row", gap: 10, paddingHorizontal: 10, paddingVertical: 9, borderTopWidth: i ? 1 : 0, borderTopColor: S.ruleSoft, backgroundColor: isL1 ? S.blueWash : "transparent" }}>
                                    <View style={{ flex: 1, minWidth: 0 }}>
                                      <Text numberOfLines={2} style={{ fontFamily: fonts.body.medium, fontSize: 12, color: S.ink }}>{item.ItemName}</Text>
                                      <Text style={{ fontFamily: fonts.body.regular, fontSize: 10.5, color: S.graphite, marginTop: 1 }}>{`${item.Quantity} ${item.UOMCode}`}</Text>
                                    </View>
                                    <View style={{ alignItems: "flex-end", gap: 2 }}>
                                      <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 12.5, color: S.ink, fontVariant: ["tabular-nums"] }}>{price ? formatINR(price.Rate) : "—"}</Text>
                                      {isL1 && <Label color={S.ink}>L1</Label>}
                                      {!!price?.SupplyDate && <Text style={{ fontFamily: fonts.body.regular, fontSize: 10, color: S.graphite }}>{fmtDate(price.SupplyDate)}</Text>}
                                    </View>
                                  </View>
                                );
                              })}
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                )}
              </RegisterBox>
            </>
          )}
          {showAward && <View style={{ height: 110 }} />}
        </SheetShell>
      </SheetPage>

      {showAward && (
        <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 10, paddingBottom: insets.bottom + 12, gap: 8, borderTopWidth: 1, borderTopColor: S.ink, backgroundColor: S.paper }}>
          <PickerRow label="Award to" value={winnerSupplier?.SupplierName ?? ""} placeholder="Select supplier…" onPress={() => setPicker("winner")} />
          <Key tone="ink" label={prefillLoading ? "Preparing…" : "Create purchase order"} icon={<ShoppingCart size={13} color={S.paper} />} onPress={handleCreatePO} disabled={!winnerId || prefillLoading} />
        </View>
      )}

      <OptionPickerModal visible={picker === "quotation"} title="Select quotation" options={quotationOptions} selectedKey={quotationId != null ? String(quotationId) : ""}
        onSelect={(k) => { setQuotationId(k ? Number(k) : null); setExpanded(new Set()); setPicker(null); }}
        onClose={() => setPicker(null)} searchable loading={loadingQuotations} />
      <OptionPickerModal visible={picker === "addSupplier"} title="Add supplier" options={addableSuppliers} selectedKey=""
        onSelect={(k) => addSupplierMutation.mutate(k)} onClose={() => setPicker(null)} searchable loading={addSupplierMutation.isPending} />
      <OptionPickerModal visible={picker === "winner"} title="Award to" options={winnerOptions} selectedKey={winnerId != null ? String(winnerId) : ""}
        onSelect={(k) => { setWinnerId(Number(k)); setPicker(null); }} onClose={() => setPicker(null)} />
    </View>
  );
}
