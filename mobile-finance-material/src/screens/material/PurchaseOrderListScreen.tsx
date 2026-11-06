// RN port of src/pages/material/PurchaseOrderMaster.tsx (web), on the drawing sheet as the web draws it: the title block
// with New order; the order register — its count, a search box, the source keys (All / WO-POs / Direct / From MR) and
// the orders grouped by project, each a ruled row with the supplier, the MR it came from, the amount, its approval mark
// and keys. A row opens PurchaseOrderDetailModal; New and Edit open the form as its own page (PurchaseOrderFormScreen),
// as does an L1 Chart award (route.params.qtPrefill). Scope as before: Direct + From-MR + From-Quotation creation;
// Work Order / Work Design sourcing, CSV import/export, print and the multi-step delete-dependency dialog stay on the web
// (mobile does a can-delete check and one alert).
import { useEffect, useMemo, useState } from "react";
import { View, Alert } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { formatINR } from "@/utils/formatCurrency";
import { usePageRights } from "@/hooks/usePageRights";
import { getPurchaseOrders, canDeletePurchaseOrder, deletePurchaseOrder, type PurchaseOrder } from "@/api/purchaseOrdersApi";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
import { Key, Notice, RegisterHead, SearchBox, SheetMark, SheetShell, statusTone } from "@/components/sheet/Sheet";
import { Facts, KeyRow, NoAccess, ProjectGroups, RecordRow, RegisterBox, RegisterFoot, RegisterLoading, RowKeys, SheetPage, fmtDate } from "@/components/sheet/Register";
import { PurchaseOrderDetailModal } from "./purchaseOrder/PurchaseOrderDetailModal";
import type { MainStackParamList } from "@/navigation/MainStack";

const PAGE_SIZE = 15;
const PO_TYPES = [
  { value: "", label: "All" },
  { value: "WO_PO", label: "WO-POs" },
  { value: "Direct", label: "Direct" },
  { value: "Normal", label: "From MR" },
];

