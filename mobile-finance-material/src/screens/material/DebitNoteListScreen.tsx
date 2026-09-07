// RN port of src/pages/masters/DebitNoteMaster.tsx — a mode toggle between
// the actual CRUD Debit Note table (AP discount notes against Expense
// Booking bills) and a read-only Quality Rejection Debit Notes list (a
// separate feature, see debitNoteApi.ts header comment), matching web's
// single page having both sections. No pagination on web for either list —
// same here, just a plain FlatList.
import { useMemo, useState } from "react";
import { View, Text, FlatList, Pressable, ActivityIndicator, RefreshControl, TextInput, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardMinus, Search, X, Plus, Eye, Pencil, Trash2, ShieldOff, AlertCircle } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { usePageRights } from "@/hooks/usePageRights";
import { getDebitNotes, deleteDebitNote, type DebitNote } from "@/api/debitNoteApi";
import { getQualityDebitNotes, type QualityDebitNote } from "@/api/qualityRejectionDebitNoteApi";
import { DebitNoteFormModal } from "./debitNote/DebitNoteFormModal";
import { DebitNoteDetailModal } from "./debitNote/DebitNoteDetailModal";

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function DebitNoteCard({
  note, onView, onEdit, onDelete, canEdit, canDelete,
}: { note: DebitNote; onView: () => void; onEdit: () => void; onDelete: () => void; canEdit: boolean; canDelete: boolean }) {
  return (
    <View className="rounded-2xl p-3.5 mb-2.5" style={{ backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: `${colors.border}99` }}>
      <View className="flex-row items-start justify-between gap-2 mb-2">
        <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.heading.bold, flex: 1, marginRight: 8 }}>{note.supplier_name || "—"}</Text>
        <View className="px-1.5 py-0.5 rounded" style={{ backgroundColor: note.is_active ? "#0596691a" : "#dc26261a", borderWidth: 1, borderColor: note.is_active ? "#05966940" : "#dc262640" }}>
          <Text style={{ color: note.is_active ? "#059669" : "#dc2626", fontSize: 8.5, fontFamily: fonts.heading.bold }}>{note.is_active ? "ACTIVE" : "INACTIVE"}</Text>
        </View>
      </View>

      <Text style={{ color: colors.mutedForeground, fontSize: 10.5, marginBottom: 8 }}>{fmtDate(note.DebitDate)}</Text>

      <View className="flex-row flex-wrap">
        <View style={{ width: "50%", marginBottom: 6 }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>Company / Project</Text>
          <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 11.5, marginTop: 1 }}>{[note.company_name, note.project_name].filter(Boolean).join(" · ") || "—"}</Text>
        </View>
        <View style={{ width: "50%", marginBottom: 6 }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>Total</Text>
          <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.heading.semibold, marginTop: 1 }}>{(note.TotalAmount ?? 0).toFixed(2)}</Text>
        </View>
      </View>

      <View className="flex-row items-center justify-end gap-1 mt-2 pt-2" style={{ borderTopWidth: 1, borderTopColor: `${colors.border}80` }}>
        <Pressable onPress={onView} className="p-2 rounded-lg"><Eye size={15} color={colors.mutedForeground} /></Pressable>
        {canEdit && <Pressable onPress={onEdit} className="p-2 rounded-lg"><Pencil size={15} color={colors.mutedForeground} /></Pressable>}
        {canDelete && <Pressable onPress={onDelete} className="p-2 rounded-lg"><Trash2 size={15} color={colors.destructive} /></Pressable>}
      </View>
    </View>
  );
}

