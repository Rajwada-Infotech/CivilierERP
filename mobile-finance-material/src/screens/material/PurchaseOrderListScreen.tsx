// RN port of src/pages/material/PurchaseOrderMaster.tsx (web) — the
// largest page in the Material module (5,095 lines). Scope trimmed per
// agreement: Direct + From-MR + From-Quotation (L1 Chart award, via
// route.params.qtPrefill below) creation, full GST/UOM engine, single
// detail modal. Deferred to web-only: Work Order/Work Design sourcing,
// CSV import/export, print, embedded chat, and the multi-step delete-
// dependency dialog (mobile does a simple can-delete check + one alert
// instead of the 4-branch remediation UI).
import { useEffect, useMemo, useState } from "react";
import { View, Text, FlatList, Pressable, ActivityIndicator, RefreshControl, TextInput, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { ShoppingCart, Search, X, Plus, Eye, Pencil, Trash2, ShieldOff, AlertCircle } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import { usePageRights } from "@/hooks/usePageRights";
import {
  getPurchaseOrders, canDeletePurchaseOrder, deletePurchaseOrder,
  type PurchaseOrder, type QTPOPrefill,
} from "@/api/purchaseOrdersApi";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
import { PurchaseOrderFormModal } from "./purchaseOrder/PurchaseOrderFormModal";
import { PurchaseOrderDetailModal } from "./purchaseOrder/PurchaseOrderDetailModal";
import type { MainStackParamList } from "@/navigation/MainStack";

const PAGE_SIZE = 15;
const PO_TYPE_TABS: { key: string; label: string }[] = [
  { key: "", label: "All" }, { key: "WO_PO", label: "WO-POs" }, { key: "Direct", label: "Direct" }, { key: "Normal", label: "From MR" },
];

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function POCard({ po, onView, onEdit, onDelete, canEdit, canDelete }: {
  po: PurchaseOrder; onView: () => void; onEdit: () => void; onDelete: () => void; canEdit: boolean; canDelete: boolean;
}) {
  const typeColor = po.POType === "WO_PO" ? "#059669" : po.POType === "Direct" ? "#3b82f6" : null;
  return (
    <View className="rounded-2xl p-3.5 mb-2.5" style={{ backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: `${colors.border}99` }}>
      <View className="flex-row items-start justify-between gap-2 mb-2">
        <View className="flex-row items-center gap-1.5 flex-1 min-w-0">
          <Text numberOfLines={1} style={{ color: "#059669", fontSize: 12.5, fontFamily: fonts.heading.bold }}>{po.PurchaseOrderNo || "—"}</Text>
          {!!typeColor && (
            <View className="px-1.5 py-0.5 rounded" style={{ backgroundColor: `${typeColor}1a`, borderWidth: 1, borderColor: `${typeColor}40` }}>
              <Text style={{ color: typeColor, fontSize: 8.5, fontFamily: fonts.heading.bold }}>{po.POType === "WO_PO" ? "WO-PO" : "Direct"}</Text>
            </View>
          )}
        </View>
        <ApprovalStatusChain table="PurchaseOrders" recordId={po.PurchaseOrderID} />
      </View>

      <Text style={{ color: colors.mutedForeground, fontSize: 10.5, marginBottom: 6 }}>{fmtDate(po.PODate)}</Text>

      <View className="flex-row flex-wrap">
        <View style={{ width: "50%", marginBottom: 6 }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>Supplier</Text>
          <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 11.5, marginTop: 1 }}>{po.SupplierName || "—"}</Text>
        </View>
        <View style={{ width: "50%", marginBottom: 6 }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>Company</Text>
          <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 11.5, marginTop: 1 }}>{po.CompanyName || "—"}</Text>
        </View>
        <View style={{ width: "50%" }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>Project</Text>
          <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 11.5, marginTop: 1 }}>{po.ProjectName || "—"}</Text>
        </View>
        <View style={{ width: "50%" }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>Amount</Text>
          <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.heading.semibold, marginTop: 1 }}>{formatINR(po.TotalAmount ?? 0)}</Text>
        </View>
      </View>

      <View className="flex-row items-center justify-end gap-1 mt-2.5 pt-2" style={{ borderTopWidth: 1, borderTopColor: `${colors.border}80` }}>
        <Pressable onPress={onView} className="p-2 rounded-lg"><Eye size={15} color={colors.mutedForeground} /></Pressable>
        {canEdit && <Pressable onPress={onEdit} className="p-2 rounded-lg"><Pencil size={15} color={colors.mutedForeground} /></Pressable>}
        {canDelete && <Pressable onPress={onDelete} className="p-2 rounded-lg"><Trash2 size={15} color={colors.destructive} /></Pressable>}
      </View>
    </View>
  );
}

