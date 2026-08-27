// RN port of src/pages/finance/OnAccountAdjustment.tsx (web). Web's own
// mobile-collapsed card list (`md:hidden` block) is the direct template for
// CreditCard below, since the desktop <table> has no native-screen
// equivalent. The "Adjust" action dialog is ported as AdjustModal.tsx (a
// bottom sheet here, matching web's centered dialog) rather than a separate
// route — there's no add/edit document on this page, just an apply action.
import { useMemo, useState } from "react";
import { View, Text, FlatList, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Wallet, Users, BadgeDollarSign, RefreshCw, ArrowRight, ShieldOff, AlertCircle } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import { usePageRights } from "@/hooks/usePageRights";
import { getOAPartySummary, getAdjustableCredits, type OAPartySummary, type CreditEntry } from "@/api/onAccountApi";
import { AdjustModal } from "./onAccountAdjustment/AdjustModal";

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function PartyTypePill({ code }: { code: string }) {
  const label = code === "S" ? "Supplier" : code === "C" ? "Contractor" : code;
  const color = code === "S" ? "#3b82f6" : "#8b5cf6";
  return (
    <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: `${color}1a`, borderWidth: 1, borderColor: `${color}40` }}>
      <Text style={{ color, fontSize: 9.5, fontFamily: fonts.heading.semibold }}>{label}</Text>
    </View>
  );
}

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

function BalanceBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <View className="flex-1 rounded-full overflow-hidden" style={{ height: 5, backgroundColor: `${colors.muted}` }}>
      <View style={{ width: `${pct}%`, height: "100%", borderRadius: 3, backgroundColor: "#10b981" }} />
    </View>
  );
}

function CreditCard({ entry, live, onAdjust }: { entry: CreditEntry; live: number; onAdjust: () => void }) {
  return (
    <View className="rounded-2xl p-3.5 mb-2.5" style={{ backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: `${colors.border}99` }}>
      <View className="flex-row items-start justify-between gap-2 mb-2">
        <View className="flex-1 min-w-0">
          <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.semibold }}>{entry.PartyName}</Text>
          <View className="flex-row items-center gap-1.5 mt-1">
            <PartyTypePill code={entry.PartyTypeCode} />
            <Text style={{ color: "#3b82f6", fontSize: 10, fontFamily: fonts.body.medium }}>{entry.PaymentDocNo || "—"}</Text>
          </View>
        </View>
        <Pressable
          onPress={onAdjust}
          className="flex-row items-center gap-1 px-2.5 py-1.5 rounded-lg"
          style={{ borderWidth: 1, borderColor: "#10b98166" }}
        >
          <Text style={{ color: "#10b981", fontSize: 11, fontFamily: fonts.heading.semibold }}>Adjust</Text>
          <ArrowRight size={11} color="#10b981" />
        </Pressable>
      </View>

      <View className="flex-row justify-between mb-2">
        <View>
          <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.body.regular, textTransform: "uppercase" }}>Date</Text>
          <Text style={{ color: colors.foreground, fontSize: 11, marginTop: 1 }}>{fmtDate(entry.PaymentDate)}</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.body.regular, textTransform: "uppercase" }}>Invoice Ref</Text>
          <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 1 }}>{entry.InvoiceDocNo || entry.InvoiceRef || "—"}</Text>
        </View>
      </View>

      {entry.InvoiceAmount != null && (
        <View className="rounded-xl overflow-hidden mb-2" style={{ borderWidth: 1, borderColor: colors.border }}>
          <View className="flex-row items-center justify-between px-3 py-2" style={{ backgroundColor: `${colors.muted}30` }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 10.5 }}>Net Payable</Text>
            <Text style={{ color: colors.foreground, fontSize: 11.5, fontFamily: fonts.heading.semibold }}>{formatINR(entry.InvoiceAmount)}</Text>
          </View>
          {(entry.InvoiceTotalPaid ?? entry.PaymentAmount) != null && (
            <View className="flex-row items-center justify-between px-3 py-2" style={{ borderTopWidth: 1, borderTopColor: `${colors.border}60` }}>
              <Text style={{ color: "#10b981", fontSize: 10.5 }}>Total Paid</Text>
              <Text style={{ color: "#10b981", fontSize: 11.5, fontFamily: fonts.heading.semibold }}>
                {formatINR(entry.InvoiceTotalPaid ?? entry.PaymentAmount ?? 0)}
              </Text>
            </View>
          )}
        </View>
      )}

      <View className="flex-row items-center justify-between pt-2" style={{ borderTopWidth: 1, borderTopColor: colors.border }}>
        <View>
          <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.body.regular, textTransform: "uppercase" }}>On A/C Amt</Text>
          <Text style={{ color: "#d97706", fontSize: 13, fontFamily: fonts.heading.bold, marginTop: 1 }}>{formatINR(entry.ExcessAmount)}</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.body.regular, textTransform: "uppercase" }}>Party Balance</Text>
          <Text style={{ color: "#10b981", fontSize: 13, fontFamily: fonts.heading.bold, marginTop: 1 }}>{formatINR(live)}</Text>
        </View>
      </View>
    </View>
  );
}

