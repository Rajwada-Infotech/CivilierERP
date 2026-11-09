// RN port of src/pages/finance/Payment.tsx (web), on the drawing sheet as the web draws it: the sheet's title block
// with New payment (with the create right) and Refresh, the three figures (total paid, by cheque, by cash — over the
// loaded records, as the web reduces its loaded records), then the payment register: its heading and count, a doc-no
// search with the filter key, and one ruled row per payment (name, mode, paid to, doc / expense / bank references,
// date, amount, status). Rows load on as the list scrolls; a row opens PaymentDetailModal, and New / Edit / Re-issue
// open the form as its own page (PaymentFormScreen).
import { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, RefreshControl } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Plus, RefreshCw, SlidersHorizontal } from "lucide-react-native";
import { colors, sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import { usePageRights } from "@/hooks/usePageRights";
import { getPayments, dbToRecord, type PaymentRecord, type DbPayment } from "@/api/newPaymentApi";
import type { MainStackParamList } from "@/navigation/MainStack";
import { Body, IconKey, Key, Label, Notice, Press, RegisterHead, SearchBox, SheetShell, Skel, StatRow } from "@/components/sheet/Sheet";
import { StatusBadge, ModeBadge } from "./payment/PaymentBadges";
import { FilterSheet, BLANK_FILTERS, type PaymentFilters } from "./payment/FilterSheet";
import { PaymentDetailModal } from "./payment/PaymentDetailModal";

const PAGE_SIZE = 20;

function activeFilterCount(f: PaymentFilters) {
  return Object.values(f).filter(Boolean).length;
}

/** The bank reference the payment carries, whichever mode it went by. */
function refOf(rec: PaymentRecord) {
  return rec.chequeNo ? `Chq #${rec.chequeNo}` : rec.neftNumber || rec.upiTransactionId || rec.rtgsReference || rec.impsReference || rec.cardReference || null;
}

/** A reference on a row: a small square, ink-ruled. */
function RefTag({ children }: { children: string }) {
  return (
    <View style={{ borderWidth: 1, borderColor: S.line40, paddingHorizontal: 6, paddingVertical: 2 }}>
      <Text numberOfLines={1} style={{ color: S.ink2, fontSize: 10.5, fontFamily: fonts.body.medium, maxWidth: 170 }}>{children}</Text>
    </View>
  );
}

function PaymentRow({ rec, last, onPress }: { rec: PaymentRecord; last: boolean; onPress: () => void }) {
  const ref = refOf(rec);
  return (
    <Press
      onPress={onPress}
      style={(pressed) => ({ paddingVertical: 12, borderBottomWidth: last ? 0 : 1, borderBottomColor: S.ruleSoft, backgroundColor: pressed ? S.blueWash : "transparent" })}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <Text numberOfLines={1} style={{ fontFamily: fonts.heading.semibold, fontSize: 13, color: S.ink }}>{rec.paymentName || "—"}</Text>
          {!!rec.paidTo && (
            <Text numberOfLines={1} style={{ fontFamily: fonts.body.regular, fontSize: 12, color: S.graphite }}>
              Paid to <Text style={{ color: S.ink, fontFamily: fonts.body.medium }}>{rec.paidTo}</Text>
            </Text>
          )}
        </View>
        <ModeBadge mode={rec.mode} />
      </View>

      {!!(rec.docNo || rec.expenseRef || rec.jvNo || ref) && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {!!rec.docNo && <RefTag>{rec.docNo}</RefTag>}
          {!!rec.expenseRef && <RefTag>{rec.expenseRef}</RefTag>}
          {!!rec.jvNo && <RefTag>{rec.jvNo}</RefTag>}
          {!!ref && <RefTag>{ref}</RefTag>}
        </View>
      )}

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 10 }}>
        <View style={{ gap: 5 }}>
          <StatusBadge status={rec.status} />
          <Body size={11.5} color={S.graphite}>{rec.date || "—"}</Body>
        </View>
        <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 16, letterSpacing: -0.3, color: S.ink }}>{formatINR(rec.amount ?? 0)}</Text>
      </View>
    </Press>
  );
}

