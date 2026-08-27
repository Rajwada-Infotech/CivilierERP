// RN port of StockTransfer.tsx's TransferHistory table (plain Stock
// Transfers only — Inter-Company Transfer rows and the "Make GRN" flow are
// out of scope, see stockTransferApi.ts). No Edit/Delete actions exist at
// all: the backend has no PUT/DELETE route for StockTransfers, a transfer
// executes immediately and is immutable, so the only row action is View.
import { useMemo, useState } from "react";
import { View, Text, FlatList, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Repeat, Plus, Eye, ShieldOff, AlertCircle, ArrowRight } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { usePageRights } from "@/hooks/usePageRights";
import { getStockTransfers, type StockTransfer } from "@/api/stockTransferApi";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
import { StockTransferFormModal } from "./stockTransfer/StockTransferFormModal";
import { StockTransferDetailModal } from "./stockTransfer/StockTransferDetailModal";

const PAGE_SIZE = 15;

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function TransferCard({ transfer, onView }: { transfer: StockTransfer; onView: () => void }) {
  return (
    <Pressable onPress={onView} className="rounded-2xl p-3.5 mb-2.5" style={{ backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: `${colors.border}99` }}>
      <View className="flex-row items-start justify-between gap-2 mb-2">
        <Text numberOfLines={1} style={{ color: "#0891b2", fontSize: 12.5, fontFamily: fonts.heading.bold, flex: 1, marginRight: 8 }}>{transfer.DocNo}</Text>
        <ApprovalStatusChain table="StockTransfers" recordId={transfer.TransferID} />
      </View>

      <Text style={{ color: colors.mutedForeground, fontSize: 10.5, marginBottom: 8 }}>{fmtDate(transfer.TransferDate)}</Text>

      <View className="flex-row items-center gap-1.5 mb-2">
        <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 11.5, flex: 1 }}>{transfer.FromGodownName}</Text>
        <ArrowRight size={12} color={colors.mutedForeground} />
        <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 11.5, flex: 1, textAlign: "right" }}>{transfer.ToGodownName}</Text>
      </View>

      <View className="flex-row items-center justify-between pt-2" style={{ borderTopWidth: 1, borderTopColor: `${colors.border}80` }}>
        <Text style={{ color: colors.mutedForeground, fontSize: 10.5 }}>{(transfer.TransferItems ?? []).length} item{(transfer.TransferItems ?? []).length === 1 ? "" : "s"}</Text>
        <View className="flex-row items-center gap-1"><Eye size={13} color={colors.mutedForeground} /></View>
      </View>
    </Pressable>
  );
}

export default function StockTransferListScreen() {
  const insets = useSafeAreaInsets();
  const rights = usePageRights("stock-transfers");
  const [refreshing, setRefreshing] = useState(false);
  const [viewingId, setViewingId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const {
    data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage, refetch,
  } = useInfiniteQuery({
    queryKey: ["stock-transfers-mobile"],
    queryFn: ({ pageParam }) => getStockTransfers({ page: pageParam, limit: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((s, p) => s + (p?.data?.length ?? 0), 0);
      return loaded < (lastPage?.total ?? 0) ? pages.length + 1 : undefined;
    },
    enabled: rights.canView,
  });

  const records: StockTransfer[] = useMemo(() => (data?.pages ?? []).flatMap((p) => p?.data ?? []), [data]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  if (!rights.canView) {
    return (
      <View className="flex-1 items-center justify-center px-8" style={{ backgroundColor: colors.background }}>
        <ShieldOff size={28} color={colors.mutedForeground} />
        <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold, marginTop: 12 }}>No access</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, marginTop: 4, textAlign: "center" }}>
          You don't have permission to view Stock Transfers.
        </Text>
      </View>
    );
  }

  const ListHeader = (
    <View className="flex-row items-center gap-2.5 mb-3">
      <View className="w-9 h-9 rounded-xl items-center justify-center" style={{ backgroundColor: "#0891b226", borderWidth: 1, borderColor: "#0891b24d" }}>
        <Repeat size={16} color="#0891b2" />
      </View>
      <Text style={{ color: colors.foreground, fontFamily: fonts.heading.bold, fontSize: 18, flex: 1 }}>Stock Transfers</Text>
      {rights.canCreate && (
        <Pressable onPress={() => setFormOpen(true)} className="flex-row items-center gap-1.5 px-3 py-2 rounded-xl" style={{ backgroundColor: "#0891b2" }}>
          <Plus size={14} color="#fff" />
          <Text style={{ color: "#fff", fontSize: 12, fontFamily: fonts.heading.semibold }}>New</Text>
        </Pressable>
      )}
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
            Failed to load Stock Transfers. Please try again.
          </Text>
        </View>
      ) : (
        <FlatList
          data={records}
          keyExtractor={(r) => String(r.TransferID)}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          onEndReachedThreshold={0.4}
          onEndReached={() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage(); }}
          ListHeaderComponent={ListHeader}
          renderItem={({ item }) => <TransferCard transfer={item} onView={() => setViewingId(item.TransferID)} />}
          ListEmptyComponent={
            <View className="items-center py-16">
              <AlertCircle size={20} color={`${colors.mutedForeground}80`} />
              <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, marginTop: 8 }}>No Stock Transfers yet.</Text>
            </View>
          }
          ListFooterComponent={isFetchingNextPage ? (
            <View className="py-4 items-center"><ActivityIndicator size="small" color={colors.mutedForeground} /></View>
          ) : null}
        />
      )}

      <StockTransferFormModal visible={formOpen} onClose={() => setFormOpen(false)} />
      <StockTransferDetailModal recordId={viewingId} onClose={() => setViewingId(null)} />
    </View>
  );
}
