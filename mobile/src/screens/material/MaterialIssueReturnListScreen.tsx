// RN port of src/pages/material/IssueReturn.tsx (web) register/list view.
// Web has no server-side pagination or search for this module (small
// dataset assumption) — a single useQuery + client-side filtering mirrors
// that, unlike the useInfiniteQuery pattern used for GRN/PO/MR/Issues.
// Submit/Approve/Reject live in the detail modal rather than the card row,
// to keep the row actions consistent with the other Material list cards
// (View/Edit/Delete only).
import { useMemo, useState } from "react";
import { View, Text, FlatList, Pressable, ActivityIndicator, RefreshControl, TextInput, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Undo2, Search, X, Plus, Eye, Pencil, Trash2, ShieldOff, AlertCircle } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { usePageRights } from "@/hooks/usePageRights";
import { getIssueReturns, deleteIssueReturn, STATUS_COLOR, type IssueReturn } from "@/api/issueReturnApi";
import { IssueReturnFormModal } from "./issueReturn/IssueReturnFormModal";
import { IssueReturnDetailModal } from "./issueReturn/IssueReturnDetailModal";

const STATUS_TABS = ["All", "Draft", "Pending", "Approved", "Rejected"];

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function IssueReturnCard({
  rec, onView, onEdit, onDelete, canEdit, canDelete,
}: { rec: IssueReturn; onView: () => void; onEdit: () => void; onDelete: () => void; canEdit: boolean; canDelete: boolean }) {
  const statusColor = STATUS_COLOR[rec.Status] ?? STATUS_COLOR.Draft;
  const editable = rec.Status === "Draft";
  const deletable = rec.Status === "Draft" || rec.Status === "Rejected";
  return (
    <View className="rounded-2xl p-3.5 mb-2.5" style={{ backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: `${colors.border}99` }}>
      <View className="flex-row items-start justify-between gap-2 mb-2">
        <View className="flex-row items-center gap-1.5 flex-1 min-w-0">
          <Text numberOfLines={1} style={{ color: "#0ea5e9", fontSize: 12.5, fontFamily: fonts.heading.bold }}>{rec.DocNo || `IRN-${rec.ReturnId}`}</Text>
          <View className="px-1.5 py-0.5 rounded" style={{ backgroundColor: `${statusColor}1a`, borderWidth: 1, borderColor: `${statusColor}40` }}>
            <Text style={{ color: statusColor, fontSize: 8.5, fontFamily: fonts.heading.bold }}>{rec.Status}</Text>
          </View>
        </View>
      </View>

      <Text style={{ color: colors.mutedForeground, fontSize: 10.5, marginBottom: 6 }}>{fmtDate(rec.ReturnDate)}</Text>

      <View className="flex-row flex-wrap">
        <View style={{ width: "50%", marginBottom: 6 }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>Issue Ref</Text>
          <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 11.5, marginTop: 1 }}>{rec.IssueDocNo || "—"}</Text>
        </View>
        <View style={{ width: "50%", marginBottom: 6 }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>Company / Project</Text>
          <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 11.5, marginTop: 1 }}>{[rec.CompanyName, rec.ProjectName].filter(Boolean).join(" · ") || "—"}</Text>
        </View>
      </View>

      <View className="flex-row items-center justify-end gap-1 mt-2.5 pt-2" style={{ borderTopWidth: 1, borderTopColor: `${colors.border}80` }}>
        <Pressable onPress={onView} className="p-2 rounded-lg"><Eye size={15} color={colors.mutedForeground} /></Pressable>
        {canEdit && editable && <Pressable onPress={onEdit} className="p-2 rounded-lg"><Pencil size={15} color={colors.mutedForeground} /></Pressable>}
        {canDelete && deletable && <Pressable onPress={onDelete} className="p-2 rounded-lg"><Trash2 size={15} color={colors.destructive} /></Pressable>}
      </View>
    </View>
  );
}

export default function MaterialIssueReturnListScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const rights = usePageRights("material-issue-return");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [refreshing, setRefreshing] = useState(false);
  const [viewingId, setViewingId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const { data: records = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["issue-returns-mobile"],
    queryFn: () => getIssueReturns(),
    enabled: rights.canView,
  });

  const filtered = useMemo(() => {
    let rows = records;
    if (statusFilter !== "All") rows = rows.filter((r) => r.Status === statusFilter);
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((r) => [r.DocNo, r.IssueDocNo, r.CompanyName, r.ProjectName].some((v) => (v ?? "").toLowerCase().includes(q)));
    return rows;
  }, [records, statusFilter, search]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const openEdit = (id: number) => { setEditingId(id); setViewingId(null); setFormOpen(true); };

  const handleDelete = (rec: IssueReturn) => {
    Alert.alert("Delete Issue Return?", `${rec.DocNo || `IRN-${rec.ReturnId}`} will be permanently removed.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive", onPress: async () => {
          try {
            await deleteIssueReturn(rec.ReturnId);
            queryClient.invalidateQueries({ queryKey: ["issue-returns-mobile"], exact: false });
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
          You don't have permission to view Issue Returns.
        </Text>
      </View>
    );
  }

  const ListHeader = (
    <View>
      <View className="flex-row items-center gap-2.5 mb-3">
        <View className="w-9 h-9 rounded-xl items-center justify-center" style={{ backgroundColor: "#0ea5e926", borderWidth: 1, borderColor: "#0ea5e94d" }}>
          <Undo2 size={16} color="#0ea5e9" />
        </View>
        <Text style={{ color: colors.foreground, fontFamily: fonts.heading.bold, fontSize: 18, flex: 1 }}>Issue Returns</Text>
        {rights.canCreate && (
          <Pressable onPress={() => { setEditingId(null); setFormOpen(true); }} className="flex-row items-center gap-1.5 px-3 py-2 rounded-xl" style={{ backgroundColor: "#0ea5e9" }}>
            <Plus size={14} color="#fff" />
            <Text style={{ color: "#fff", fontSize: 12, fontFamily: fonts.heading.semibold }}>New</Text>
          </Pressable>
        )}
      </View>

      <View className="flex-row items-center gap-2 px-3 rounded-xl mb-3" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.card}80` }}>
        <Search size={14} color={colors.mutedForeground} />
        <TextInput
          value={search} onChangeText={setSearch}
          placeholder="Search return, issue ref, company, project…"
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
            Failed to load Issue Returns. Please try again.
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(r) => String(r.ReturnId)}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListHeaderComponent={ListHeader}
          renderItem={({ item }) => (
            <IssueReturnCard
              rec={item}
              onView={() => setViewingId(item.ReturnId)}
              onEdit={() => openEdit(item.ReturnId)}
              onDelete={() => handleDelete(item)}
              canEdit={rights.canEdit}
              canDelete={rights.canDelete}
            />
          )}
          ListEmptyComponent={
            <View className="items-center py-16">
              <AlertCircle size={20} color={`${colors.mutedForeground}80`} />
              <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, marginTop: 8 }}>No Issue Returns yet.</Text>
            </View>
          }
        />
      )}

      <IssueReturnFormModal visible={formOpen} editingId={editingId} onClose={() => { setFormOpen(false); setEditingId(null); }} />
      <IssueReturnDetailModal
        recordId={viewingId} onClose={() => setViewingId(null)} onEdit={openEdit}
        canEdit={rights.canEdit} canDelete={rights.canDelete}
      />
    </View>
  );
}