function QualityDebitNoteCard({ note }: { note: QualityDebitNote }) {
  const issued = note.Status === "Issued";
  return (
    <View className="rounded-2xl p-3.5 mb-2.5" style={{ backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: `${colors.border}99` }}>
      <View className="flex-row items-start justify-between gap-2 mb-2">
        <Text numberOfLines={1} style={{ color: "#e11d48", fontSize: 12.5, fontFamily: fonts.heading.bold, flex: 1, marginRight: 8 }}>{note.DocNo}</Text>
        <View className="px-1.5 py-0.5 rounded" style={{ backgroundColor: issued ? "#0596691a" : `${colors.mutedForeground}1a`, borderWidth: 1, borderColor: issued ? "#05966940" : `${colors.mutedForeground}40` }}>
          <Text style={{ color: issued ? "#059669" : colors.mutedForeground, fontSize: 8.5, fontFamily: fonts.heading.bold }}>{note.Status.toUpperCase()}</Text>
        </View>
      </View>
      <Text style={{ color: colors.mutedForeground, fontSize: 10.5, marginBottom: 8 }}>
        {fmtDate(note.DebitDate)} · {note.GRNDocNo || note.VehicleInOutDocNo || "—"}
      </Text>
      <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 11.5, marginBottom: 6 }}>{note.ItemName || "—"} · {note.SupplierName || "—"}</Text>
      <View className="flex-row flex-wrap">
        <View style={{ width: "33%", marginBottom: 6 }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>Received</Text>
          <Text style={{ color: colors.foreground, fontSize: 11.5, marginTop: 1 }}>{note.ReceivedQty}</Text>
        </View>
        <View style={{ width: "33%", marginBottom: 6 }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>Rejected</Text>
          <Text style={{ color: colors.destructive, fontSize: 11.5, marginTop: 1 }}>{note.RejectedQty}</Text>
        </View>
        <View style={{ width: "33%", marginBottom: 6 }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>% Bad</Text>
          <Text style={{ color: "#e11d48", fontSize: 11.5, marginTop: 1 }}>{note.PercentBad}%</Text>
        </View>
      </View>
      <View className="flex-row items-center justify-between pt-2" style={{ borderTopWidth: 1, borderTopColor: `${colors.border}80` }}>
        <Text style={{ color: colors.mutedForeground, fontSize: 10.5 }}>Rate {note.Rate}</Text>
        <Text style={{ color: "#e11d48", fontSize: 13, fontFamily: fonts.heading.bold }}>{note.Amount.toFixed(2)}</Text>
      </View>
    </View>
  );
}

export default function DebitNoteListScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const rights = usePageRights("debit-note");
  const [mode, setMode] = useState<"debit" | "quality">("debit");
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [viewingId, setViewingId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const { data: notes = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["debit-notes-mobile"],
    queryFn: getDebitNotes,
    enabled: rights.canView && mode === "debit",
  });

  const { data: qualityNotes = [], isLoading: loadingQuality, isError: qualityError, refetch: refetchQuality } = useQuery({
    queryKey: ["quality-debit-notes-mobile"],
    queryFn: () => getQualityDebitNotes(),
    enabled: rights.canView && mode === "quality",
  });

  const filteredNotes = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter((n) => [n.supplier_name, n.company_name, n.project_name, n.Reason].some((v) => (v ?? "").toLowerCase().includes(q)));
  }, [notes, search]);

  const filteredQuality = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return qualityNotes;
    return qualityNotes.filter((n) => [n.DocNo, n.SupplierName, n.ItemName, n.GRNDocNo, n.VehicleInOutDocNo].some((v) => (v ?? "").toLowerCase().includes(q)));
  }, [qualityNotes, search]);

  const onRefresh = async () => {
    setRefreshing(true);
    await (mode === "debit" ? refetch() : refetchQuality());
    setRefreshing(false);
  };

  const handleDelete = (note: DebitNote) => {
    Alert.alert("Delete Debit Note?", `${note.supplier_name || "This debit note"} will be permanently removed.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive", onPress: async () => {
          try {
            await deleteDebitNote(note.id);
            queryClient.invalidateQueries({ queryKey: ["debit-notes-mobile"], exact: false });
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
          You don't have permission to view Debit Notes.
        </Text>
      </View>
    );
  }

  const ListHeader = (
    <View>
      <View className="flex-row items-center gap-2.5 mb-3">
        <View className="w-9 h-9 rounded-xl items-center justify-center" style={{ backgroundColor: "#dc262626", borderWidth: 1, borderColor: "#dc26264d" }}>
          <ClipboardMinus size={16} color="#dc2626" />
        </View>
        <Text style={{ color: colors.foreground, fontFamily: fonts.heading.bold, fontSize: 18, flex: 1 }}>Debit Notes</Text>
        {mode === "debit" && rights.canCreate && (
          <Pressable onPress={() => { setEditingId(null); setFormOpen(true); }} className="flex-row items-center gap-1.5 px-3 py-2 rounded-xl" style={{ backgroundColor: "#dc2626" }}>
            <Plus size={14} color="#fff" />
            <Text style={{ color: "#fff", fontSize: 12, fontFamily: fonts.heading.semibold }}>New</Text>
          </Pressable>
        )}
      </View>

      <View className="flex-row rounded-xl mb-3 p-1" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.card}80` }}>
        {([["debit", "Debit Notes"], ["quality", "Quality Rejections"]] as const).map(([key, label]) => {
          const active = mode === key;
          return (
            <Pressable key={key} onPress={() => setMode(key)} className="flex-1 items-center py-2 rounded-lg" style={{ backgroundColor: active ? colors.primary : "transparent" }}>
              <Text style={{ color: active ? "#fff" : colors.mutedForeground, fontSize: 12, fontFamily: fonts.heading.semibold }}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View className="flex-row items-center gap-2 px-3 rounded-xl mb-3" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.card}80` }}>
        <Search size={14} color={colors.mutedForeground} />
        <TextInput
          value={search} onChangeText={setSearch}
          placeholder={mode === "debit" ? "Search supplier, company, project…" : "Search doc no, supplier, item…"}
          placeholderTextColor={`${colors.mutedForeground}99`}
          style={{ flex: 1, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13, paddingVertical: 10 }}
        />
        {!!search && <Pressable onPress={() => setSearch("")}><X size={14} color={colors.mutedForeground} /></Pressable>}
      </View>
    </View>
  );

  const loading = mode === "debit" ? isLoading : loadingQuality;
  const errored = mode === "debit" ? isError : qualityError;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {loading ? (
        <View className="flex-1 items-center justify-center"><ActivityIndicator color={colors.mutedForeground} /></View>
      ) : errored ? (
        <View className="flex-1 items-center justify-center px-8">
          <AlertCircle size={20} color={colors.destructive} />
          <Text style={{ color: colors.destructive, fontSize: 12, fontFamily: fonts.body.medium, marginTop: 8, textAlign: "center" }}>
            Failed to load. Please try again.
          </Text>
        </View>
      ) : mode === "debit" ? (
        <FlatList
          data={filteredNotes}
          keyExtractor={(r) => String(r.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListHeaderComponent={ListHeader}
          renderItem={({ item }) => (
            <DebitNoteCard
              note={item} onView={() => setViewingId(item.id)}
              onEdit={() => { setEditingId(item.id); setFormOpen(true); }}
              onDelete={() => handleDelete(item)}
              canEdit={rights.canEdit} canDelete={rights.canDelete}
            />
          )}
          ListEmptyComponent={
            <View className="items-center py-16">
              <AlertCircle size={20} color={`${colors.mutedForeground}80`} />
              <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, marginTop: 8 }}>No Debit Notes yet.</Text>
            </View>
          }
        />
      ) : (
        <FlatList
          data={filteredQuality}
          keyExtractor={(r) => String(r.DebitNoteId)}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListHeaderComponent={ListHeader}
          renderItem={({ item }) => <QualityDebitNoteCard note={item} />}
          ListEmptyComponent={
            <View className="items-center py-16">
              <AlertCircle size={20} color={`${colors.mutedForeground}80`} />
              <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, marginTop: 8 }}>No Quality Rejection Debit Notes yet.</Text>
            </View>
          }
        />
      )}

      <DebitNoteFormModal visible={formOpen} editingId={editingId} onClose={() => { setFormOpen(false); setEditingId(null); }} />
      <DebitNoteDetailModal recordId={viewingId} onClose={() => setViewingId(null)} />
    </View>
  );
}