export default function PaymentListScreen() {
  const rights = usePageRights("new-payment");
  const route = useRoute<RouteProp<MainStackParamList, "Payment">>();
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const [filters, setFilters] = useState<PaymentFilters>(BLANK_FILTERS);
  const [docSearch, setDocSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [viewingRec, setViewingRec] = useState<PaymentRecord | null>(null);

  // Lets FinanceDashboardScreen's "New Payment" quick action jump straight
  // into the form instead of just landing on the list.
  useEffect(() => {
    if (route.params?.openForm && rights.canCreate) navigation.navigate("PaymentForm");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.openForm]);

  // Lets BrsScreen's "Re-issue" action on a bounced entry jump straight
  // into a prefilled New Payment form, mirroring web's location.state flow.
  useEffect(() => {
    if (route.params?.reissue && rights.canCreate) navigation.navigate("PaymentForm", { reissue: route.params.reissue });
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
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 96 }}>
        <SheetShell eyebrow="CivilierERP · Finance" title="Payments">
          <Notice tone="ink">You don't have permission to view payments.</Notice>
        </SheetShell>
      </ScrollView>
    );
  }

  const filterCount = activeFilterCount(filters);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 96 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={S.ink} />}
        scrollEventThrottle={200}
        onScroll={({ nativeEvent: e }) => {
          // Near the end of what is loaded: fetch the next page, as the list used to on onEndReached.
          if (e.layoutMeasurement.height + e.contentOffset.y >= e.contentSize.height - 600 && hasNextPage && !isFetchingNextPage) fetchNextPage();
        }}
      >
        <SheetShell
          eyebrow="CivilierERP · Finance"
          title="Payments"
          subtitle="Record and track payments linked to expense bookings"
          action={
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {rights.canCreate && <Key tone="ink" label="New payment" icon={<Plus size={13} color={S.paper} />} onPress={() => navigation.navigate("PaymentForm")} />}
              <Key label="Refresh" icon={<RefreshCw size={13} color={S.ink} />} onPress={() => refetch()} />
            </View>
          }
        >
          {!isLoading && (
            <StatRow
              items={[
                { label: "Total paid", value: formatINR(totalAmount), note: "in this list" },
                { label: "By cheque", value: String(chequeCount), note: "payments" },
                { label: "By cash", value: String(cashCount), note: "payments" },
              ]}
            />
          )}

          <View style={{ borderWidth: 1, borderColor: S.ink, padding: 12, gap: 12 }}>
            <RegisterHead title="Payment register" count={records.length} unit={["payment loaded", "payments loaded"]} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <SearchBox value={docSearch} onChange={setDocSearch} placeholder="Search doc no…" />
              </View>
              <IconKey onPress={() => setFilterOpen(true)} size={44}>
                <SlidersHorizontal size={15} color={filterCount ? S.blue : S.ink} />
                {filterCount > 0 && (
                  <View style={{ position: "absolute", top: -6, right: -6, minWidth: 16, height: 16, paddingHorizontal: 3, backgroundColor: S.ink, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ color: S.paper, fontSize: 9, fontFamily: fonts.heading.bold }}>{filterCount}</Text>
                  </View>
                )}
              </IconKey>
            </View>

            {isLoading ? (
              <>
                <Skel h={80} />
                <Skel h={80} />
                <Skel h={80} />
              </>
            ) : isError ? (
              <Notice>Could not load the payments. Pull down to try again.</Notice>
            ) : records.length === 0 ? (
              <Body color={S.graphite}>{docSearch || filterCount ? "No payment matches that search." : "No payments yet."}</Body>
            ) : (
              <View>
                {records.map((r, i) => (
                  <PaymentRow key={r.id} rec={r} last={i === records.length - 1 && !hasNextPage} onPress={() => setViewingRec(r)} />
                ))}
                {isFetchingNextPage && (
                  <View style={{ paddingTop: 10 }}>
                    <Skel h={60} />
                  </View>
                )}
                {!hasNextPage && records.length > PAGE_SIZE && <Label style={{ textAlign: "center", paddingTop: 12 }}>End of the list</Label>}
              </View>
            )}
          </View>
        </SheetShell>
      </ScrollView>

      <FilterSheet visible={filterOpen} onClose={() => setFilterOpen(false)} filters={filters} onApply={setFilters} />
      <PaymentDetailModal
        record={viewingRec}
        onClose={() => setViewingRec(null)}
        onEdit={rights.canEdit ? (rec) => { setViewingRec(null); navigation.navigate("PaymentForm", { record: rec }); } : undefined}
        onDeleted={() => setViewingRec(null)}
        canDelete={rights.canDelete}
      />
    </View>
  );
}
