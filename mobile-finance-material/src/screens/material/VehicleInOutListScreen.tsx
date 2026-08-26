// RN port of src/pages/material/VehicleInOut.tsx (web) — first Material-
// module screen on mobile. Web's own VehicleCard component (shown below
// `sm:hidden`) is the direct template for the card here. List/detail/
// create/edit/delete are all supported (this page has no separate document
// lifecycle beyond Draft/approval, unlike Payment) — CSV import/export and
// Print stay web-only.
import { useMemo, useState } from "react";
import { View, Text, FlatList, Pressable, ActivityIndicator, RefreshControl, TextInput, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Truck, Search, X, Plus, Paperclip, Eye, Pencil, Trash2, ShieldOff, AlertCircle, SlidersHorizontal } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { usePageRights } from "@/hooks/usePageRights";
import {
  getVehicleInOuts, deleteVehicleInOut, fetchFinYearOptions,
  type VehicleInOutRecord,
} from "@/api/vehicleInOutApi";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
import { OptionPickerModal, type PickerOption } from "@/screens/finance/payment/OptionPicker";
import { VehicleInOutFormModal } from "./vehicleInOut/VehicleInOutFormModal";
import { VehicleInOutDetailModal } from "./vehicleInOut/VehicleInOutDetailModal";

const PAGE_SIZE = 15;

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-IN");
}

function fmtDateTime(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? d : dt.toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" });
}

function VehicleCard({
  rec, onView, onEdit, onDelete, canEdit, canDelete,
}: {
  rec: VehicleInOutRecord; onView: () => void; onEdit: () => void; onDelete: () => void; canEdit: boolean; canDelete: boolean;
}) {
  return (
    <View className="rounded-2xl p-3.5 mb-2.5" style={{ backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: `${colors.border}99` }}>
      <View className="flex-row items-start justify-between gap-2 mb-2">
        <View className="min-w-0">
          <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.bold }}>{rec.DocNo || "—"}</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 10.5, marginTop: 1 }}>{fmtDate(rec.DocDate)}</Text>
        </View>
        <ApprovalStatusChain table="VehicleInOut" recordId={rec.VehicleInOutID} />
      </View>

      {!!rec.AttachmentCount && rec.AttachmentCount > 0 && (
        <View className="flex-row items-center gap-1 mb-2">
          <Paperclip size={10} color={colors.mutedForeground} />
          <Text style={{ color: colors.mutedForeground, fontSize: 10 }}>{rec.AttachmentCount} attachment{rec.AttachmentCount > 1 ? "s" : ""}</Text>
        </View>
      )}

      <View className="flex-row items-center gap-2 px-3 py-2 rounded-lg mb-2" style={{ backgroundColor: `${colors.primary}0d`, borderWidth: 1, borderColor: `${colors.primary}26` }}>
        <Truck size={13} color={colors.primary} />
        <Text style={{ color: colors.primary, fontSize: 13, fontFamily: fonts.heading.semibold }}>{rec.VehicleNo || "—"}</Text>
      </View>

      <View className="flex-row flex-wrap">
        <View style={{ width: "50%", marginBottom: 6 }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>Supplier</Text>
          <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 11.5, marginTop: 1 }}>{rec.SupplierName || "—"}</Text>
        </View>
        <View style={{ width: "50%", marginBottom: 6 }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>PO No</Text>
          <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 11.5, marginTop: 1 }}>{rec.PONumber || "—"}</Text>
        </View>
        <View style={{ width: "50%" }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>Entry Time</Text>
          <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 11.5, marginTop: 1 }}>{fmtDateTime(rec.EntryTime)}</Text>
        </View>
        <View style={{ width: "50%" }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>Challan No</Text>
          <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 11.5, marginTop: 1 }}>{rec.ChallanNo || "—"}</Text>
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

