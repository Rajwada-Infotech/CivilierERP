// RN port of src/pages/finance/OnAccountAdjustment.tsx (web), on the drawing sheet as the web draws it: the sheet's
// title block with Refresh, the three figures (on-account balance, parties with a balance, credit entries), the party
// balances panel (a bar per party, measured against the largest; tap one to narrow the entries to it) and the credit
// entries as ruled rows with an Adjust key. The "Adjust" action is AdjustModal.tsx — the sheet's list-picker frame,
// matching web's small dialog — rather than a separate route: there's no add/edit document here, just an apply action.
import { useMemo, useState } from "react";
import { View, Text, ScrollView, RefreshControl } from "react-native";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { ArrowRight, RefreshCw } from "lucide-react-native";
import { colors, sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import { usePageRights } from "@/hooks/usePageRights";
import { getOAPartySummary, getAdjustableCredits, type OAPartySummary, type CreditEntry } from "@/api/onAccountApi";
import { Body, Grow, Hatch, Key, Label, LinkLabel, Notice, Panel, Press, RegisterHead, SheetShell, Skel, StatRow } from "@/components/sheet/Sheet";
import { AdjustModal } from "./onAccountAdjustment/AdjustModal";

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

const partyTypeOf = (code: string) => (code === "S" ? "Supplier" : code === "C" ? "Contractor" : code);

/** A party's balance as a bar measured against the largest: solid to the balance, hatched beyond. */
function BalanceBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <View style={{ flex: 1, height: 8, borderWidth: 1, borderColor: S.ink, overflow: "hidden" }}>
      <Hatch id={`oa-${value}-${max}`} />
      <Grow style={{ width: `${pct}%`, height: "100%", backgroundColor: S.blue }} />
    </View>
  );
}

function CreditRow({ entry, live, last, onAdjust }: { entry: CreditEntry; live: number; last: boolean; onAdjust: () => void }) {
  return (
    <View style={{ paddingVertical: 12, borderBottomWidth: last ? 0 : 1, borderBottomColor: S.ruleSoft, gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <Text numberOfLines={1} style={{ fontFamily: fonts.heading.semibold, fontSize: 13, color: S.ink }}>{entry.PartyName}</Text>
          <Text numberOfLines={1} style={{ fontFamily: fonts.body.regular, fontSize: 11.5, color: S.graphite }}>
            {partyTypeOf(entry.PartyTypeCode)} · {entry.PaymentDocNo || "—"}
          </Text>
        </View>
        <Key label="Adjust" icon={<ArrowRight size={12} color={S.ink} />} onPress={onAdjust} style={{ minHeight: 34, paddingHorizontal: 12 }} />
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 2 }}>
        <Body size={11.5} color={S.graphite}>{fmtDate(entry.PaymentDate)}</Body>
        <Body size={11.5} color={S.graphite}>{`Invoice ${entry.InvoiceDocNo || entry.InvoiceRef || "—"}`}</Body>
      </View>

      {entry.InvoiceAmount != null && (
        <View style={{ borderTopWidth: 1, borderTopColor: S.ruleSoft }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", paddingTop: 7 }}>
            <Body size={12} color={S.ink2}>Net payable</Body>
            <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 12.5, color: S.ink }}>{formatINR(entry.InvoiceAmount)}</Text>
          </View>
          {(entry.InvoiceTotalPaid ?? entry.PaymentAmount) != null && (
            <View style={{ flexDirection: "row", justifyContent: "space-between", paddingTop: 4 }}>
              <Body size={12} color={S.ink2}>Total paid</Body>
              <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 12.5, color: S.ink }}>{formatINR(entry.InvoiceTotalPaid ?? entry.PaymentAmount ?? 0)}</Text>
            </View>
          )}
        </View>
      )}

      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", paddingTop: 8, borderTopWidth: 1, borderTopColor: S.ink }}>
        <View>
          <Label>On A/C amount</Label>
          <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 15, color: S.ink, marginTop: 3 }}>{formatINR(entry.ExcessAmount)}</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Label>Party balance</Label>
          <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 15, color: S.blue, marginTop: 3 }}>{formatINR(live)}</Text>
        </View>
      </View>
    </View>
  );
}

