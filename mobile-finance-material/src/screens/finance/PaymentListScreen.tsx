// RN port of src/pages/finance/Payment.tsx (web). Web's mobile-collapsed
// card list (Payment.tsx, the `sm:hidden divide-y` block) is the direct
// template for PaymentCard below, since the desktop <table> has no native-
// screen equivalent. Summary stat tiles (Total Paid / By Cheque / By Cash)
// mirror web's client-side reduce over the loaded records. List/detail/
// create/edit/delete/approve/reject, GL-posting, and Print are all
// supported now — see PaymentDetailModal.tsx's and PaymentFormModal.tsx's
// header comments for what's still deferred (Contract-linking, on-account
// auto-apply, GST/partial-payment breakdown preview, and list export).
import { useEffect, useMemo, useState } from "react";
import { View, Text, FlatList, Pressable, ActivityIndicator, RefreshControl, TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Wallet, SlidersHorizontal, AlertCircle, Search, X, ShieldOff, Plus, Banknote, Clock, CheckCircle2 } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import { usePageRights } from "@/hooks/usePageRights";
import { getPayments, dbToRecord, type PaymentRecord, type DbPayment } from "@/api/newPaymentApi";
import type { MainStackParamList } from "@/navigation/MainStack";
import { StatusBadge, ModeBadge } from "./payment/PaymentBadges";
import { FilterSheet, BLANK_FILTERS, type PaymentFilters } from "./payment/FilterSheet";
import { PaymentDetailModal } from "./payment/PaymentDetailModal";
import { PaymentFormModal, type ReissueContext } from "./payment/PaymentFormModal";

const PAGE_SIZE = 20;

function activeFilterCount(f: PaymentFilters) {
  return Object.values(f).filter(Boolean).length;
}

function StatTile({ label, value, icon: Icon, accent }: {
  label: string; value: string; icon: React.ComponentType<{ size?: number; color?: string }>; accent: string;
}) {
  return (
    <View style={{ width: "32%" }} className="rounded-xl overflow-hidden">
      <View
        className="items-start gap-1.5 px-3 py-2.5"
        style={{ backgroundColor: `${colors.card}b3`, borderWidth: 1, borderColor: `${colors.border}80`, borderLeftWidth: 3, borderLeftColor: accent }}
      >
        <View className="w-7 h-7 rounded-lg items-center justify-center" style={{ backgroundColor: `${accent}26`, borderWidth: 1, borderColor: `${accent}4d` }}>
          <Icon size={13} color={accent} />
        </View>
        <Text numberOfLines={1} style={{ color: colors.foreground, fontFamily: fonts.heading.bold, fontSize: 13, marginTop: 2 }}>{value}</Text>
        <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 9.5, fontFamily: fonts.body.regular }}>{label}</Text>
      </View>
    </View>
  );
}

function refBadge(rec: PaymentRecord) {
  if (rec.chequeNo) return { label: `Chq #${rec.chequeNo}`, color: "#3b82f6" };
  if (rec.neftNumber) return { label: rec.neftNumber, color: "#06b6d4" };
  if (rec.upiTransactionId) return { label: rec.upiTransactionId, color: "#8b5cf6" };
  if (rec.rtgsReference) return { label: rec.rtgsReference, color: "#f97316" };
  if (rec.impsReference) return { label: rec.impsReference, color: "#ec4899" };
  if (rec.cardReference) return { label: rec.cardReference, color: "#f59e0b" };
  return null;
}

