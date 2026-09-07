// RN port of src/pages/finance/Brs.tsx (web) — Bank Reconciliation
// Statement. Web's `md:hidden` mobile card block is the direct template
// for BrsCard below. Clear/Unclear toggle, Bounce, and Re-issue (bounced
// → prefilled new Payment, via navigation params instead of web's
// router-state) are all supported now, matching web's handleReissue flow.
import { useMemo, useState } from "react";
import { View, Text, FlatList, Pressable, ActivityIndicator, RefreshControl, TextInput, Switch, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ShieldCheck, CheckCircle2, Clock, Ban, IndianRupee, AlertTriangle, Landmark,
  Search, X, RefreshCw, ShieldOff, ArrowRight, CornerDownRight, SlidersHorizontal,
} from "lucide-react-native";
import type { MainStackParamList } from "@/navigation/MainStack";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import { usePageRights } from "@/hooks/usePageRights";
import {
  getBRS, getBRSFilters, markClear, markUnclear, isCleared, isBounced,
  type BrsEntry, type BrsFilterOption,
} from "@/api/brsApi";
import { TypePill, ClearBadge } from "./brs/BrsBadges";
import { BounceModal } from "./brs/BounceModal";
import { OptionPickerModal, type PickerOption } from "./payment/OptionPicker";

const PAGE_SIZE = 25;

function fmt(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function StatTile({ label, value, sub, icon: Icon, accent }: {
  label: string; value: string; sub: string; icon: React.ComponentType<{ size?: number; color?: string }>; accent: string;
}) {
  return (
    <View style={{ width: "48%", marginBottom: 10 }} className="rounded-xl overflow-hidden">
      <View
        className="flex-row items-center gap-2.5 px-3.5 py-3"
        style={{ backgroundColor: `${colors.card}b3`, borderWidth: 1, borderColor: `${colors.border}80`, borderLeftWidth: 3, borderLeftColor: accent }}
      >
        <View className="w-8 h-8 rounded-lg items-center justify-center" style={{ backgroundColor: `${accent}26`, borderWidth: 1, borderColor: `${accent}4d` }}>
          <Icon size={14} color={accent} />
        </View>
        <View className="flex-1 min-w-0">
          <Text style={{ color: colors.foreground, fontFamily: fonts.heading.bold, fontSize: 15 }}>{value}</Text>
          <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 9.5, fontFamily: fonts.body.regular, textTransform: "uppercase" }}>{label}</Text>
          <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 10, marginTop: 1 }}>{sub}</Text>
        </View>
      </View>
    </View>
  );
}

function PassbookCheck({ checked, loading, onPress }: { checked: boolean; loading: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      style={{
        width: 22, height: 22, borderRadius: 5, borderWidth: 2, alignItems: "center", justifyContent: "center",
        borderColor: checked ? "#10b981" : colors.border, backgroundColor: checked ? "#10b981" : "transparent", opacity: loading ? 0.5 : 1,
      }}
    >
      {loading ? <ActivityIndicator size="small" color={checked ? "#fff" : colors.mutedForeground} /> : checked ? (
        <Text style={{ color: "#fff", fontSize: 12, fontWeight: "bold" }}>✓</Text>
      ) : null}
    </Pressable>
  );
}