export default function OnAccountAdjustmentScreen() {
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
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 96 }}>
        <SheetShell eyebrow="CivilierERP · Finance" title="On A/C adjustment">
          <Notice tone="ink">You don't have permission to view On A/C adjustments.</Notice>
        </SheetShell>
      </ScrollView>
    );
  }

  const suppliers = parties.filter((p) => p.PartyType === "Supplier" || p.PartyType === "S").length;
  const contractors = parties.filter((p) => p.PartyType === "Contractor" || p.PartyType === "C").length;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 96 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={S.ink} />}>
        <SheetShell
          eyebrow="CivilierERP · Finance"
          title="On A/C adjustment"
          subtitle="Excess payments available for adjustment against future invoices"
          action={<Key label={isLoading ? "Reading…" : "Refresh"} icon={<RefreshCw size={13} color={S.ink} />} onPress={onRefresh} disabled={isLoading} style={{ alignSelf: "flex-start" }} />}
        >
          <StatRow
            items={[
              { label: "On A/C balance", value: partiesLoading ? "…" : formatINR(totalBalance), note: `across ${parties.length} ${parties.length === 1 ? "party" : "parties"}` },
              { label: "Parties with a balance", value: partiesLoading ? "…" : String(parties.length), note: `${suppliers} suppliers · ${contractors} contractors` },
              { label: "Credit entries", value: creditsLoading ? "…" : String(credits.length), note: selectedPartyId === "all" ? "all parties" : `filtered · ${selectedParty?.PartyName ?? ""}` },
            ]}
          />

          <Panel title="Party balances">
            {selectedPartyId !== "all" && (
              <View style={{ marginTop: -4 }}>
                <LinkLabel onPress={() => setSelectedPartyId("all")} color={S.blue}>Show all parties</LinkLabel>
              </View>
            )}
            {partiesLoading ? (
              <>
                <Skel h={26} />
                <Skel h={26} />
              </>
            ) : parties.length === 0 ? (
              <Body size={12.5} color={S.graphite}>No On A/C balances found.</Body>
            ) : (
              <View>
                {parties.map((pt, i) => {
                  const live = balanceMap.get(pt.PartyId) ?? pt.Balance;
                  const isSelected = selectedPartyId === String(pt.PartyId);
                  return (
                    <Press
                      key={pt.PartyId}
                      onPress={() => setSelectedPartyId(isSelected ? "all" : String(pt.PartyId))}
                      style={(pressed) => ({
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 10,
                        paddingVertical: 10,
                        paddingHorizontal: 6,
                        borderTopWidth: i ? 1 : 0,
                        borderTopColor: S.ruleSoft,
                        backgroundColor: isSelected || pressed ? S.blueWash : "transparent",
                        borderLeftWidth: isSelected ? 2 : 0,
                        borderLeftColor: S.ink,
                      })}
                    >
                      <View style={{ width: 108 }}>
                        <Text numberOfLines={1} style={{ color: S.ink, fontSize: 12, fontFamily: fonts.body.medium }}>{pt.PartyName}</Text>
                        <Text style={{ color: S.graphite, fontSize: 10.5, marginTop: 1, fontFamily: fonts.body.regular }}>{partyTypeOf(pt.PartyType)}</Text>
                      </View>
                      <BalanceBar value={live} max={maxBalance} />
                      <Text style={{ color: S.ink, fontSize: 12, fontFamily: fonts.heading.semibold, minWidth: 74, textAlign: "right" }}>{formatINR(live)}</Text>
                    </Press>
                  );
                })}
              </View>
            )}
          </Panel>

          <View style={{ borderWidth: 1, borderColor: S.ink, padding: 12, gap: 12 }}>
            <RegisterHead title={selectedPartyId === "all" ? "Credit entries · all parties" : `Credit entries · ${selectedParty?.PartyName ?? ""}`} count={credits.length} unit={["entry", "entries"]} />
            {isLoading ? (
              <>
                <Skel h={90} />
                <Skel h={90} />
              </>
            ) : credits.length === 0 ? (
              <Body color={S.graphite}>No On Account balances available for adjustment.</Body>
            ) : (
              <View>
                {credits.map((c, i) => (
                  <CreditRow key={c.OAId} entry={c} live={balanceMap.get(c.PartyId) ?? c.AvailableBalance} last={i === credits.length - 1} onAdjust={() => setAdjustingEntry(c)} />
                ))}
              </View>
            )}
          </View>
        </SheetShell>
      </ScrollView>

      <AdjustModal
        entry={adjustingEntry}
        currentBalance={adjustingEntry ? balanceMap.get(adjustingEntry.PartyId) ?? adjustingEntry.AvailableBalance : 0}
        onClose={() => setAdjustingEntry(null)}
        onSuccess={handleAdjustSuccess}
      />
    </View>
  );
}
