// Mobile-only stock ledger drill-down — web's Stock.tsx never wired up its
// own stockLedgerApi.ts, this screen is the first UI consumer of that
// (real, paginated) backend endpoint. Reached from StockScreen either
// scoped to one item (tap a card) or to a whole godown ("Ledger" button,
// no item filter). No per-row running balance exists in the API response —
// only a per-line signed qty and an overall summary balance — so this
// shows exactly that rather than inventing a running total.
import { useMemo, useState } from "react";
import { View, Text, FlatList, Pressable, ActivityIndicator, TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ListTree, Search, X, ArrowDownCircle, ArrowUpCircle, AlertCircle } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { getStockLedger, REF_TYPE_LABEL, type StockLedgerEntry } from "@/api/stockLedgerApi";
import type { MainStackParamList } from "@/navigation/MainStack";

const PAGE_SIZE = 20;
const TYPE_TABS: { key: "" | "IN" | "OUT"; label: string }[] = [{ key: "", label: "All" }, { key: "IN", label: "In" }, { key: "OUT", label: "Out" }];

function fmtNum(n: number | null | undefined) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number(n) || 0);
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function docRefFor(entry: StockLedgerEntry): string {
  return entry.DocNo || entry.GRNNo || entry.PurchaseOrderNo || entry.IssueNo || "—";
}

function LedgerRow({ entry, showItem }: { entry: StockLedgerEntry; showItem: boolean }) {
  const isIn = entry.Type === "IN";
  const color = isIn ? "#059669" : colors.destructive;
  return (
    <View className="rounded-2xl p-3.5 mb-2.5" style={{ backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: `${colors.border}99` }}>
      <View className="flex-row items-start justify-between gap-2">
        <View className="flex-row items-center gap-2 flex-1 min-w-0">
          {isIn ? <ArrowDownCircle size={16} color={color} /> : <ArrowUpCircle size={16} color={color} />}
          <View style={{ flex: 1 }}>
            {showItem && <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.heading.bold }}>{entry.ItemName || entry.ItemID}</Text>}
            <Text style={{ color: colors.mutedForeground, fontSize: 10.5, marginTop: showItem ? 1 : 0 }}>
              {fmtDate(entry.LedgerDate)} · {REF_TYPE_LABEL[entry.RefType ?? ""] || entry.RefType || "—"}
            </Text>
          </View>
        </View>
        <Text style={{ color, fontSize: 14, fontFamily: fonts.heading.bold }}>
          {isIn ? "+" : "-"}{fmtNum(entry.Qty)} {entry.UOMSymbol || entry.UOM || ""}
        </Text>
      </View>
      <View className="flex-row items-center justify-between mt-2 pt-2" style={{ borderTopWidth: 1, borderTopColor: `${colors.border}80` }}>
        <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 10.5, flex: 1, marginRight: 8 }}>Ref: {docRefFor(entry)}</Text>
        {!!entry.GodownName && <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 10.5 }}>{entry.GodownName}</Text>}
      </View>
    </View>
  );
}