function PaymentCard({ rec, onPress }: { rec: PaymentRecord; onPress: () => void }) {
  const ref = refBadge(rec);
  return (
    <Pressable
      onPress={onPress}
      className="rounded-2xl p-3.5 mb-2.5"
      style={{ backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: `${colors.border}99` }}
    >
      <View className="flex-row items-center justify-between gap-2 mb-1.5">
        <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.semibold, flex: 1 }}>
          {rec.paymentName || "—"}
        </Text>
        <ModeBadge mode={rec.mode} />
      </View>

      {!!rec.paidTo && (
        <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular, marginBottom: 6 }}>
          Paid to <Text style={{ color: colors.foreground, fontFamily: fonts.body.medium }}>{rec.paidTo}</Text>
        </Text>
      )}

      <View className="flex-row flex-wrap gap-1.5 mb-2">
        {!!rec.docNo && (
          <View className="px-2 py-0.5 rounded-md" style={{ backgroundColor: "#05966915", borderWidth: 1, borderColor: "#05966930" }}>
            <Text style={{ color: "#059669", fontSize: 10, fontFamily: fonts.body.medium }}>{rec.docNo}</Text>
          </View>
        )}
        {!!rec.expenseRef && (
          <View className="px-2 py-0.5 rounded-md" style={{ backgroundColor: `${colors.primary}15`, borderWidth: 1, borderColor: `${colors.primary}30` }}>
            <Text style={{ color: colors.primary, fontSize: 10, fontFamily: fonts.body.medium }}>{rec.expenseRef}</Text>
          </View>
        )}
        {ref && (
          <View className="px-2 py-0.5 rounded-md" style={{ backgroundColor: `${ref.color}15`, borderWidth: 1, borderColor: `${ref.color}30` }}>
            <Text numberOfLines={1} style={{ color: ref.color, fontSize: 10, fontFamily: fonts.body.medium, maxWidth: 160 }}>{ref.label}</Text>
          </View>
        )}
      </View>

      <View className="flex-row items-center justify-between">
        <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.body.regular }}>{rec.date || "—"}</Text>
        <Text style={{ color: colors.foreground, fontSize: 13.5, fontFamily: fonts.heading.bold }}>{formatINR(rec.amount ?? 0)}</Text>
      </View>

      <View className="flex-row items-center justify-between mt-2 pt-2" style={{ borderTopWidth: 1, borderTopColor: `${colors.border}80` }}>
        <StatusBadge status={rec.status} />
        <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.regular }}>Tap to view →</Text>
      </View>
    </Pressable>
  );
}

