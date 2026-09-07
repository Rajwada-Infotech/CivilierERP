// RN port of src/pages/material/MaterialRequest.tsx (web) register/list view.
// Card layout follows the same visual language as GRN/PO/VIO list cards.
import { useMemo, useState } from "react";
import { View, Text, FlatList, Pressable, ActivityIndicator, RefreshControl, TextInput, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Search, X, Plus, Eye, Pencil, Trash2, ShieldOff, AlertCircle } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { usePageRights } from "@/hooks/usePageRights";
import { getMaterialRequests, deleteMaterialRequest, PRIORITY_COLOR, type MaterialRequest } from "@/api/materialRequestApi";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
import { MaterialRequestFormModal } from "./materialRequest/MaterialRequestFormModal";
import { MaterialRequestDetailModal } from "./materialRequest/MaterialRequestDetailModal";

const PAGE_SIZE = 15;
const STATUS_TABS = ["All", "Pending", "Approved", "Rejected"];

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function MRCard({
  mr, onView, onEdit, onDelete, canEdit, canDelete,
}: { mr: MaterialRequest; onView: () => void; onEdit: () => void; onDelete: () => void; canEdit: boolean; canDelete: boolean }) {
  const priorityColor = PRIORITY_COLOR[mr.Priority || "Normal"] ?? PRIORITY_COLOR.Normal;
  return (
    <View className="rounded-2xl p-3.5 mb-2.5" style={{ backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: `${colors.border}99` }}>
      <View className="flex-row items-start justify-between gap-2 mb-2">
        <View className="flex-row items-center gap-1.5 flex-1 min-w-0">
          <Text numberOfLines={1} style={{ color: "#10b981", fontSize: 12.5, fontFamily: fonts.heading.bold }}>{mr.DocNo || `MR-${mr.MRId}`}</Text>
          <View className="px-1.5 py-0.5 rounded" style={{ backgroundColor: `${priorityColor}1a`, borderWidth: 1, borderColor: `${priorityColor}40` }}>
            <Text style={{ color: priorityColor, fontSize: 8.5, fontFamily: fonts.heading.bold }}>{mr.Priority || "Normal"}</Text>
          </View>
        </View>
        <ApprovalStatusChain table="MaterialRequests" recordId={mr.MRId} />
      </View>

      <Text style={{ color: colors.mutedForeground, fontSize: 10.5, marginBottom: 6 }}>{fmtDate(mr.RequestDate)}</Text>

      <View className="flex-row flex-wrap">
        <View style={{ width: "50%", marginBottom: 6 }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>Company / Project</Text>
          <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 11.5, marginTop: 1 }}>{[mr.CompanyName, mr.ProjectName].filter(Boolean).join(" · ") || "—"}</Text>
        </View>
        <View style={{ width: "50%", marginBottom: 6 }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>Required By</Text>
          <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 11.5, marginTop: 1 }}>{fmtDate(mr.RequiredByDate)}</Text>
        </View>
        <View style={{ width: "50%" }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>Items</Text>
          <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.heading.semibold, marginTop: 1 }}>
            {mr.ItemCount ?? mr.items?.length ?? 0} ({mr.TotalQty ?? 0} units)
          </Text>
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

export default function MaterialRequestListScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const rights = usePageRights("material-request");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [refreshing, setRefreshing] = useState(false);
  const [viewingId, setViewingId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const {
    data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage, refetch,
  } = useInfiniteQuery({
    queryKey: ["material-requests-mobile", statusFilter],
    queryFn: ({ pageParam }) => getMaterialRequests({ page: pageParam, limit: PAGE_SIZE, status: statusFilter !== "All" ? statusFilter : undefined }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, pages) => (pages.length < (lastPage?.totalPages ?? 1) ? pages.length + 1 : undefined),
    enabled: rights.canView,
  });

  const records: MaterialRequest[] = useMemo(() => (data?.pages ?? []).flatMap((p) => p?.data ?? []), [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return records;
    return records.filter((r) => [r.DocNo, r.CompanyName, r.ProjectName, r.Reason]
      .some((v) => (v ?? "").toLowerCase().includes(q)));
  }, [records, search]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handleDelete = (mr: MaterialRequest) => {
    Alert.alert("Delete Material Request?", `${mr.DocNo || `MR-${mr.MRId}`} will be permanently removed.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive", onPress: async () => {
          try {
            await deleteMaterialRequest(mr.MRId);
            queryClient.invalidateQueries({ queryKey: ["material-requests-mobile"], exact: false });
          } catch (err: any) {
            Alert.alert("Failed to delete", err.message ?? "Something went wrong.");
          }
        },
      },
    ]);
  };

  if (!rights.canView) {
    return (
      <View className="flex-1 items-center justify-center px-8" style={{ backgroundColor: colors.background }}>
        <ShieldOff size={28} color={colors.mutedForeground} />
        <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold, marginTop: 12 }}>No access</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, marginTop: 4, textAlign: "center" }}>
          You don't have permission to view Material Requests.
        </Text>
      </View>
    );
  }

  const ListHeader = (
    <View>
      <View className="flex-row items-center gap-2.5 mb-3">
        <View className="w-9 h-9 rounded-xl items-center justify-center" style={{ backgroundColor: "#10b98126", borderWidth: 1, borderColor: "#10b9814d" }}>
          <ClipboardList size={16} color="#10b981" />
        </View>
        <Text style={{ color: colors.foreground, fontFamily: fonts.heading.bold, fontSize: 18, flex: 1 }}>Material Requests</Text>
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
          placeholder="Search MR, company, project, reason…"
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
            Failed to load Material Requests. Please try again.
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(r) => String(r.MRId)}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          onEndReachedThreshold={0.4}
          onEndReached={() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage(); }}
          ListHeaderComponent={ListHeader}
          renderItem={({ item }) => (
            <MRCard
              mr={item}
              onView={() => setViewingId(item.MRId)}
              onEdit={() => { setEditingId(item.MRId); setFormOpen(true); }}
              onDelete={() => handleDelete(item)}
              canEdit={rights.canEdit}
              canDelete={rights.canDelete}
            />
          )}
          ListEmptyComponent={
            <View className="items-center py-16">
              <AlertCircle size={20} color={`${colors.mutedForeground}80`} />
              <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, marginTop: 8 }}>No Material Requests yet.</Text>
            </View>
          }
          ListFooterComponent={isFetchingNextPage ? (
            <View className="py-4 items-center"><ActivityIndicator size="small" color={colors.mutedForeground} /></View>
          ) : null}
        />
      )}

      <MaterialRequestFormModal visible={formOpen} editingId={editingId} onClose={() => { setFormOpen(false); setEditingId(null); }} />
      <MaterialRequestDetailModal recordId={viewingId} onClose={() => setViewingId(null)} />
    </View>
  );
}
