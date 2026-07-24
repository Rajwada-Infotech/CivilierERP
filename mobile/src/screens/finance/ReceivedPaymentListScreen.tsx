// RN port of src/pages/finance/ReceivedPayment.tsx (web). Web's `sm:hidden`
// mobile-collapsed card block is the direct template for ReceivedPaymentCard
// below. Filters (search/mode/status) are client-side over whatever pages
// have been loaded so far, matching web's own `filtered` array (web filters
// only the current page too — getReceivedPayments has no filter params on
// either side). List/detail/create/edit/delete/approve/reject are all
// supported now — print stays web-only, see
// ReceivedPaymentFormModal.tsx's header comment.
import { useEffect, useMemo, useState } from "react";
import { View, Text, FlatList, Pressable, ActivityIndicator, RefreshControl, TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ArrowDownCircle, CheckCircle2, Clock, IndianRupee, Search, X, ShieldOff, AlertCircle, Plus, SlidersHorizontal } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import { usePageRights } from "@/hooks/usePageRights";
import { getReceivedPayments, dbToRecord, PAYMENT_MODES, type ReceivedPayment, type ReceivedPaymentRecord } from "@/api/receivedPaymentApi";
import type { MainStackParamList } from "@/navigation/MainStack";
import { StatusBadge } from "./payment/PaymentBadges";
import { ModeBadge } from "./receivedPayment/ReceivedPaymentBadges";
import { OptionPickerModal, type PickerOption } from "./payment/OptionPicker";
import { ReceivedPaymentDetailModal } from "./receivedPayment/ReceivedPaymentDetailModal";
import { ReceivedPaymentFormModal } from "./receivedPayment/ReceivedPaymentFormModal";

const PAGE_SIZE = 20;
const STATUSES = ["Draft", "Pending", "Approved", "Rejected"];

function StatTile({ label, value, icon: Icon, accent, wide }: {
  label: string; value: string; icon: React.ComponentType<{ size?: number; color?: string }>; accent: string; wide?: boolean;
}) {
  return (
    <View style={{ width: wide ? "100%" : "48%", marginBottom: 10 }} className="rounded-xl overflow-hidden">
      <View
        className="flex-row items-center gap-2.5 px-3.5 py-3"
        style={{ backgroundColor: `${colors.card}b3`, borderWidth: 1, borderColor: `${colors.border}80`, borderLeftWidth: 3, borderLeftColor: accent }}
      >
        <View className="w-8 h-8 rounded-lg items-center justify-center" style={{ backgroundColor: `${accent}26`, borderWidth: 1, borderColor: `${accent}4d` }}>
          <Icon size={14} color={accent} />
        </View>
        <View className="flex-1 min-w-0">
          <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.regular }}>{label}</Text>
          <Text numberOfLines={1} style={{ color: colors.foreground, fontFamily: fonts.heading.bold, fontSize: 15, marginTop: 1 }}>{value}</Text>
        </View>
      </View>
    </View>
  );
}

function ReceivedPaymentCard({ rec, onPress }: { rec: ReceivedPayment; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="rounded-2xl p-3.5 mb-2.5"
      style={{ backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: `${colors.border}99` }}
    >
      <View className="flex-row items-start justify-between gap-2 mb-1.5">
        <View className="flex-1 min-w-0">
          <Text style={{ color: colors.primary, fontSize: 10.5, fontFamily: fonts.heading.medium }}>{rec.docNo}</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 9.5, marginTop: 1 }}>{rec.companyName} · {rec.finYear}</Text>
          <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.semibold, marginTop: 2 }}>
            {rec.customerName || rec.receivedFrom}
          </Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 10.5, marginTop: 1 }}>{rec.projectName} · {rec.docDate || "—"}</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={{ color: "#10b981", fontSize: 14.5, fontFamily: fonts.heading.bold }}>+{formatINR(rec.amount)}</Text>
          <View style={{ marginTop: 4 }}><StatusBadge status={rec.status} /></View>
        </View>
      </View>
      <View className="flex-row items-center justify-between mt-1.5 pt-1.5" style={{ borderTopWidth: 1, borderTopColor: `${colors.border}80` }}>
        <ModeBadge mode={rec.mode} />
        <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.regular }}>Tap to view →</Text>
      </View>
    </Pressable>
  );
}