export default function VehicleInOutListScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const rights = usePageRights("vehicle-in-out");
  const [search, setSearch] = useState("");
  const [finYear, setFinYear] = useState("");
  const [fyPickerOpen, setFyPickerOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [viewingId, setViewingId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const { data: finYears = [] } = useQuery({ queryKey: ["veh-list-finyears"], queryFn: fetchFinYearOptions });

  const {
    data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage, refetch,
  } = useInfiniteQuery({
    queryKey: ["vehicle-in-out-mobile", finYear],
    queryFn: ({ pageParam }) => getVehicleInOuts({ page: pageParam, limit: PAGE_SIZE, finYear: finYear || undefined }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, pages) => (pages.length < (lastPage?.totalPages ?? 1) ? pages.length + 1 : undefined),
    enabled: rights.canView,
  });

  const records: VehicleInOutRecord[] = useMemo(() => (data?.pages ?? []).flatMap((p) => p?.data ?? []), [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return records;
    return records.filter((r) => [r.DocNo, r.VehicleNo, r.ChallanNo, r.SupplierName, r.PONumber]
      .some((v) => (v ?? "").toLowerCase().includes(q)));
  }, [records, search]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handleDelete = (id: number) => {
    Alert.alert("Delete entry?", "This Vehicle In/Out record will be permanently removed.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive", onPress: async () => {
          try {
            await deleteVehicleInOut(id);
            queryClient.invalidateQueries({ queryKey: ["vehicle-in-out-mobile"], exact: false });
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
          You don't have permission to view Vehicle In/Out.
        </Text>
      </View>
    );
  }

  const finYearOptions: PickerOption[] = finYears.map((f) => ({ key: f.label, label: f.label }));

  const ListHeader = (
    <View>
      <View className="flex-row items-center gap-2.5 mb-3">
        <View className="w-9 h-9 rounded-xl items-center justify-center" style={{ backgroundColor: "#3b82f626", borderWidth: 1, borderColor: "#3b82f64d" }}>
          <Truck size={16} color="#3b82f6" />
        </View>
        <Text style={{ color: colors.foreground, fontFamily: fonts.heading.bold, fontSize: 18, flex: 1 }}>Vehicle In/Out</Text>
        {rights.canCreate && (
          <Pressable onPress={() => { setEditingId(null); setFormOpen(true); }} className="flex-row items-center gap-1.5 px-3 py-2 rounded-xl" style={{ backgroundColor: colors.primary }}>
            <Plus size={14} color="#fff" />
            <Text style={{ color: "#fff", fontSize: 12, fontFamily: fonts.heading.semibold }}>New</Text>
          </Pressable>
        )}
      </View>

      <View className="flex-row items-center gap-2 mb-3">
        <View className="flex-1 flex-row items-center gap-2 px-3 rounded-xl" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.card}80` }}>
          <Search size={14} color={colors.mutedForeground} />
          <TextInput
            value={search} onChangeText={setSearch}
            placeholder="Search doc no, vehicle, supplier, PO…"
            placeholderTextColor={`${colors.mutedForeground}99`}
            style={{ flex: 1, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13, paddingVertical: 10 }}
          />
          {!!search && <Pressable onPress={() => setSearch("")}><X size={14} color={colors.mutedForeground} /></Pressable>}
        </View>
        <Pressable
          onPress={() => setFyPickerOpen(true)}
          className="flex-row items-center gap-1.5 px-3 py-2.5 rounded-xl"
          style={{ borderWidth: 1, borderColor: finYear ? colors.primary : colors.border, backgroundColor: finYear ? `${colors.primary}1a` : "transparent" }}
        >
          <SlidersHorizontal size={14} color={finYear ? colors.primary : colors.mutedForeground} />
        </Pressable>
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
            Failed to load Vehicle In/Out records. Please try again.
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(r) => String(r.VehicleInOutID)}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          onEndReachedThreshold={0.4}
          onEndReached={() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage(); }}
          ListHeaderComponent={ListHeader}
          renderItem={({ item }) => (
            <VehicleCard
              rec={item}
              onView={() => setViewingId(item.VehicleInOutID)}
              onEdit={() => { setEditingId(item.VehicleInOutID); setFormOpen(true); }}
              onDelete={() => handleDelete(item.VehicleInOutID)}
              canEdit={rights.canEdit}
              canDelete={rights.canDelete}
            />
          )}
          ListEmptyComponent={
            <View className="items-center py-16">
              <AlertCircle size={20} color={`${colors.mutedForeground}80`} />
              <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, marginTop: 8 }}>No Vehicle In/Out entries yet.</Text>
            </View>
          }
          ListFooterComponent={isFetchingNextPage ? (
            <View className="py-4 items-center"><ActivityIndicator size="small" color={colors.mutedForeground} /></View>
          ) : null}
        />
      )}

      <OptionPickerModal
        visible={fyPickerOpen} title="Filter by Financial Year" options={finYearOptions}
        selectedKey={finYear} onSelect={(k) => { setFinYear(k); setFyPickerOpen(false); }} onClose={() => setFyPickerOpen(false)} clearable
      />

      <VehicleInOutFormModal visible={formOpen} editingId={editingId} onClose={() => { setFormOpen(false); setEditingId(null); }} />
      <VehicleInOutDetailModal recordId={viewingId} onClose={() => setViewingId(null)} />
    </View>
  );
}
