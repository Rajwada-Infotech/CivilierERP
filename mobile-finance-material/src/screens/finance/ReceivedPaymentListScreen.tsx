// RN port of src/pages/finance/ReceivedPayment.tsx (web), on the drawing sheet as the web draws it: the sheet's title
// block with New receipt (with the create right) and Refresh, the four figures (total received, entries, cleared,
// submitted), then the receipt register — its count, a search box, Mode and Status filters (client-side over the pages
// loaded, as the web filters its current page) and one ruled row per receipt. Rows load on as the list scrolls; a row
// opens ReceivedPaymentDetailModal; New and Edit open the form as its own page (ReceivedPaymentFormScreen).
import { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, RefreshControl } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Plus, RefreshCw } from "lucide-react-native";
import { colors, sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import { usePageRights } from "@/hooks/usePageRights";
import { getReceivedPayments, dbToRecord, PAYMENT_MODES, type ReceivedPayment, type ReceivedPaymentRecord } from "@/api/receivedPaymentApi";
import type { MainStackParamList } from "@/navigation/MainStack";
import { Body, Key, Notice, Press, RegisterHead, SearchBox, SheetShell, Skel, StatRow } from "@/components/sheet/Sheet";
import { StatusBadge } from "./payment/PaymentBadges";
import { ModeBadge } from "./receivedPayment/ReceivedPaymentBadges";
import { OptionPickerModal, PickerRow, type PickerOption } from "./payment/OptionPicker";
import { ReceivedPaymentDetailModal } from "./receivedPayment/ReceivedPaymentDetailModal";

const PAGE_SIZE = 20;
const STATUSES = ["Draft", "Pending", "Approved", "Rejected"];

function ReceiptRow({ rec, last, onPress }: { rec: ReceivedPayment; last: boolean; onPress: () => void }) {
  return (
    <Press
      onPress={onPress}
      style={(pressed) => ({ paddingVertical: 12, borderBottomWidth: last ? 0 : 1, borderBottomColor: S.ruleSoft, backgroundColor: pressed ? S.blueWash : "transparent" })}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <Text numberOfLines={1} style={{ fontFamily: fonts.heading.semibold, fontSize: 12.5, letterSpacing: 0.2, color: S.ink }}>{rec.docNo || "—"}</Text>
          <Text numberOfLines={1} style={{ fontFamily: fonts.body.semibold, fontSize: 13, color: S.ink }}>{rec.customerName || rec.receivedFrom || "—"}</Text>
          <Text numberOfLines={1} style={{ fontFamily: fonts.body.regular, fontSize: 11.5, color: S.graphite }}>
            {[rec.projectName, rec.companyName, rec.finYear].filter(Boolean).join(" · ") || "—"}
          </Text>
        </View>
        <ModeBadge mode={rec.mode} />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 10 }}>
        <View style={{ gap: 5 }}>
          <StatusBadge status={rec.status} />
          <Body size={11.5} color={S.graphite}>{rec.docDate || "—"}</Body>
        </View>
        <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 16, letterSpacing: -0.3, color: S.ink }}>+{formatINR(rec.amount)}</Text>
      </View>
    </Press>
  );
}