export default function ReceivedPaymentListScreen() {
  const insets = useSafeAreaInsets();
  const rights = usePageRights("received-payment");
  const route = useRoute<RouteProp<MainStackParamList, "ReceivedPayment">>();
  const [search, setSearch] = useState("");
  const [modeFilter, setModeFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [picker, setPicker] = useState<"mode" | "status" | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [viewingRec, setViewingRec] = useState<ReceivedPayment | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingRec, setEditingRec] = useState<ReceivedPayment | null>(null);

  // Lets FinanceDashboardScreen's "New Received" quick action jump straight
  // into the form instead of just landing on the list.
  useEffect(() => {
    if (route.params?.openForm && rights.canCreate) setFormOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.openForm]);

  const {
    data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage, refetch,
  } = useInfiniteQuery({
    queryKey: ["received-payments-mobile"],
    queryFn: ({ pageParam }) => getReceivedPayments(pageParam, PAGE_SIZE),
    initialPageParam: 1,
    getNextPageParam: (lastPage, pages) => (pages.length < (lastPage?.totalPages ?? 1) ? pages.length + 1 : undefined),
    enabled: rights.canView,
  });

  const records: ReceivedPayment[] = useMemo(() => {
    const items: ReceivedPaymentRecord[] = (data?.pages ?? []).flatMap((p) => (Array.isArray(p?.data) ? p.data : []));
    return items.map(dbToRecord);
  }, [data]);

  const totalCount = data?.pages?.[data.pages.length - 1]?.total ?? 0;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records.filter((p) => {
      const matchSearch = !q || [p.customerName, p.receivedFrom, p.projectName, p.companyName, p.docNo, p.id]
        .some((v) => (v ?? "").toLowerCase().includes(q));
      return matchSearch && (modeFilter === "All" || p.mode === modeFilter) && (statusFilter === "All" || p.status === statusFilter);
    });
  }, [records, search, modeFilter, statusFilter]);

  const totalReceived = useMemo(() => records.reduce((s, p) => s + p.amount, 0), [records]);
  const approvedCount = useMemo(() => records.filter((p) => p.status === "Approved").length, [records]);
  const pendingCount = useMemo(() => records.filter((p) => p.status === "Pending").length, [records]);

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
          You don't have permission to view received payments.
        </Text>
      </View>
    );
  }

  const modeOptions: PickerOption[] = [{ key: "All", label: "All Modes" }, ...PAYMENT_MODES.map((m) => ({ key: m, label: m }))];
  const statusOptions: PickerOption[] = [{ key: "All", label: "All Statuses" }, ...STATUSES.map((s) => ({ key: s, label: s }))];

  const ListHeader = (
    <View>
      <View className="flex-row items-center gap-2.5 mb-3">
        <View className="w-9 h-9 rounded-xl items-center justify-center" style={{ backgroundColor: "#10b98126", borderWidth: 1, borderColor: "#10b9814d" }}>
          <ArrowDownCircle size={16} color="#10b981" />
        </View>
        <Text style={{ color: colors.foreground, fontFamily: fonts.heading.bold, fontSize: 19, flex: 1 }}>Received Payments</Text>
        {rights.canCreate && (
          <Pressable onPress={() => setFormOpen(true)} className="flex-row items-center gap-1.5 px-3 py-2 rounded-xl" style={{ backgroundColor: "#10b981" }}>
            <Plus size={14} color="#fff" />
            <Text style={{ color: "#fff", fontSize: 12, fontFamily: fonts.heading.semibold }}>New</Text>
          </Pressable>
        )}
      </View>

      <View className="flex-row flex-wrap justify-between mb-3">
        <StatTile label="Total Received" value={formatINR(totalReceived)} icon={IndianRupee} accent="#10b981" wide />
        <StatTile label="Total Entries" value={String(totalCount)} icon={ArrowDownCircle} accent={colors.primary} />
        <StatTile label="Cleared" value={String(approvedCount)} icon={CheckCircle2} accent="#10b981" />
        <StatTile label="Submitted" value={String(pendingCount)} icon={Clock} accent="#d97706" wide />
      </View>

      <View className="flex-row items-center gap-2 mb-3">
        <View className="flex-1 flex-row items-center gap-2 px-3 rounded-xl" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.card}80` }}>
          <Search size={14} color={colors.mutedForeground} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search customer, project, doc no…"
            placeholderTextColor={`${colors.mutedForeground}99`}
            style={{ flex: 1, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13, paddingVertical: 10 }}
          />
          {!!search && (
            <Pressable onPress={() => setSearch("")}><X size={14} color={colors.mutedForeground} /></Pressable>
          )}
        </View>
      </View>

      <View className="flex-row gap-2 mb-2">
        <Pressable
          onPress={() => setPicker("mode")}
          className="flex-1 flex-row items-center justify-between px-3 py-2.5 rounded-xl"
          style={{ borderWidth: 1, borderColor: modeFilter !== "All" ? colors.primary : colors.border, backgroundColor: modeFilter !== "All" ? `${colors.primary}1a` : "transparent" }}
        >
          <Text style={{ color: modeFilter !== "All" ? colors.primary : colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.medium }}>
            {modeFilter === "All" ? "Mode: All" : modeFilter}
          </Text>
          <SlidersHorizontal size={13} color={modeFilter !== "All" ? colors.primary : colors.mutedForeground} />
        </Pressable>
        <Pressable
          onPress={() => setPicker("status")}
          className="flex-1 flex-row items-center justify-between px-3 py-2.5 rounded-xl"
          style={{ borderWidth: 1, borderColor: statusFilter !== "All" ? colors.primary : colors.border, backgroundColor: statusFilter !== "All" ? `${colors.primary}1a` : "transparent" }}
        >
          <Text style={{ color: statusFilter !== "All" ? colors.primary : colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.medium }}>
            {statusFilter === "All" ? "Status: All" : statusFilter}
          </Text>
          <SlidersHorizontal size={13} color={statusFilter !== "All" ? colors.primary : colors.mutedForeground} />
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
            Failed to load received payments. Please try again.
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          onEndReachedThreshold={0.4}
          onEndReached={() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage(); }}
          ListHeaderComponent={ListHeader}
          renderItem={({ item }) => <ReceivedPaymentCard rec={item} onPress={() => setViewingRec(item)} />}
          ListEmptyComponent={
            <View className="items-center py-16">
              <AlertCircle size={20} color={`${colors.mutedForeground}80`} />
              <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, marginTop: 8 }}>No received payments yet.</Text>
            </View>
          }
          ListFooterComponent={isFetchingNextPage ? (
            <View className="py-4 items-center"><ActivityIndicator size="small" color={colors.mutedForeground} /></View>
          ) : null}
        />
      )}

      <OptionPickerModal visible={picker === "mode"} title="Filter by Mode" options={modeOptions} selectedKey={modeFilter} onSelect={(k) => { setModeFilter(k); setPicker(null); }} onClose={() => setPicker(null)} />
      <OptionPickerModal visible={picker === "status"} title="Filter by Status" options={statusOptions} selectedKey={statusFilter} onSelect={(k) => { setStatusFilter(k); setPicker(null); }} onClose={() => setPicker(null)} />

      <ReceivedPaymentDetailModal
        record={viewingRec}
        onClose={() => setViewingRec(null)}
        onEdit={rights.canEdit ? (rec) => { setViewingRec(null); setEditingRec(rec); } : undefined}
        onDeleted={() => setViewingRec(null)}
        canDelete={rights.canDelete}
      />
      <ReceivedPaymentFormModal
        visible={formOpen || !!editingRec}
        onClose={() => { setFormOpen(false); setEditingRec(null); }}
        editingRecord={editingRec}
      />
    </View>
  );
}
