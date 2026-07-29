// RN port of AmendmentMenu.tsx's amendment register (as a flat, standalone
// list — the multi-tab PO/GRN/EB source-document browser that surrounds
// it on web is replaced by a lightweight in-form doc picker, see
// AmendmentFormModal.tsx). Server-paginated, matching web's GET /api/
// amendments?page&pageSize&search&status. Edit/Delete gated by
// usePageRights + Status==='Draft'; Approve/Reject gated by role
// (APPROVER_ROLES), not page rights — matches web's own split gating.
import { useMemo, useState } from "react";
import { View, Text, FlatList, Pressable, ActivityIndicator, RefreshControl, TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useInfiniteQuery } from "@tanstack/react-query";
import { FileEdit, Search, X, Plus, Eye, ShieldOff, AlertCircle } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import { usePageRights } from "@/hooks/usePageRights";
import { getAmendments, STATUS_COLOR, DOC_TYPE_LABEL, type Amendment } from "@/api/amendmentsApi";
import { AmendmentFormModal } from "./amendment/AmendmentFormModal";
import { AmendmentDetailModal } from "./amendment/AmendmentDetailModal";

const PAGE_SIZE = 15;
const STATUS_TABS = ["All", "Draft", "Pending", "Approved", "Rejected"];

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function AmendmentCard({ amd, onView }: { amd: Amendment; onView: () => void }) {
  const statusColor = STATUS_COLOR[amd.Status] ?? STATUS_COLOR.Draft;
  return (
    <Pressable onPress={onView} className="rounded-2xl p-3.5 mb-2.5" style={{ backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: `${colors.border}99` }}>
      <View className="flex-row items-start justify-between gap-2 mb-2">
        <Text numberOfLines={1} style={{ color: "#7c3aed", fontSize: 12.5, fontFamily: fonts.heading.bold, flex: 1, marginRight: 8 }}>{amd.AmendmentNo}</Text>
        <View className="px-1.5 py-0.5 rounded" style={{ backgroundColor: `${statusColor}1a`, borderWidth: 1, borderColor: `${statusColor}40` }}>
          <Text style={{ color: statusColor, fontSize: 8.5, fontFamily: fonts.heading.bold }}>{amd.Status}</Text>
        </View>
      </View>

      <Text style={{ color: colors.mutedForeground, fontSize: 10.5, marginBottom: 8 }}>
        {DOC_TYPE_LABEL[amd.RefDocType ?? ""] ?? amd.RefDocType} · {amd.RefDocNo} · {fmtDate(amd.AmendmentDate)}
      </Text>

      <View className="flex-row items-center justify-between mb-2">
        <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 11.5, flex: 1 }}>{amd.ProjectName || "—"}</Text>
        {amd.ValueDifference != null && (
          <Text style={{ color: amd.ValueDifference >= 0 ? "#059669" : "#e11d48", fontSize: 12.5, fontFamily: fonts.heading.bold }}>
            {amd.ValueDifference >= 0 ? "+" : ""}{formatINR(amd.ValueDifference)}
          </Text>
        )}
      </View>

      <View className="flex-row items-center justify-between pt-2" style={{ borderTopWidth: 1, borderTopColor: `${colors.border}80` }}>
        <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 10.5, flex: 1, marginRight: 8 }}>{amd.Reason || "—"}</Text>
        <Eye size={13} color={colors.mutedForeground} />
      </View>
    </Pressable>
  );
}