export default function ReceivedPaymentListScreen() {
  const rights = usePageRights("received-payment");
  const route = useRoute<RouteProp<MainStackParamList, "ReceivedPayment">>();
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const [search, setSearch] = useState("");
  const [modeFilter, setModeFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [picker, setPicker] = useState<"mode" | "status" | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [viewingRec, setViewingRec] = useState<ReceivedPayment | null>(null);

  // Lets FinanceDashboardScreen's "New Received" quick action jump straight
  // into the form instead of just landing on the list.
  useEffect(() => {
    if (route.params?.openForm && rights.canCreate) navigation.navigate("ReceivedPaymentForm");
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
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 96 }}>
        <SheetShell eyebrow="CivilierERP · Finance" title="Received payments">
          <Notice tone="ink">You don't have permission to view received payments.</Notice>
        </SheetShell>
      </ScrollView>
    );
  }

  const modeOptions: PickerOption[] = [{ key: "All", label: "All modes" }, ...PAYMENT_MODES.map((m) => ({ key: m, label: m }))];
  const statusOptions: PickerOption[] = [{ key: "All", label: "All statuses" }, ...STATUSES.map((s) => ({ key: s, label: s }))];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 96 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={S.ink} />}
        scrollEventThrottle={200}
        onScroll={({ nativeEvent: e }) => {
          if (e.layoutMeasurement.height + e.contentOffset.y >= e.contentSize.height - 600 && hasNextPage && !isFetchingNextPage) fetchNextPage();
        }}
      >
        <SheetShell
          eyebrow="CivilierERP · Finance"
          title="Received payments"
          subtitle="All inbound payments received from clients & customers"
          action={
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {rights.canCreate && <Key tone="ink" label="New receipt" icon={<Plus size={13} color={S.paper} />} onPress={() => navigation.navigate("ReceivedPaymentForm")} />}
              <Key label="Refresh" icon={<RefreshCw size={13} color={S.ink} />} onPress={() => refetch()} />
            </View>
          }
        >
          {!isLoading && (
            <StatRow
              items={[
                { label: "Total received", value: formatINR(totalReceived), note: "total inbound" },
                { label: "Total entries", value: String(totalCount), note: "all records" },
                { label: "Cleared", value: String(approvedCount), note: "approved" },
                { label: "Submitted", value: String(pendingCount), note: "awaiting approval" },
              ]}
            />
          )}

          <View style={{ borderWidth: 1, borderColor: S.ink, padding: 12, gap: 12 }}>
            <RegisterHead title="Receipt register" count={filtered.length} unit={["receipt", "receipts"]} />
            <SearchBox value={search} onChange={setSearch} placeholder="Search customer, project, doc no…" />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <PickerRow label="Mode" value={modeFilter === "All" ? "" : modeFilter} placeholder="All modes" onPress={() => setPicker("mode")} />
              </View>
              <View style={{ flex: 1 }}>
                <PickerRow label="Status" value={statusFilter === "All" ? "" : statusFilter} placeholder="All statuses" onPress={() => setPicker("status")} />
              </View>
            </View>

            {isLoading ? (
              <>
                <Skel h={70} />
                <Skel h={70} />
                <Skel h={70} />
              </>
            ) : isError ? (
              <Notice>Could not load the received payments. Pull down to try again.</Notice>
            ) : filtered.length === 0 ? (
              <Body color={S.graphite}>{search || modeFilter !== "All" || statusFilter !== "All" ? "No receipt matches these filters." : "No received payments yet."}</Body>
            ) : (
              <View>
                {filtered.map((r, i) => (
                  <ReceiptRow key={r.id} rec={r} last={i === filtered.length - 1 && !hasNextPage} onPress={() => setViewingRec(r)} />
                ))}
                {isFetchingNextPage && (
                  <View style={{ paddingTop: 10 }}>
                    <Skel h={60} />
                  </View>
                )}
              </View>
            )}
          </View>
        </SheetShell>
      </ScrollView>

      <OptionPickerModal visible={picker === "mode"} title="Filter by mode" options={modeOptions} selectedKey={modeFilter} onSelect={(k) => { setModeFilter(k); setPicker(null); }} onClose={() => setPicker(null)} />
      <OptionPickerModal visible={picker === "status"} title="Filter by status" options={statusOptions} selectedKey={statusFilter} onSelect={(k) => { setStatusFilter(k); setPicker(null); }} onClose={() => setPicker(null)} />

      <ReceivedPaymentDetailModal
        record={viewingRec}
        onClose={() => setViewingRec(null)}
        onEdit={rights.canEdit ? (rec) => { setViewingRec(null); navigation.navigate("ReceivedPaymentForm", { record: rec }); } : undefined}
        onDeleted={() => setViewingRec(null)}
        canDelete={rights.canDelete}
      />
    </View>
  );
}