export default function PurchaseOrderListScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const rights = usePageRights("purchase-orders");
  const route = useRoute<RouteProp<MainStackParamList, "PurchaseOrder">>();
  const [search, setSearch] = useState("");
  const [poTypeFilter, setPoTypeFilter] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [viewingId, setViewingId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [qtPrefill, setQtPrefill] = useState<QTPOPrefill | null>(null);

  useEffect(() => {
    if (route.params?.qtPrefill) {
      setQtPrefill(route.params.qtPrefill);
      setEditingId(null);
      setFormOpen(true);
    }
  }, [route.params?.qtPrefill]);

  const {
    data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage, refetch,
  } = useInfiniteQuery({
    queryKey: ["purchase-orders-mobile", poTypeFilter],
    queryFn: ({ pageParam }) => getPurchaseOrders({ page: pageParam, limit: PAGE_SIZE, poType: poTypeFilter || undefined }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, pages) => (pages.length < (lastPage?.totalPages ?? 1) ? pages.length + 1 : undefined),
    enabled: rights.canView,
  });

  const records: PurchaseOrder[] = useMemo(() => (data?.pages ?? []).flatMap((p) => p?.data ?? []), [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return records;
    return records.filter((r) => [r.PurchaseOrderNo, r.SupplierName, r.CompanyName, r.ProjectName]
      .some((v) => (v ?? "").toLowerCase().includes(q)));
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
        Alert.alert("Can't delete this order", check.reason || "This Purchase Order has linked records (GRN/Expense Booking) — remove those first, or manage this from the web app.");
        return;
      }
      Alert.alert("Delete Purchase Order?", `${po.PurchaseOrderNo} will be permanently removed.`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete", style: "destructive", onPress: async () => {
            try {
              await deletePurchaseOrder(po.PurchaseOrderID);
              queryClient.invalidateQueries({ queryKey: ["purchase-orders-mobile"], exact: false });
            } catch (err: any) {
              Alert.alert("Failed to delete", err.message ?? "Something went wrong.");
            }
          },
        },
      ]);
    } catch (err: any) {
      Alert.alert("Failed to check", err.message ?? "Something went wrong.");
    }
  };

  if (!rights.canView) {
    return (
      <View className="flex-1 items-center justify-center px-8" style={{ backgroundColor: colors.background }}>
        <ShieldOff size={28} color={colors.mutedForeground} />
        <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold, marginTop: 12 }}>No access</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, marginTop: 4, textAlign: "center" }}>
          You don't have permission to view Purchase Orders.
        </Text>
      </View>
    );
  }

  const ListHeader = (
    <View>
      <View className="flex-row items-center gap-2.5 mb-3">
        <View className="w-9 h-9 rounded-xl items-center justify-center" style={{ backgroundColor: "#10b98126", borderWidth: 1, borderColor: "#10b9814d" }}>
          <ShoppingCart size={16} color="#10b981" />
        </View>
        <Text style={{ color: colors.foreground, fontFamily: fonts.heading.bold, fontSize: 18, flex: 1 }}>Purchase Orders</Text>
        {rights.canCreate && (
          <Pressable onPress={() => { setEditingId(null); setFormOpen(true); }} className="flex-row items-center gap-1.5 px-3 py-2 rounded-xl" style={{ backgroundColor: "#10b981" }}>
            <Plus size={14} color="#fff" />
            <Text style={{ color: "#fff", fontSize: 12, fontFamily: fonts.heading.semibold }}>New</Text>
          </Pressable>
        )}
      </View>

      <View className="flex-row items-center gap-2 px-3 rounded-xl mb-3" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.card}80` }}>
        <Search size={14} color={colors.mutedForeground} />
        <TextInput
          value={search} onChangeText={setSearch}
          placeholder="Search PO number, supplier…"
          placeholderTextColor={`${colors.mutedForeground}99`}
          style={{ flex: 1, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13, paddingVertical: 10 }}
        />
        {!!search && <Pressable onPress={() => setSearch("")}><X size={14} color={colors.mutedForeground} /></Pressable>}
      </View>

      <View className="flex-row flex-wrap gap-1.5 mb-3">
        {PO_TYPE_TABS.map((t) => {
          const active = poTypeFilter === t.key;
          return (
            <Pressable
              key={t.label}
              onPress={() => setPoTypeFilter(t.key)}
              className="px-3 py-1.5 rounded-full"
              style={{ borderWidth: 1, borderColor: active ? colors.primary : colors.border, backgroundColor: active ? `${colors.primary}1a` : "transparent" }}
            >
              <Text style={{ color: active ? colors.primary : colors.mutedForeground, fontSize: 11, fontFamily: fonts.heading.medium }}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {isLoading ? (
        <View className="flex-1 items-center justify-center"><ActivityIndicator color={colors.mutedForeground} /></View>
      ) : isError ? (
        <View className="flex-1 items-center justify-center px-8">
          <AlertCircle size={20} color={colors.destructive} />
          <Text style={{ color: colors.destructive, fontSize: 12, fontFamily: fonts.body.medium, marginTop: 8, textAlign: "center" }}>
            Failed to load Purchase Orders. Please try again.
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(r) => String(r.PurchaseOrderID)}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          onEndReachedThreshold={0.4}
          onEndReached={() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage(); }}
          ListHeaderComponent={ListHeader}
          renderItem={({ item }) => (
            <POCard
              po={item}
              onView={() => setViewingId(item.PurchaseOrderID)}
              onEdit={() => { setEditingId(item.PurchaseOrderID); setFormOpen(true); }}
              onDelete={() => handleDelete(item)}
              canEdit={rights.canEdit}
              canDelete={rights.canDelete}
            />
          )}
          ListEmptyComponent={
            <View className="items-center py-16">
              <AlertCircle size={20} color={`${colors.mutedForeground}80`} />
              <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, marginTop: 8 }}>No Purchase Orders yet.</Text>
            </View>
          }
          ListFooterComponent={isFetchingNextPage ? (
            <View className="py-4 items-center"><ActivityIndicator size="small" color={colors.mutedForeground} /></View>
          ) : null}
        />
      )}

      <PurchaseOrderFormModal
        visible={formOpen} editingId={editingId} qtPrefill={qtPrefill}
        onClose={() => { setFormOpen(false); setEditingId(null); setQtPrefill(null); }}
      />
      <PurchaseOrderDetailModal recordId={viewingId} onClose={() => setViewingId(null)} />
    </View>
  );
}
