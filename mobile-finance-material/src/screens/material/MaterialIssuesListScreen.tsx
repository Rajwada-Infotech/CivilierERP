// RN port of src/pages/material/Issues.tsx (web) register/list view. Card
// layout follows the same visual language as the other Material list cards.
// Web relies on the server's 400 to block editing a non-Draft/Rejected
// record; mobile hides Edit/Delete for those rows instead — a nicer
// affordance that costs nothing extra since Status is already on the row.
import { useMemo, useState } from "react";
import { View, Text, FlatList, Pressable, ActivityIndicator, RefreshControl, TextInput, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { PackageMinus, Search, X, Plus, Eye, Pencil, Trash2, ShieldOff, AlertCircle } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { usePageRights } from "@/hooks/usePageRights";
import { getMaterialIssues, deleteMaterialIssue, STATUS_COLOR, type MaterialIssue } from "@/api/issuesApi";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
import { MaterialIssueFormModal } from "./materialIssues/MaterialIssueFormModal";
import { MaterialIssueDetailModal } from "./materialIssues/MaterialIssueDetailModal";

const PAGE_SIZE = 15;
const STATUS_TABS = ["All", "Draft", "Pending", "Approved", "Rejected"];
const EDITABLE_STATUSES = new Set(["Draft", "Rejected"]);

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function IssueCard({
  issue, onView, onEdit, onDelete, canEdit, canDelete,
}: { issue: MaterialIssue; onView: () => void; onEdit: () => void; onDelete: () => void; canEdit: boolean; canDelete: boolean }) {
  const statusColor = STATUS_COLOR[issue.Status] ?? STATUS_COLOR.Pending;
  const editable = EDITABLE_STATUSES.has(issue.Status);
  return (
    <View className="rounded-2xl p-3.5 mb-2.5" style={{ backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: `${colors.border}99` }}>
      <View className="flex-row items-start justify-between gap-2 mb-2">
        <View className="flex-row items-center gap-1.5 flex-1 min-w-0">
          <Text numberOfLines={1} style={{ color: "#f97316", fontSize: 12.5, fontFamily: fonts.heading.bold }}>{issue.DocNo || issue.IssueNo || `ISS-${issue.IssueId}`}</Text>
          <View className="px-1.5 py-0.5 rounded" style={{ backgroundColor: `${statusColor}1a`, borderWidth: 1, borderColor: `${statusColor}40` }}>
            <Text style={{ color: statusColor, fontSize: 8.5, fontFamily: fonts.heading.bold }}>{issue.Status}</Text>
          </View>
        </View>
        <ApprovalStatusChain table="MaterialIssues" recordId={issue.IssueId} />
      </View>

      <Text style={{ color: colors.mutedForeground, fontSize: 10.5, marginBottom: 6 }}>{fmtDate(issue.Date)}</Text>

      <View className="flex-row flex-wrap">
        <View style={{ width: "50%", marginBottom: 6 }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>Company / Project</Text>
          <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 11.5, marginTop: 1 }}>{[issue.CompanyName, issue.ProjectName].filter(Boolean).join(" · ") || "—"}</Text>
        </View>
        <View style={{ width: "50%", marginBottom: 6 }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>Godown</Text>
          <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 11.5, marginTop: 1 }}>{[issue.GodownName, issue.GodownCode].filter(Boolean).join(" · ") || "—"}</Text>
        </View>
        <View style={{ width: "50%" }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>Items</Text>
          <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.heading.semibold, marginTop: 1 }}>
            {issue.ItemCount ?? issue.items?.length ?? 0} ({issue.TotalQty ?? 0} units)
          </Text>
        </View>
      </View>

      <View className="flex-row items-center justify-end gap-1 mt-2.5 pt-2" style={{ borderTopWidth: 1, borderTopColor: `${colors.border}80` }}>
        <Pressable onPress={onView} className="p-2 rounded-lg"><Eye size={15} color={colors.mutedForeground} /></Pressable>
        {canEdit && editable && <Pressable onPress={onEdit} className="p-2 rounded-lg"><Pencil size={15} color={colors.mutedForeground} /></Pressable>}
        {canDelete && editable && <Pressable onPress={onDelete} className="p-2 rounded-lg"><Trash2 size={15} color={colors.destructive} /></Pressable>}
      </View>
    </View>
  );
}

