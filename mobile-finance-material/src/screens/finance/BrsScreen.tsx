// RN port of src/pages/finance/Brs.tsx (web) — Bank Reconciliation Statement — on the drawing sheet as the web draws
// it: the sheet's title block with Refresh, the four figures (clear, unclear, bounced — red when there are any — and
// total), the one red note for bounced cheques, the "Reconciled" bar (cleared solid, the rest hatched, with dimension
// lines), then the entries register: search, bank filter, date range, status keys, "Hide dummy bank", and one ruled row
// per entry with the passbook tick. Clear / Unclear, Bounce and Re-issue (bounced → the payment form, prefilled) are
// all supported, matching web's handleReissue flow.
import { useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator, RefreshControl, Switch, Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Landmark, RefreshCw, ArrowRight, CornerDownRight, Ban } from "lucide-react-native";
import type { MainStackParamList } from "@/navigation/MainStack";
import { colors, sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import { usePageRights } from "@/hooks/usePageRights";
import {
  getBRS, getBRSFilters, markClear, markUnclear, isCleared, isBounced,
  type BrsEntry, type BrsFilterOption,
} from "@/api/brsApi";
import { Body, Dimension, Field, Grow, Hatch, Input, Key, Label, Notice, RegisterHead, SearchBox, Seg, SheetShell, Skel, StatRow } from "@/components/sheet/Sheet";
import { TypePill, ClearBadge } from "./brs/BrsBadges";
import { BounceModal } from "./brs/BounceModal";
import { OptionPickerModal, PickerRow, type PickerOption } from "./payment/OptionPicker";

const PAGE_SIZE = 25;

function fmt(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// The passbook tick: an ink-ruled square, filled ink when the entry is in the passbook. blocked: the backend says this
// row can't be cleared yet (un-clearing stays possible).
function PassbookCheck({ checked, loading, onPress, blocked }: { checked: boolean; loading: boolean; onPress: () => void; blocked?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      hitSlop={8}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !!blocked && !checked }}
      style={{ width: 24, height: 24, borderWidth: 1.5, borderColor: S.ink, alignItems: "center", justifyContent: "center", backgroundColor: checked ? S.ink : "transparent", opacity: loading ? 0.5 : blocked && !checked ? 0.3 : 1 }}
    >
      {loading ? <ActivityIndicator size="small" color={checked ? S.paper : S.ink} /> : checked ? <Text style={{ color: S.paper, fontSize: 13, fontFamily: fonts.heading.bold }}>✓</Text> : null}
    </Pressable>
  );
}