export default function StockLedgerScreen() {
  const insets = useSafeAreaInsets();
  const route = useRoute<RouteProp<MainStackParamList, "StockLedger">>();
  const { itemId, itemName, godownId, godownName, dateFrom: initialFrom, dateTo: initialTo } = route.params ?? {};
  const [type, setType] = useState<"" | "IN" | "OUT">("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState(initialFrom ?? "");
  const [dateTo, setDateTo] = useState(initialTo ?? "");

  const {
    data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["stock-ledger", itemId, godownId, type, search, dateFrom, dateTo],
    queryFn: ({ pageParam }) => getStockLedger({
      page: pageParam, limit: PAGE_SIZE, itemId: itemId || undefined, godownId: godownId ?? undefined,
      type: type || undefined, search: search || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined,
    }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, pages) => (pages.length < (lastPage?.totalPages ?? 1) ? pages.length + 1 : undefined),
  });

  const entries: StockLedgerEntry[] = useMemo(() => (data?.pages ?? []).flatMap((p) => p?.data ?? []), [data]);
  const summary = data?.pages?.[0]?.summary;

  const ListHeader = (
    <View>
      <View className="flex-row items-center gap-2.5 mb-3">
        <View className="w-9 h-9 rounded-xl items-center justify-center" style={{ backgroundColor: "#8b5cf626", borderWidth: 1, borderColor: "#8b5cf64d" }}>
          <ListTree size={16} color="#8b5cf6" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.foreground, fontFamily: fonts.heading.bold, fontSize: 16 }} numberOfLines={1}>{itemName || "Stock Ledger"}</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 10.5 }} numberOfLines={1}>{godownName || "All godowns"}</Text>
        </View>
      </View>

      {!!summary && (
        <View className="flex-row rounded-xl overflow-hidden mb-3" style={{ borderWidth: 1, borderColor: colors.border }}>
          {[
            ["In", `+${fmtNum(summary.stockIn)}`, "#059669"],
            ["Out", `-${fmtNum(summary.stockOut)}`, colors.destructive],
            ["Balance", fmtNum(summary.balance), summary.balance < 0 ? colors.destructive : colors.foreground],
          ].map(([label, value, color], i) => (
            <View key={label as string} style={{ flex: 1, borderLeftWidth: i > 0 ? 1 : 0, borderLeftColor: colors.border, paddingVertical: 10, alignItems: "center" }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>{label}</Text>
              <Text style={{ color: color as string, fontSize: 13, fontFamily: fonts.heading.bold, marginTop: 2 }}>{value}</Text>
            </View>
          ))}
        </View>
      )}

      <View className="flex-row items-center gap-2 px-3 rounded-xl mb-3" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.card}80` }}>
        <Search size={14} color={colors.mutedForeground} />
        <TextInput
          value={search} onChangeText={setSearch} placeholder="Search doc no, GRN, PO…" placeholderTextColor={`${colors.mutedForeground}99`}
          style={{ flex: 1, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13, paddingVertical: 10 }}
        />
        {!!search && <Pressable onPress={() => setSearch("")}><X size={14} color={colors.mutedForeground} /></Pressable>}
      </View>

      <View className="flex-row gap-2 mb-3">
        <View style={{ flex: 1 }}>
          <TextInput
            value={dateFrom} onChangeText={setDateFrom} placeholder="From (YYYY-MM-DD)" placeholderTextColor={`${colors.mutedForeground}99`}
            style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, color: colors.foreground, fontSize: 12.5 }}
          />
        </View>
        <View style={{ flex: 1 }}>
          <TextInput
            value={dateTo} onChangeText={setDateTo} placeholder="To (YYYY-MM-DD)" placeholderTextColor={`${colors.mutedForeground}99`}
            style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, color: colors.foreground, fontSize: 12.5 }}
          />
        </View>
      </View>

      <View className="flex-row flex-wrap gap-1.5 mb-3">
        {TYPE_TABS.map((t) => {
          const active = type === t.key;
          return (
            <Pressable
              key={t.label} onPress={() => setType(t.key)}
              className="px-3 py-1.5 rounded-full"
              style={{ borderWidth: 1, borderColor: active ? colors.primary : colors.border, backgroundColor: active ? `${colors.primary}1a` : "transparent" }}
            >
              <Text style={{ color: active ? colors.primary : colors.mutedForeground, fontSize: 11, fontFamily: fonts.heading.medium }}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {isLoading ? (
        <View style={{ padding: 16 }}>{ListHeader}<View className="py-16 items-center"><ActivityIndicator color={colors.mutedForeground} /></View></View>
      ) : isError ? (
        <View style={{ padding: 16 }}>
          {ListHeader}
          <View className="items-center py-10">
            <AlertCircle size={20} color={colors.destructive} />
            <Text style={{ color: colors.destructive, fontSize: 12, marginTop: 8, textAlign: "center" }}>Failed to load the stock ledger. Please try again.</Text>
          </View>
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(e) => String(e.StockID)}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
          ListHeaderComponent={ListHeader}
          onEndReachedThreshold={0.4}
          onEndReached={() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage(); }}
          renderItem={({ item }) => <LedgerRow entry={item} showItem={!itemId} />}
          ListEmptyComponent={
            <View className="items-center py-10">
              <AlertCircle size={20} color={`${colors.mutedForeground}80`} />
              <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 8 }}>No transactions found.</Text>
            </View>
          }
          ListFooterComponent={isFetchingNextPage ? <View className="py-4 items-center"><ActivityIndicator size="small" color={colors.mutedForeground} /></View> : null}
        />
      )}
    </View>
  );
}