export default function MaterialIssuesListScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const rights = usePageRights("material-issues");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [refreshing, setRefreshing] = useState(false);
  const [viewingId, setViewingId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const {
    data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage, refetch,
  } = useInfiniteQuery({
    queryKey: ["material-issues-mobile", statusFilter],
    queryFn: ({ pageParam }) => getMaterialIssues({ page: pageParam, limit: PAGE_SIZE, status: statusFilter !== "All" ? statusFilter : undefined }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, pages) => (pages.length < (lastPage?.totalPages ?? 1) ? pages.length + 1 : undefined),
    enabled: rights.canView,
  });

  const records: MaterialIssue[] = useMemo(() => (data?.pages ?? []).flatMap((p) => p?.data ?? []), [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return records;
    return records.filter((r) => [r.DocNo, r.IssueNo, r.CompanyName, r.ProjectName, r.GodownName, r.Reason]
      .some((v) => (v ?? "").toLowerCase().includes(q)));
  }, [records, search]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handleDelete = (issue: MaterialIssue) => {
    Alert.alert(
      "Delete Material Issue?",
      `${issue.DocNo || issue.IssueNo || `ISS-${issue.IssueId}`} will be permanently removed and its stock deduction reversed.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete", style: "destructive", onPress: async () => {
            try {
              await deleteMaterialIssue(issue.IssueId);
              queryClient.invalidateQueries({ queryKey: ["material-issues-mobile"], exact: false });
            } catch (err: any) {
              Alert.alert("Failed to delete", err.message ?? "Something went wrong.");
            }
          },
        },
      ],
    );
  };

  if (!rights.canView) {
    return (
      <View className="flex-1 items-center justify-center px-8" style={{ backgroundColor: colors.background }}>
        <ShieldOff size={28} color={colors.mutedForeground} />
        <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold, marginTop: 12 }}>No access</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, marginTop: 4, textAlign: "center" }}>
          You don't have permission to view Material Issues.
        </Text>
      </View>
    );
  }

  const ListHeader = (
    <View>
      <View className="flex-row items-center gap-2.5 mb-3">
        <View className="w-9 h-9 rounded-xl items-center justify-center" style={{ backgroundColor: "#f9731626", borderWidth: 1, borderColor: "#f973164d" }}>
          <PackageMinus size={16} color="#f97316" />
        </View>
        <Text style={{ color: colors.foreground, fontFamily: fonts.heading.bold, fontSize: 18, flex: 1 }}>Material Issues</Text>
        {rights.canCreate && (
          <Pressable onPress={() => { setEditingId(null); setFormOpen(true); }} className="flex-row items-center gap-1.5 px-3 py-2 rounded-xl" style={{ backgroundColor: "#f97316" }}>
            <Plus size={14} color="#fff" />
            <Text style={{ color: "#fff", fontSize: 12, fontFamily: fonts.heading.semibold }}>New</Text>
          </Pressable>
        )}
      </View>

      <View className="flex-row items-center gap-2 px-3 rounded-xl mb-3" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.card}80` }}>
        <Search size={14} color={colors.mutedForeground} />
        <TextInput
          value={search} onChangeText={setSearch}
          placeholder="Search issue, company, project, godown…"
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
            Failed to load Material Issues. Please try again.
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(r) => String(r.IssueId)}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          onEndReachedThreshold={0.4}
          onEndReached={() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage(); }}
          ListHeaderComponent={ListHeader}
          renderItem={({ item }) => (
            <IssueCard
              issue={item}
              onView={() => setViewingId(item.IssueId)}
              onEdit={() => { setEditingId(item.IssueId); setFormOpen(true); }}
              onDelete={() => handleDelete(item)}
              canEdit={rights.canEdit}
              canDelete={rights.canDelete}
            />
          )}
          ListEmptyComponent={
            <View className="items-center py-16">
              <AlertCircle size={20} color={`${colors.mutedForeground}80`} />
              <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, marginTop: 8 }}>No Material Issues yet.</Text>
            </View>
          }
          ListFooterComponent={isFetchingNextPage ? (
            <View className="py-4 items-center"><ActivityIndicator size="small" color={colors.mutedForeground} /></View>
          ) : null}
        />
      )}

      <MaterialIssueFormModal visible={formOpen} editingId={editingId} onClose={() => { setFormOpen(false); setEditingId(null); }} />
      <MaterialIssueDetailModal recordId={viewingId} onClose={() => setViewingId(null)} />
    </View>
  );
}