function BrsCard({ entry, toggling, onToggle, onBounce, onReissue }: {
  entry: BrsEntry; toggling: boolean; onToggle: () => void; onBounce: () => void; onReissue: () => void;
}) {
  const cleared = isCleared(entry);
  const bounced = isBounced(entry);
  return (
    <View
      className="rounded-2xl p-3.5 mb-2.5"
      style={{
        borderWidth: 1, borderColor: bounced ? "#dc262640" : `${colors.border}99`,
        backgroundColor: bounced ? "#dc26260d" : cleared ? "#05966908" : `${colors.card}80`,
        borderLeftWidth: bounced ? 3 : 0, borderLeftColor: "#dc2626",
      }}
    >
      <View className="flex-row items-start gap-3">
        <View style={{ paddingTop: 2 }}>
          <PassbookCheck checked={cleared && !bounced} loading={toggling} onPress={onToggle} />
        </View>
        <View className="flex-1 min-w-0">
          <View className="flex-row items-center gap-1.5 flex-wrap mb-0.5">
            <TypePill type={entry.SourceType} />
            <Text style={{ color: colors.mutedForeground, fontSize: 10 }}>{fmt(entry.PayDate)}</Text>
          </View>
          <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.heading.semibold }}>
            {entry.CompanyName || "—"}
          </Text>
          {!!entry.PaymentName && entry.PaymentName !== entry.CompanyName && (
            <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 10.5, marginTop: 1 }}>{entry.PaymentName}</Text>
          )}
          {!!entry.DocNo && (
            <View className="self-start px-1.5 py-0.5 rounded mt-1" style={{ backgroundColor: `${colors.primary}15`, borderWidth: 1, borderColor: `${colors.primary}30` }}>
              <Text style={{ color: colors.primary, fontSize: 9.5, fontFamily: fonts.body.medium }}>{entry.DocNo}</Text>
            </View>
          )}
          {!!entry.BankName && (
            <View className="flex-row items-center gap-1 mt-1.5">
              <Landmark size={9} color="#60a5fa" />
              <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 10 }}>{entry.BankName}</Text>
            </View>
          )}
          {!!entry.Mode && (
            <Text style={{ color: colors.mutedForeground, fontSize: 10, marginTop: 1 }}>
              {entry.Mode}{entry.ChequeNo ? `  #${entry.ChequeNo}` : ""}
            </Text>
          )}
        </View>
        <View style={{ alignItems: "flex-end", gap: 6 }}>
          <Text style={{
            color: bounced ? "#dc2626" : colors.foreground, fontSize: 13.5, fontFamily: fonts.heading.bold,
            textDecorationLine: bounced ? "line-through" : "none",
          }}>
            {formatINR(entry.Amount)}
          </Text>
          <ClearBadge cleared={cleared} bounced={bounced} />
          {cleared && !!entry.ClearingDate && (
            <Text style={{ color: "#10b981", fontSize: 9.5, textAlign: "right" }}>{fmt(entry.ClearingDate)}</Text>
          )}
        </View>
      </View>

      {bounced && (entry.BounceReason || entry.BounceRemarks) && (
        <View className="rounded-lg px-3 py-2 mt-2.5" style={{ backgroundColor: "#dc262610", borderWidth: 1, borderColor: "#dc262630" }}>
          {!!entry.BounceReason && (
            <Text style={{ color: "#dc2626", fontSize: 10.5, fontFamily: fonts.body.medium }}>
              {entry.BounceReason}{entry.BounceDate ? ` · ${fmt(entry.BounceDate)}` : ""}
            </Text>
          )}
          {!!entry.BounceRemarks && (
            <Text style={{ color: colors.mutedForeground, fontSize: 10, marginTop: 2 }}>{entry.BounceRemarks}</Text>
          )}
        </View>
      )}

      <View className="mt-2.5" style={{ paddingLeft: 34 }}>
        {bounced ? (
          entry.ReplacementDocNo ? (
            <View className="self-start flex-row items-center gap-1.5 px-2 py-1.5 rounded-lg" style={{ backgroundColor: "#05966915", borderWidth: 1, borderColor: "#05966940" }}>
              <ArrowRight size={10} color="#059669" />
              <Text style={{ color: "#059669", fontSize: 10, fontFamily: fonts.body.semibold }}>{entry.ReplacementDocNo}</Text>
            </View>
          ) : (
            <Pressable onPress={onReissue} className="self-start flex-row items-center gap-1.5 px-2.5 py-1.5 rounded-lg" style={{ borderWidth: 1, borderColor: "#d9770660" }}>
              <CornerDownRight size={10} color="#d97706" />
              <Text style={{ color: "#d97706", fontSize: 10.5, fontFamily: fonts.body.medium }}>Re-issue</Text>
            </Pressable>
          )
        ) : entry.OriginalDocNo ? (
          <View className="self-start flex-row items-center gap-1.5 px-2 py-1.5 rounded-lg" style={{ backgroundColor: "#d9770615", borderWidth: 1, borderColor: "#d9770640" }}>
            <CornerDownRight size={10} color="#d97706" />
            <Text style={{ color: "#d97706", fontSize: 10, fontFamily: fonts.body.semibold }}>{entry.OriginalDocNo}</Text>
          </View>
        ) : entry.ChequeNo && !cleared ? (
          <Pressable onPress={onBounce} className="self-start flex-row items-center gap-1.5 px-2.5 py-1.5 rounded-lg" style={{ borderWidth: 1, borderColor: "#dc262660" }}>
            <Ban size={10} color="#dc2626" />
            <Text style={{ color: "#dc2626", fontSize: 10.5, fontFamily: fonts.body.medium }}>Mark Bounced</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export default function BrsScreen() {
  const insets = useSafeAreaInsets();
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
    navigation.navigate("Payment", {
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
      <View className="flex-1 items-center justify-center px-8" style={{ backgroundColor: colors.background }}>
        <ShieldOff size={28} color={colors.mutedForeground} />
        <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold, marginTop: 12 }}>No access</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, marginTop: 4, textAlign: "center" }}>
          You don't have permission to view BRS.
        </Text>
      </View>
    );
  }

  const bankOptions: PickerOption[] = banks.map((b) => ({ key: String(b.id), label: b.name }));
  const statusPills: { key: typeof statusFilter; label: string }[] = [
    { key: "", label: "All" }, { key: "clear", label: "Clear" }, { key: "unclear", label: "Unclear" }, { key: "bounced", label: "Bounced" },
  ];

  const ListHeader = (
    <View>
      <View className="flex-row items-center gap-2.5 mb-3">
        <View className="w-9 h-9 rounded-xl items-center justify-center" style={{ backgroundColor: "#6366f126", borderWidth: 1, borderColor: "#6366f14d" }}>
          <ShieldCheck size={16} color="#6366f1" />
        </View>
        <View className="flex-1">
          <Text style={{ color: colors.foreground, fontFamily: fonts.heading.bold, fontSize: 18 }}>BRS</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.regular }}>Bank Reconciliation Statement</Text>
        </View>
        <Pressable onPress={onRefresh} disabled={isRefetching} className="w-8 h-8 rounded-lg items-center justify-center" style={{ borderWidth: 1, borderColor: colors.border }}>
          {isRefetching ? <ActivityIndicator size="small" color={colors.mutedForeground} /> : <RefreshCw size={14} color={colors.mutedForeground} />}
        </Pressable>
      </View>

      <View className="flex-row flex-wrap justify-between">
        <StatTile label="Clear" value={String(clearCount)} sub={formatINR(clearAmount)} icon={CheckCircle2} accent="#10b981" />
        <StatTile label="Unclear" value={String(unclearCount)} sub={formatINR(unclearAmount)} icon={Clock} accent="#d97706" />
        <StatTile label="Bounced" value={String(bounceCount)} sub={formatINR(bounceAmount)} icon={Ban} accent="#dc2626" />
        <StatTile label="Total Entries" value={String(total)} sub={formatINR(clearAmount + unclearAmount + bounceAmount)} icon={IndianRupee} accent={colors.primary} />
      </View>

      {bounceCount > 0 && (
        <View className="flex-row items-center gap-2.5 rounded-xl px-4 py-3 mb-3" style={{ backgroundColor: "#dc262614", borderWidth: 1, borderColor: "#dc262640" }}>
          <AlertTriangle size={14} color="#dc2626" />
          <Text style={{ color: "#dc2626", fontSize: 11, fontFamily: fonts.body.medium, flex: 1 }}>
            {bounceCount} payment{bounceCount !== 1 ? "s" : ""} bounced, totalling {formatINR(bounceAmount)}.
          </Text>
        </View>
      )}

      {total > 0 && (
        <View className="rounded-xl px-4 py-3 mb-3" style={{ backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: colors.border }}>
          <View className="flex-row items-center justify-between mb-1.5">
            <Text style={{ color: colors.mutedForeground, fontSize: 10.5 }}>Reconciliation progress</Text>
            <Text style={{ color: colors.foreground, fontSize: 10.5, fontFamily: fonts.heading.semibold }}>{reconcileRate}% · {clearCount}/{total}</Text>
          </View>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.muted, overflow: "hidden" }}>
            <View style={{ width: `${reconcileRate}%`, height: "100%", borderRadius: 3, backgroundColor: reconcileRate === 100 ? "#10b981" : "#f59e0b" }} />
          </View>
        </View>
      )}

      <View className="flex-row items-center gap-2 mb-3">
        <View className="flex-1 flex-row items-center gap-2 px-3 rounded-xl" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.card}80` }}>
          <Search size={14} color={colors.mutedForeground} />
          <TextInput
            value={search} onChangeText={setSearch}
            placeholder="Search company, bank, txn, cheque…"
            placeholderTextColor={`${colors.mutedForeground}99`}
            style={{ flex: 1, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13, paddingVertical: 10 }}
          />
          {!!search && <Pressable onPress={() => setSearch("")}><X size={14} color={colors.mutedForeground} /></Pressable>}
        </View>
        <Pressable
          onPress={() => setBankPickerOpen(true)}
          className="flex-row items-center gap-1.5 px-3 py-2.5 rounded-xl"
          style={{ borderWidth: 1, borderColor: bankId ? colors.primary : colors.border, backgroundColor: bankId ? `${colors.primary}1a` : "transparent" }}
        >
          <SlidersHorizontal size={14} color={bankId ? colors.primary : colors.mutedForeground} />
        </Pressable>
      </View>

      <View className="flex-row gap-2 mb-3">
        <TextInput
          value={fromDate} onChangeText={setFromDate} placeholder="From (YYYY-MM-DD)"
          placeholderTextColor={`${colors.mutedForeground}99`}
          style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, color: colors.foreground, fontSize: 11.5 }}
        />
        <TextInput
          value={toDate} onChangeText={setToDate} placeholder="To (YYYY-MM-DD)"
          placeholderTextColor={`${colors.mutedForeground}99`}
          style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, color: colors.foreground, fontSize: 11.5 }}
        />
      </View>

      <View className="flex-row items-center justify-between mb-3">
        <View className="flex-row gap-1.5">
          {statusPills.map((s) => {
            const active = statusFilter === s.key;
            return (
              <Pressable
                key={s.label}
                onPress={() => setStatusFilter(s.key)}
                className="px-3 py-1.5 rounded-full"
                style={{ borderWidth: 1, borderColor: active ? colors.primary : colors.border, backgroundColor: active ? `${colors.primary}1a` : "transparent" }}
              >
                <Text style={{ color: active ? colors.primary : colors.mutedForeground, fontSize: 11, fontFamily: fonts.heading.medium }}>{s.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <View className="flex-row items-center gap-1.5">
          <Text style={{ color: colors.mutedForeground, fontSize: 10.5 }}>Hide Dummy</Text>
          <Switch value={hideDummyBank} onValueChange={setHideDummyBank} trackColor={{ false: colors.muted, true: `${colors.primary}80` }} thumbColor={hideDummyBank ? colors.primary : "#f4f3f4"} />
        </View>
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {isLoading ? (
        <View className="flex-1 items-center justify-center"><ActivityIndicator color={colors.mutedForeground} /></View>
      ) : isError ? (
        <View className="flex-1 items-center justify-center px-8">
          <AlertTriangle size={20} color={colors.destructive} />
          <Text style={{ color: colors.destructive, fontSize: 12, fontFamily: fonts.body.medium, marginTop: 8, textAlign: "center" }}>
            {(error as Error)?.message || "Failed to load BRS data. Please try again."}
          </Text>
          <Pressable onPress={() => refetch()} className="mt-4 px-4 py-2 rounded-lg" style={{ borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.heading.medium }}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(e) => `${e.SourceType}-${e.SourceID}`}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          onEndReachedThreshold={0.4}
          onEndReached={() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage(); }}
          ListHeaderComponent={ListHeader}
          renderItem={({ item }) => (
            <BrsCard
              entry={item}
              toggling={togglingKey === `${item.SourceType}-${item.SourceID}`}
              onToggle={() => handleToggle(item)}
              onBounce={() => setBounceEntry(item)}
              onReissue={() => handleReissue(item)}
            />
          )}
          ListEmptyComponent={
            <View className="items-center py-16">
              <AlertTriangle size={20} color={`${colors.mutedForeground}80`} />
              <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, marginTop: 8 }}>No entries match your filters.</Text>
            </View>
          }
          ListFooterComponent={isFetchingNextPage ? (
            <View className="py-4 items-center"><ActivityIndicator size="small" color={colors.mutedForeground} /></View>
          ) : null}
        />
      )}

      <OptionPickerModal
        visible={bankPickerOpen} title="Filter by Bank" options={bankOptions}
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