export default function OnAccountAdjustmentScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const rights = usePageRights("on-account-adjustment");
  const [selectedPartyId, setSelectedPartyId] = useState<string>("all");
  const [adjustingEntry, setAdjustingEntry] = useState<CreditEntry | null>(null);
  const [liveBalances, setLiveBalances] = useState<Map<number, number>>(new Map());
  const [refreshing, setRefreshing] = useState(false);

  const { data: parties = [], isLoading: partiesLoading, refetch: refetchParties } = useQuery<OAPartySummary[]>({
    queryKey: ["oa-party-summary"],
    queryFn: getOAPartySummary,
    staleTime: 30_000,
    enabled: rights.canView,
  });

  const { data: credits = [], isLoading: creditsLoading, refetch: refetchCredits } = useQuery<CreditEntry[]>({
    queryKey: ["oa-adjustable", selectedPartyId],
    queryFn: () => getAdjustableCredits(selectedPartyId !== "all" ? Number(selectedPartyId) : undefined),
    staleTime: 30_000,
    enabled: rights.canView,
  });

  const isLoading = partiesLoading || creditsLoading;

  const balanceMap = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of parties) m.set(p.PartyId, p.Balance);
    liveBalances.forEach((v, k) => m.set(k, v));
    return m;
  }, [parties, liveBalances]);

  const totalBalance = useMemo(() => Array.from(balanceMap.values()).reduce((s, v) => s + v, 0), [balanceMap]);
  const maxBalance = useMemo(() => Math.max(...Array.from(balanceMap.values()), 0), [balanceMap]);
  const selectedParty = parties.find((p) => String(p.PartyId) === selectedPartyId);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetchParties(), refetchCredits()]);
    setRefreshing(false);
  };

  const handleAdjustSuccess = (partyId: number, newBalance: number) => {
    setLiveBalances((prev) => new Map(prev).set(partyId, newBalance));
    setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ["oa-party-summary"] });
      queryClient.invalidateQueries({ queryKey: ["oa-adjustable"], exact: false });
    }, 800);
  };

  if (!rights.canView) {
    return (
      <View className="flex-1 items-center justify-center px-8" style={{ backgroundColor: colors.background }}>
        <ShieldOff size={28} color={colors.mutedForeground} />
        <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold, marginTop: 12 }}>No access</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, marginTop: 4, textAlign: "center" }}>
          You don't have permission to view On A/C adjustments.
        </Text>
      </View>
    );
  }

  const ListHeader = (
    <View>
      <View className="flex-row items-center gap-2.5 mb-4">
        <View className="w-9 h-9 rounded-xl items-center justify-center" style={{ backgroundColor: "#10b98126", borderWidth: 1, borderColor: "#10b9814d" }}>
          <Wallet size={16} color="#10b981" />
        </View>
        <View className="flex-1">
          <Text style={{ color: colors.foreground, fontFamily: fonts.heading.bold, fontSize: 18 }}>On A/C Adjustment</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.body.regular }}>Excess payments available to adjust</Text>
        </View>
        <Pressable
          onPress={onRefresh}
          disabled={isLoading}
          className="w-8 h-8 rounded-lg items-center justify-center"
          style={{ borderWidth: 1, borderColor: colors.border }}
        >
          {isLoading ? <ActivityIndicator size="small" color={colors.mutedForeground} /> : <RefreshCw size={14} color={colors.mutedForeground} />}
        </Pressable>
      </View>

      <View className="flex-row flex-wrap justify-between mb-2">
        <StatTile label="Total On A/C Balance" value={formatINR(totalBalance)} icon={Wallet} accent="#10b981" wide />
        <StatTile label="Parties with Balance" value={String(parties.length)} icon={Users} accent="#6366f1" />
        <StatTile label="Credit Entries" value={String(credits.length)} icon={BadgeDollarSign} accent="#f59e0b" />
      </View>

      <View className="rounded-2xl overflow-hidden mb-4" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.card}80` }}>
        <View className="flex-row items-center justify-between px-4 py-3" style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <Text style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.heading.semibold }}>Party Balances</Text>
          {selectedPartyId !== "all" && (
            <Pressable onPress={() => setSelectedPartyId("all")}>
              <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.medium, textDecorationLine: "underline" }}>Show all</Text>
            </Pressable>
          )}
        </View>
        {partiesLoading ? (
          <View className="py-8 items-center"><ActivityIndicator size="small" color={colors.mutedForeground} /></View>
        ) : parties.length === 0 ? (
          <Text style={{ color: colors.mutedForeground, fontSize: 12, textAlign: "center", paddingVertical: 24 }}>No On A/C balances found.</Text>
        ) : (
          parties.map((p, i) => {
            const live = balanceMap.get(p.PartyId) ?? p.Balance;
            const isSelected = selectedPartyId === String(p.PartyId);
            return (
              <Pressable
                key={p.PartyId}
                onPress={() => setSelectedPartyId(isSelected ? "all" : String(p.PartyId))}
                className="flex-row items-center gap-3 px-4 py-3"
                style={{
                  borderTopWidth: i > 0 ? 1 : 0, borderTopColor: `${colors.border}80`,
                  backgroundColor: isSelected ? "#10b9810d" : "transparent",
                  borderLeftWidth: isSelected ? 2 : 0, borderLeftColor: "#10b981",
                }}
              >
                <View style={{ width: 110 }}>
                  <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 11.5, fontFamily: fonts.body.medium }}>{p.PartyName}</Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 9.5, marginTop: 1 }}>{p.PartyType}</Text>
                </View>
                <BalanceBar value={live} max={maxBalance} />
                <Text style={{ color: "#10b981", fontSize: 11, fontFamily: fonts.heading.bold }}>{formatINR(live)}</Text>
              </Pressable>
            );
          })
        )}
      </View>

      <View className="flex-row items-center justify-between mb-2.5">
        <Text style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.heading.semibold }}>Credit Entries</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.body.regular }}>
          {selectedPartyId === "all" ? "All parties" : selectedParty?.PartyName ?? ""}
        </Text>
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <FlatList
        data={credits}
        keyExtractor={(c) => String(c.OAId)}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        ListHeaderComponent={ListHeader}
        renderItem={({ item }) => (
          <CreditCard entry={item} live={balanceMap.get(item.PartyId) ?? item.AvailableBalance} onAdjust={() => setAdjustingEntry(item)} />
        )}
        ListEmptyComponent={
          !isLoading ? (
            <View className="items-center py-16">
              <AlertCircle size={20} color={`${colors.mutedForeground}80`} />
              <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, marginTop: 8 }}>
                No On Account balances available for adjustment.
              </Text>
            </View>
          ) : (
            <View className="py-16 items-center"><ActivityIndicator color={colors.mutedForeground} /></View>
          )
        }
      />

      <AdjustModal
        entry={adjustingEntry}
        currentBalance={adjustingEntry ? balanceMap.get(adjustingEntry.PartyId) ?? adjustingEntry.AvailableBalance : 0}
        onClose={() => setAdjustingEntry(null)}
        onSuccess={handleAdjustSuccess}
      />
    </View>
  );
}