export default function AmendmentListScreen() {
  const insets = useSafeAreaInsets();
  const rights = usePageRights("amendments");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [refreshing, setRefreshing] = useState(false);
  const [viewingId, setViewingId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const {
    data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage, refetch,
  } = useInfiniteQuery({
    queryKey: ["amendments-mobile", statusFilter, search],
    queryFn: ({ pageParam }) => getAmendments({ page: pageParam, pageSize: PAGE_SIZE, status: statusFilter !== "All" ? statusFilter : undefined, search: search || undefined }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, pages) => (pages.length < (lastPage?.pagination?.totalPages ?? 1) ? pages.length + 1 : undefined),
    enabled: rights.canView,
  });

  const records: Amendment[] = useMemo(() => (data?.pages ?? []).flatMap((p) => p?.data ?? []), [data]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const openEdit = (id: number) => { setEditingId(id); setViewingId(null); setFormOpen(true); };

  if (!rights.canView) {
    return (
      <View className="flex-1 items-center justify-center px-8" style={{ backgroundColor: colors.background }}>
        <ShieldOff size={28} color={colors.mutedForeground} />
        <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold, marginTop: 12 }}>No access</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, marginTop: 4, textAlign: "center" }}>
          You don't have permission to view Amendments.
        </Text>
      </View>
    );
  }

  const ListHeader = (
    <View>
      <View className="flex-row items-center gap-2.5 mb-3">
        <View className="w-9 h-9 rounded-xl items-center justify-center" style={{ backgroundColor: "#7c3aed26", borderWidth: 1, borderColor: "#7c3aed4d" }}>
          <FileEdit size={16} color="#7c3aed" />
        </View>
        <Text style={{ color: colors.foreground, fontFamily: fonts.heading.bold, fontSize: 18, flex: 1 }}>Amendments</Text>
        {rights.canCreate && (
          <Pressable onPress={() => { setEditingId(null); setFormOpen(true); }} className="flex-row items-center gap-1.5 px-3 py-2 rounded-xl" style={{ backgroundColor: "#7c3aed" }}>
            <Plus size={14} color="#fff" />
            <Text style={{ color: "#fff", fontSize: 12, fontFamily: fonts.heading.semibold }}>New</Text>
          </Pressable>
        )}
      </View>

      <View className="flex-row items-center gap-2 px-3 rounded-xl mb-3" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.card}80` }}>
        <Search size={14} color={colors.mutedForeground} />
        <TextInput
          value={search} onChangeText={setSearch}
          placeholder="Search amendment no, doc no, project…"
          placeholderTextColor={`${colors.mutedForeground}99`}
          style={{ flex: 1, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13, paddingVertical: 10 }}
        />
        {!!search && <Pressable onPress={() => setSearch("")}><X size={14} color={colors.mutedForeground} /></Pressable>}
      </View>

      <View className="flex-row flex-wrap gap-1.5 mb-3">
        {STATUS_TABS.map((s) => {
          const active = statusFilter === s;
          return (
            <Pressable
              key={s} onPress={() => setStatusFilter(s)}
              className="px-3 py-1.5 rounded-full"
              style={{ borderWidth: 1, borderColor: active ? colors.primary : colors.border, backgroundColor: active ? `${colors.primary}1a` : "transparent" }}
            >
              <Text style={{ color: active ? colors.primary : colors.mutedForeground, fontSize: 11, fontFamily: fonts.heading.medium }}>{s}</Text>
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
            Failed to load Amendments. Please try again.
          </Text>
        </View>
      ) : (
        <FlatList
          data={records}
          keyExtractor={(r) => String(r.Id)}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          onEndReachedThreshold={0.4}
          onEndReached={() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage(); }}
          ListHeaderComponent={ListHeader}
          renderItem={({ item }) => <AmendmentCard amd={item} onView={() => setViewingId(item.Id)} />}
          ListEmptyComponent={
            <View className="items-center py-16">
              <AlertCircle size={20} color={`${colors.mutedForeground}80`} />
              <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, marginTop: 8 }}>No Amendments yet.</Text>
            </View>
          }
          ListFooterComponent={isFetchingNextPage ? (
            <View className="py-4 items-center"><ActivityIndicator size="small" color={colors.mutedForeground} /></View>
          ) : null}
        />
      )}

      <AmendmentFormModal visible={formOpen} editingId={editingId} onClose={() => { setFormOpen(false); setEditingId(null); }} />
      <AmendmentDetailModal
        recordId={viewingId} onClose={() => setViewingId(null)} onEdit={openEdit}
        canEdit={rights.canEdit} canDelete={rights.canDelete}
      />
    </View>
  );
}