function BrsRow({ entry, last, toggling, onToggle, onBounce, onReissue }: {
  entry: BrsEntry; last: boolean; toggling: boolean; onToggle: () => void; onBounce: () => void; onReissue: () => void;
}) {
  const cleared = isCleared(entry);
  const bounced = isBounced(entry);
  return (
    <View
      style={{
        paddingVertical: 12,
        paddingLeft: bounced ? 8 : 0,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: S.ruleSoft,
        borderLeftWidth: bounced ? 2 : 0,
        borderLeftColor: S.red,
        backgroundColor: bounced ? S.redWash : "transparent",
        gap: 8,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        <View style={{ paddingTop: 2 }}>
          <PassbookCheck checked={cleared && !bounced} loading={toggling} onPress={onToggle} blocked={entry.Clearable === false} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <TypePill type={entry.SourceType} />
            <Body size={11.5} color={S.graphite}>{fmt(entry.PayDate)}</Body>
          </View>
          <Text numberOfLines={1} style={{ color: S.ink, fontSize: 13, fontFamily: fonts.heading.semibold }}>{entry.CompanyName || "—"}</Text>
          {!!entry.PaymentName && entry.PaymentName !== entry.CompanyName && <Body size={11.5} color={S.ink2}>{entry.PaymentName}</Body>}
          {!!entry.DocNo && <Text style={{ color: S.ink, fontSize: 11.5, fontFamily: fonts.heading.semibold, letterSpacing: 0.2 }}>{entry.DocNo}</Text>}
          {!!entry.BankName && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <Landmark size={11} color={S.graphite} />
              <Text numberOfLines={1} style={{ flexShrink: 1, color: S.graphite, fontSize: 11.5, fontFamily: fonts.body.regular }}>{entry.BankName}</Text>
            </View>
          )}
          {!!entry.Mode && <Body size={11.5} color={S.graphite}>{`${entry.Mode}${entry.ChequeNo ? `  #${entry.ChequeNo}` : ""}`}</Body>}
        </View>
        <View style={{ alignItems: "flex-end", gap: 6 }}>
          <Text style={{ color: bounced ? S.red : S.ink, fontSize: 14.5, fontFamily: fonts.heading.semibold, textDecorationLine: bounced ? "line-through" : "none" }}>
            {formatINR(entry.Amount)}
          </Text>
          <ClearBadge cleared={cleared} bounced={bounced} />
          {entry.Clearable === false && !cleared && <Body size={10.5} color={S.graphite} style={{ textAlign: "right" }}>Awaiting approval</Body>}
          {cleared && !!entry.ClearingDate && <Body size={10.5} color={S.graphite} style={{ textAlign: "right" }}>{fmt(entry.ClearingDate)}</Body>}
        </View>
      </View>

      {bounced && (entry.BounceReason || entry.BounceRemarks) && (
        <View style={{ marginLeft: 36, gap: 2 }}>
          {!!entry.BounceReason && <Body size={12} color={S.red} weight="medium">{`${entry.BounceReason}${entry.BounceDate ? ` · ${fmt(entry.BounceDate)}` : ""}`}</Body>}
          {!!entry.BounceRemarks && <Body size={11.5} color={S.graphite}>{entry.BounceRemarks}</Body>}
        </View>
      )}

      <View style={{ marginLeft: 36 }}>
        {bounced ? (
          entry.ReplacementDocNo ? (
            <View style={{ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6 }}>
              <ArrowRight size={12} color={S.ink} />
              <Label color={S.ink}>{`Reissued as ${entry.ReplacementDocNo}`}</Label>
            </View>
          ) : (
            <Key label="Re-issue" icon={<CornerDownRight size={12} color={S.ink} />} onPress={onReissue} style={{ alignSelf: "flex-start", minHeight: 34, paddingHorizontal: 12 }} />
          )
        ) : entry.OriginalDocNo ? (
          <View style={{ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6 }}>
            <CornerDownRight size={12} color={S.graphite} />
            <Label>{`Replaces ${entry.OriginalDocNo}`}</Label>
          </View>
        ) : entry.ChequeNo && !cleared && entry.Clearable !== false ? (
          <Key tone="red" label="Mark bounced" icon={<Ban size={12} color="#ffffff" />} onPress={onBounce} style={{ alignSelf: "flex-start", minHeight: 34, paddingHorizontal: 12 }} />
        ) : null}
      </View>
    </View>
  );
}

export default function BrsScreen() {
  const queryClient = useQueryClient();
  const rights = usePageRights("brs");
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const [search, setSearch] = useState("");
  const [bankId, setBankId] = useState<number | undefined>(undefined);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "clear" | "unclear" | "bounced">("");
  const [hideDummyBank, setHideDummyBank] = useState(true);
  const [bankPickerOpen, setBankPickerOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [togglingKey, setTogglingKey] = useState<string | null>(null);
  const [bounceEntry, setBounceEntry] = useState<BrsEntry | null>(null);

  const { data: filters } = useQuery({ queryKey: ["brs-filters"], queryFn: getBRSFilters, staleTime: 5 * 60 * 1000 });
  const banks: BrsFilterOption[] = filters?.banks ?? [];

  const queryKey = ["brs-mobile", bankId, fromDate, toDate, statusFilter, hideDummyBank] as const;
  const {
    data, isLoading, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage, refetch, isRefetching,
  } = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => getBRS({
      page: pageParam, limit: PAGE_SIZE, bankId, fromDate: fromDate || undefined, toDate: toDate || undefined,
      status: statusFilter || undefined, hideDummyBank,
    }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, pages) => (pages.length < (lastPage?.totalPages ?? 1) ? pages.length + 1 : undefined),
    enabled: rights.canView,
  });

  const entries: BrsEntry[] = useMemo(() => (data?.pages ?? []).flatMap((p) => p?.data ?? []), [data]);
  const last = data?.pages?.[data.pages.length - 1];
  const clearCount = last?.clearCount ?? 0;
  const unclearCount = last?.unclearCount ?? 0;
  const bounceCount = last?.bounceCount ?? 0;
  const clearAmount = last?.clearAmount ?? 0;
  const unclearAmount = last?.unclearAmount ?? 0;
  const bounceAmount = last?.bounceAmount ?? 0;
  const total = last?.total ?? 0;
  const reconcileRate = total > 0 ? Math.round((clearCount / total) * 100) : 0;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => [e.CompanyName, e.BankName, e.TxnId, e.ChequeNo, e.PaymentName, e.DocNo, e.Mode, e.BounceReason]
      .some((v) => (v ?? "").toLowerCase().includes(q)));
  }, [entries, search]);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["brs-mobile"], exact: false });
  };

  const handleToggle = async (entry: BrsEntry) => {
    if (isBounced(entry)) return;
    if (!isCleared(entry) && entry.Clearable === false) {
      Alert.alert("Can't clear yet", entry.ClearBlockReason || "Approve this document before clearing");
      return;
    }
    const key = `${entry.SourceType}-${entry.SourceID}`;
    setTogglingKey(key);
    try {
      if (isCleared(entry)) await markUnclear(entry.SourceType, entry.SourceID);
      else await markClear(entry.SourceType, entry.SourceID);
      invalidateAll();
    } catch (err: any) {
      Alert.alert("Failed to update status", err?.message ?? "Something went wrong.");
    } finally {
      setTogglingKey(null);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handleReissue = (entry: BrsEntry) => {
    // Straight to the payment form page, prefilled to replace the bounced payment.
    navigation.navigate("PaymentForm", {
      reissue: {
        replacesPaymentId: entry.SourceID,
        replacesDocNo: entry.DocNo || "",
        amount: entry.Amount,
        paymentName: entry.PaymentName,
        companyName: entry.CompanyName || "",
        bounceReason: entry.BounceReason,
      },
    });
  };

  if (!rights.canView) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 96 }}>
        <SheetShell eyebrow="CivilierERP · Finance" title="Bank reconciliation">
          <Notice tone="ink">You don't have permission to view BRS.</Notice>
        </SheetShell>
      </ScrollView>
    );
  }

  const bankOptions: PickerOption[] = banks.map((b) => ({ key: String(b.id), label: b.name }));
  const bankLabel = bankId ? banks.find((b) => b.id === bankId)?.name ?? "" : "";

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
          title="Bank reconciliation"
          subtitle="Check each entry against the bank passbook: tick the ones that appear in it, and mark a returned cheque as bounced."
          action={<Key label={isRefetching ? "Reading…" : "Refresh"} icon={<RefreshCw size={13} color={S.ink} />} onPress={onRefresh} disabled={isRefetching} style={{ alignSelf: "flex-start" }} />}
        >
          {!isLoading && (
            <StatRow
              items={[
                { label: "Clear", value: String(clearCount), note: formatINR(clearAmount) },
                { label: "Unclear", value: String(unclearCount), note: formatINR(unclearAmount) },
                { label: "Bounced", value: String(bounceCount), note: formatINR(bounceAmount), red: bounceCount > 0 },
                { label: "Total entries", value: String(total), note: formatINR(clearAmount + unclearAmount + bounceAmount) },
              ]}
            />
          )}

          {bounceCount > 0 && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: S.red, backgroundColor: S.redWash }}>
              <AlertTriangle size={15} color={S.red} />
              <Text style={{ flex: 1, color: S.red, fontSize: 12.5, fontFamily: fonts.body.medium }}>
                {`${bounceCount} payment${bounceCount !== 1 ? "s" : ""} returned by the bank, totalling `}
                <Text style={{ fontFamily: fonts.heading.bold }}>{formatINR(bounceAmount)}</Text>
                {". Use the Bounced filter to review them."}
              </Text>
            </View>
          )}

          {total > 0 && (
            <View>
              <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                <Label color={S.ink}>Reconciled</Label>
                <Text style={{ color: S.ink, fontSize: 22, fontFamily: fonts.heading.semibold }}>
                  {reconcileRate}
                  <Text style={{ fontSize: 12, fontFamily: fonts.heading.medium }}>%</Text>
                </Text>
              </View>
              <View style={{ flexDirection: "row", height: 22, borderWidth: 1.5, borderColor: S.ink, backgroundColor: S.paper, overflow: "hidden" }}>
                <Grow style={{ width: `${reconcileRate}%`, backgroundColor: S.blue }} />
                <View style={{ flex: 1, overflow: "hidden" }}>
                  <Hatch id="brs-rest" />
                </View>
              </View>
              <View style={{ flexDirection: "row" }}>
                <View style={{ width: `${Math.min(Math.max(reconcileRate, 22), 78)}%`, minWidth: 0 }}>
                  <Dimension text={`${clearCount} clear`} color={S.blue} />
                </View>
                <View style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>{total - clearCount > 0 && <Dimension text={`${total - clearCount} to go`} />}</View>
              </View>
            </View>
          )}

          <View style={{ borderWidth: 1, borderColor: S.ink, padding: 12, gap: 12 }}>
            <RegisterHead title="Entries" count={filtered.length} unit={["entry", "entries"]} />
            <SearchBox value={search} onChange={setSearch} placeholder="Search company, bank, txn, cheque…" />
            <PickerRow label="Bank" value={bankLabel} placeholder="All banks" onPress={() => setBankPickerOpen(true)} />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Field label="From" style={{ flex: 1 }}>
                <Input value={fromDate} onChangeText={setFromDate} placeholder="YYYY-MM-DD" />
              </Field>
              <Field label="To" style={{ flex: 1 }}>
                <Input value={toDate} onChangeText={setToDate} placeholder="YYYY-MM-DD" />
              </Field>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <Seg
                options={[
                  { value: "", label: "All" },
                  { value: "clear", label: "Clear" },
                  { value: "unclear", label: "Unclear" },
                  { value: "bounced", label: "Bounced" },
                ]}
                value={statusFilter}
                onChange={(v) => setStatusFilter(v as typeof statusFilter)}
              />
            </ScrollView>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <Label>Hide dummy bank</Label>
              <Switch value={hideDummyBank} onValueChange={setHideDummyBank} trackColor={{ false: S.ruleSoft, true: S.blueTint }} thumbColor={hideDummyBank ? S.ink : S.graphite} />
            </View>

            {isLoading ? (
              <>
                <Skel h={90} />
                <Skel h={90} />
                <Skel h={90} />
              </>
            ) : isError ? (
              <View style={{ gap: 10 }}>
                <Notice>{(error as Error)?.message || "Could not load the BRS. Try again."}</Notice>
                <Key label="Retry" onPress={() => refetch()} style={{ alignSelf: "flex-start" }} />
              </View>
            ) : filtered.length === 0 ? (
              <Body color={S.graphite}>No entries match your filters.</Body>
            ) : (
              <View style={{ borderTopWidth: 1, borderTopColor: S.ink }}>
                {filtered.map((item, i) => (
                  <BrsRow
                    key={`${item.SourceType}-${item.SourceID}`}
                    entry={item}
                    last={i === filtered.length - 1 && !hasNextPage}
                    toggling={togglingKey === `${item.SourceType}-${item.SourceID}`}
                    onToggle={() => handleToggle(item)}
                    onBounce={() => setBounceEntry(item)}
                    onReissue={() => handleReissue(item)}
                  />
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

      <OptionPickerModal
        visible={bankPickerOpen} title="Filter by bank" options={bankOptions}
        selectedKey={bankId ? String(bankId) : null}
        onSelect={(k) => { setBankId(k ? Number(k) : undefined); setBankPickerOpen(false); }}
        onClose={() => setBankPickerOpen(false)} searchable clearable
      />

      <BounceModal
        entry={bounceEntry}
        onClose={() => setBounceEntry(null)}
        onSaved={() => { setBounceEntry(null); invalidateAll(); }}
      />
    </View>
  );
}