export default function PaymentListScreen() {
  const insets = useSafeAreaInsets();
  const rights = usePageRights("new-payment");
  const route = useRoute<RouteProp<MainStackParamList, "Payment">>();
  const [filters, setFilters] = useState<PaymentFilters>(BLANK_FILTERS);
  const [docSearch, setDocSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [viewingRec, setViewingRec] = useState<PaymentRecord | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingRec, setEditingRec] = useState<PaymentRecord | null>(null);
  const [reissueCtx, setReissueCtx] = useState<ReissueContext | null>(null);

  // Lets FinanceDashboardScreen's "New Payment" quick action jump straight
  // into the form instead of just landing on the list.
  useEffect(() => {
    if (route.params?.openForm && rights.canCreate) setFormOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.openForm]);

  // Lets BrsScreen's "Re-issue" action on a bounced entry jump straight
  // into a prefilled New Payment form, mirroring web's location.state flow.
  useEffect(() => {
    if (route.params?.reissue && rights.canCreate) setReissueCtx(route.params.reissue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.reissue]);

  const effectiveFilters = useMemo(() => ({ ...filters, docNumber: docSearch || filters.docNumber }), [filters, docSearch]);

  const {
    data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage, refetch,
  } = useInfiniteQuery({
    queryKey: ["payments-mobile", effectiveFilters],
    queryFn: ({ pageParam }) =>
      getPayments(
        pageParam,
        PAGE_SIZE,
        effectiveFilters.supplier,
        effectiveFilters.company,
        effectiveFilters.project,
        effectiveFilters.finYear,
        effectiveFilters.docNumber,
      ),
    initialPageParam: 1,
    getNextPageParam: (lastPage, pages) => {
      const totalPages = lastPage?.totalPages ?? 1;
      return pages.length < totalPages ? pages.length + 1 : undefined;
    },
    enabled: rights.canView,
  });

  const records: PaymentRecord[] = useMemo(() => {
    const items: DbPayment[] = (data?.pages ?? []).flatMap((p) => (Array.isArray(p?.data) ? p.data : []));
    return items.map(dbToRecord);
  }, [data]);

  // Client-side over the currently loaded records, matching web's totalAmount/
  // chequeCount/cashCount (Payment.tsx:815-819) — both sides compute over
  // whatever page(s) of data are in memory, not a separate server aggregate.
  const totalAmount = useMemo(() => records.reduce((s, r) => s + (r.amount ?? 0), 0), [records]);
  const chequeCount = useMemo(() => records.filter((r) => r.mode === "Cheque" || r.mode === "Post-Dated Cheque").length, [records]);
  const cashCount = useMemo(() => records.filter((r) => r.mode === "Cash").length, [records]);

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
          You don't have permission to view payments.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View className="px-4 pt-4 pb-2">
        <View className="flex-row items-center gap-2.5 mb-3">
          <View className="w-9 h-9 rounded-xl items-center justify-center" style={{ backgroundColor: "#3b82f626", borderWidth: 1, borderColor: "#3b82f64d" }}>
            <Wallet size={16} color="#3b82f6" />
          </View>
          <Text style={{ color: colors.foreground, fontFamily: fonts.heading.bold, fontSize: 19, flex: 1 }}>Payments</Text>
          {rights.canCreate && (
            <Pressable
              onPress={() => setFormOpen(true)}
              className="flex-row items-center gap-1.5 px-3 py-2 rounded-xl"
              style={{ backgroundColor: colors.primary }}
            >
              <Plus size={14} color="#fff" />
              <Text style={{ color: "#fff", fontSize: 12, fontFamily: fonts.heading.semibold }}>New Payment</Text>
            </Pressable>
          )}
        </View>

        <View className="flex-row justify-between mb-3">
          <StatTile label="Total Paid" value={formatINR(totalAmount)} icon={Banknote} accent={colors.primary} />
          <StatTile label="By Cheque" value={String(chequeCount)} icon={Clock} accent="#f59e0b" />
          <StatTile label="By Cash" value={String(cashCount)} icon={CheckCircle2} accent="#10b981" />
        </View>

        <View className="flex-row items-center gap-2">
          <View
            className="flex-1 flex-row items-center gap-2 px-3 rounded-xl"
            style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.card}80` }}
          >
            <Search size={14} color={colors.mutedForeground} />
            <TextInput
              value={docSearch}
              onChangeText={setDocSearch}
              placeholder="Search doc no…"
              placeholderTextColor={`${colors.mutedForeground}99`}
              style={{ flex: 1, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13, paddingVertical: 10 }}
            />
            {!!docSearch && (
              <Pressable onPress={() => setDocSearch("")}>
                <X size={14} color={colors.mutedForeground} />
              </Pressable>
            )}
          </View>
          <Pressable
            onPress={() => setFilterOpen(true)}
            className="flex-row items-center gap-1.5 px-3 py-2.5 rounded-xl"
            style={{ borderWidth: 1, borderColor: activeFilterCount(filters) ? colors.primary : colors.border, backgroundColor: activeFilterCount(filters) ? `${colors.primary}1a` : "transparent" }}
          >
            <SlidersHorizontal size={14} color={activeFilterCount(filters) ? colors.primary : colors.mutedForeground} />
            {activeFilterCount(filters) > 0 && (
              <Text style={{ color: colors.primary, fontSize: 11, fontFamily: fonts.heading.semibold }}>{activeFilterCount(filters)}</Text>
            )}
          </Pressable>
        </View>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      ) : isError ? (
        <View className="flex-1 items-center justify-center px-8">
          <AlertCircle size={20} color={colors.destructive} />
          <Text style={{ color: colors.destructive, fontSize: 12, fontFamily: fonts.body.medium, marginTop: 8, textAlign: "center" }}>
            Failed to load payments. Please try again.
          </Text>
        </View>
      ) : (
        <FlatList
          data={records}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          onEndReachedThreshold={0.4}
          onEndReached={() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage(); }}
          renderItem={({ item }) => <PaymentCard rec={item} onPress={() => setViewingRec(item)} />}
          ListEmptyComponent={
            <View className="items-center py-16">
              <AlertCircle size={20} color={`${colors.mutedForeground}80`} />
              <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, marginTop: 8 }}>No payments yet.</Text>
            </View>
          }
          ListFooterComponent={
            isFetchingNextPage ? (
              <View className="py-4 items-center"><ActivityIndicator size="small" color={colors.mutedForeground} /></View>
            ) : null
          }
        />
      )}

      <FilterSheet visible={filterOpen} onClose={() => setFilterOpen(false)} filters={filters} onApply={setFilters} />
      <PaymentDetailModal
        record={viewingRec}
        onClose={() => setViewingRec(null)}
        onEdit={rights.canEdit ? (rec) => { setViewingRec(null); setEditingRec(rec); } : undefined}
        onDeleted={() => setViewingRec(null)}
        canDelete={rights.canDelete}
      />
      <PaymentFormModal
        visible={formOpen || !!editingRec || !!reissueCtx}
        onClose={() => { setFormOpen(false); setEditingRec(null); setReissueCtx(null); }}
        editingRecord={editingRec}
        reissueContext={reissueCtx}
      />
    </View>
  );
}