export default function PurchaseOrderListScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const queryClient = useQueryClient();
  const rights = usePageRights("purchase-orders");
  const route = useRoute<RouteProp<MainStackParamList, "PurchaseOrder">>();
  const [search, setSearch] = useState("");
  const [poType, setPoType] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [viewingId, setViewingId] = useState<number | null>(null);

  // An L1 Chart award arriving here goes straight on to the form, prefilled.
  useEffect(() => {
    if (route.params?.qtPrefill) navigation.navigate("PurchaseOrderForm", { qtPrefill: route.params.qtPrefill });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.qtPrefill]);

  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage, refetch, isFetching } = useInfiniteQuery({
    queryKey: ["purchase-orders-mobile", poType],
    queryFn: ({ pageParam }) => getPurchaseOrders({ page: pageParam, limit: PAGE_SIZE, poType: poType || undefined }),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => (pages.length < (last?.totalPages ?? 1) ? pages.length + 1 : undefined),
    enabled: rights.canView,
  });

  const records: PurchaseOrder[] = useMemo(() => (data?.pages ?? []).flatMap((p) => p?.data ?? []), [data]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return records;
    return records.filter((r) => [r.PurchaseOrderNo, r.SupplierName, r.CompanyName, r.ProjectName].some((v) => (v ?? "").toLowerCase().includes(q)));
  }, [records, search]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handleDelete = async (po: PurchaseOrder) => {
    try {
      const check = await canDeletePurchaseOrder(po.PurchaseOrderID);
      if (!check.canDelete) {
        Alert.alert("This order can't be deleted", check.reason || "It has linked records (GRN / expense booking). Remove those first, or manage it from the web app.");
        return;
      }
      Alert.alert("Delete purchase order?", `${po.PurchaseOrderNo} will be permanently removed.`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deletePurchaseOrder(po.PurchaseOrderID);
              queryClient.invalidateQueries({ queryKey: ["purchase-orders-mobile"], exact: false });
            } catch (err: any) {
              Alert.alert("Could not delete", err.message ?? "Something went wrong.");
            }
          },
        },
      ]);
    } catch (err: any) {
      Alert.alert("Could not check", err.message ?? "Something went wrong.");
    }
  };

  if (!rights.canView) return <NoAccess eyebrow="CivilierERP · Material" title="Purchase orders" what="purchase orders" />;

  return (
    <View style={{ flex: 1 }}>
      <SheetPage refreshing={refreshing} onRefresh={onRefresh} onEndReached={() => hasNextPage && !isFetchingNextPage && fetchNextPage()}>
        <SheetShell
          eyebrow="CivilierERP · Material"
          title="Purchase orders"
          subtitle="Orders placed with suppliers — from a material request, a quotation, a work order or direct."
          action={
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {rights.canCreate && <Key tone="ink" label="New order" icon={<Plus size={13} color={S.paper} />} onPress={() => navigation.navigate("PurchaseOrderForm")} />}
              <Key label={isFetching && !isFetchingNextPage ? "Reading…" : "Refresh"} icon={<RefreshCw size={13} color={S.ink} />} onPress={() => refetch()} />
            </View>
          }
        >
          <RegisterBox>
            <RegisterHead title="Order register" count={filtered.length} unit={["order loaded", "orders loaded"]} />
            <SearchBox value={search} onChange={setSearch} placeholder="Search PO number, supplier, company…" />
            <KeyRow options={PO_TYPES} value={poType} onChange={setPoType} />

            {isLoading ? (
              <RegisterLoading />
            ) : isError ? (
              <Notice>Could not load the purchase orders. Pull down to try again.</Notice>
            ) : (
              <>
                <ProjectGroups
                  items={filtered}
                  getProject={(r) => r.ProjectName}
                  keyOf={(r) => r.PurchaseOrderID}
                  unit={["order", "orders"]}
                  expandAll={!!search.trim()}
                  emptyText={search ? "No order matches that search." : "No purchase orders yet."}
                  renderItem={(po, last) => (
                    <RecordRow
                      last={last}
                      title={po.PurchaseOrderNo || "—"}
                      date={fmtDate(po.PODate)}
                      side={formatINR(po.TotalAmount ?? 0)}
                      onPress={() => setViewingId(po.PurchaseOrderID)}
                      lines={[
                        po.SupplierName || "—",
                        <Facts
                          key="f"
                          items={[
                            ["Company", po.CompanyName],
                            ["MR", po.EffectiveMRDocNo || po.SourceMRDocNo],
                          ]}
                        />,
                      ]}
                      marks={
                        <>
                          <ApprovalStatusChain table="PurchaseOrders" recordId={po.PurchaseOrderID} fallback={<SheetMark text={po.Status || "Draft"} tone={statusTone(po.Status || "Draft")} />} />
                          {(po.POType === "WO_PO" || po.POType === "Direct") && <SheetMark text={po.POType === "WO_PO" ? "WO-PO" : "Direct"} tone="draft" />}
                        </>
                      }
                      actions={
                        <RowKeys
                          onView={() => setViewingId(po.PurchaseOrderID)}
                          onEdit={rights.canEdit ? () => navigation.navigate("PurchaseOrderForm", { id: po.PurchaseOrderID }) : undefined}
                          onDelete={rights.canDelete ? () => handleDelete(po) : undefined}
                        />
                      }
                    />
                  )}
                />
                <RegisterFoot loadingMore={isFetchingNextPage} done={!hasNextPage} shown={records.length} />
              </>
            )}
          </RegisterBox>
        </SheetShell>
      </SheetPage>

      <PurchaseOrderDetailModal
        recordId={viewingId}
        onClose={() => setViewingId(null)}
        onEdit={rights.canEdit ? (id) => { setViewingId(null); navigation.navigate("PurchaseOrderForm", { id }); } : undefined}
      />
    </View>
  );
}
