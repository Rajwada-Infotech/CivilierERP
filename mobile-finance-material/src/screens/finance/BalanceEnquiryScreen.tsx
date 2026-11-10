// RN port of src/pages/finance/BalanceEnquiry.tsx, on the drawing sheet as the web draws it: a bank account's passbook.
// Pick a company (or all) and one of its bank accounts — the first is chosen for you — and a range (Today / 7 days /
// This month / This year / All time, or From / To). The balance block shows the current balance (hidden behind the eye
// key on request; red and marked "overdrawn" below zero), the last activity, the account's particulars (masked number,
// IFSC) and the range's four figures. The passbook lists every payment, receipt, transfer and voucher with the balance
// after each, and (with the export right) goes out as a PDF.
import { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, RefreshControl, Pressable } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Download, Eye, EyeOff, RefreshCw, X } from "lucide-react-native";
import { getBalanceSummary, getEnquiryBanks, getPassbook, type PassbookEntry } from "@/api/financialStatementsApi";
import { fetchCompanyOptionsTB } from "@/api/trialBalanceApi";
import { colors, sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { usePageRights } from "@/hooks/usePageRights";
import { Body, Field, IconKey, Input, Key, Label, Notice, Panel, SheetShell, Skel, StatRow } from "@/components/sheet/Sheet";
import { OptionPickerModal, PickerRow } from "./payment/OptionPicker";
import { KeyRow, dmy, esc, inr, sharePdf } from "./statements/StatementParts";

type Preset = "today" | "week" | "month" | "fy" | "all";
const iso = (d: Date) => d.toISOString().slice(0, 10);
function datePreset(key: Preset): { from: string; to: string } {
  const now = new Date();
  const to = iso(now);
  if (key === "today") return { from: to, to };
  if (key === "week") {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    return { from: iso(d), to };
  }
  if (key === "month") return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to };
  if (key === "fy") return { from: iso(new Date(now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1, 3, 1)), to };
  return { from: "", to: "" };
}

function mask(acc: string | null | undefined) {
  if (!acc) return "•••• ••••";
  const c = acc.replace(/\s+/g, "");
  return c.length <= 4 ? c : `•••• •••• ${c.slice(-4)}`;
}

const SOURCE_LABEL: Record<string, string> = {
  NewPayment: "Payment",
  PaymentPosting: "Payment",
  BounceChargePosting: "Bounce Charge",
  ReceivedPayment: "Received Payment",
  FundTransfer: "Fund Transfer",
  JournalVoucher: "Journal Voucher",
};
const sourceLabel = (t: string) => SOURCE_LABEL[t] || t;
const docRef = (t: PassbookEntry) => t.NewPaymentDocNo || t.ReceivedPaymentDocNo || t.JournalVoucherNo || t.FundTransferDocNo || t.VoucherNo || null;
/** A balance as the passbook writes it: a minus sign below zero. */
const bal = (n: number) => `${Number(n) < 0 ? "−" : ""}${inr(n)}`;

export default function BalanceEnquiryScreen() {
  const rights = usePageRights("balance-enquiry");
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [bankId, setBankId] = useState<number | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [preset, setPreset] = useState<Preset | null>("all");
  const [show, setShow] = useState(true);
  const [picker, setPicker] = useState<"company" | "bank" | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);

  const { data: companies = [] } = useQuery({ queryKey: ["tb-companies"], queryFn: fetchCompanyOptionsTB });
  const companyName = useMemo(() => companies.find((c) => c.id === companyId)?.label ?? "", [companies, companyId]);

  const { data: banks = [], isLoading: loadingBanks } = useQuery({
    queryKey: ["balance-enquiry-banks", companyName],
    queryFn: () => getEnquiryBanks(companyName || undefined),
    staleTime: 5 * 60 * 1000,
  });

  // As the web: the first account is chosen whenever the list changes and the chosen one is no longer in it.
  useEffect(() => {
    if (banks.length === 0) return setBankId(null);
    if (!bankId || !banks.some((b) => b.BId === bankId)) setBankId(banks[0].BId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [banks]);

  const okDate = (d: string) => d === "" || /^\d{4}-\d{2}-\d{2}$/.test(d);
  const range = { from: okDate(from) ? from || undefined : undefined, to: okDate(to) ? to || undefined : undefined };
  const summaryQ = useQuery({
    queryKey: ["balance-enquiry-summary", bankId, range.from, range.to],
    queryFn: () => getBalanceSummary(bankId!, range),
    enabled: !!bankId,
  });
  const passbookQ = useQuery({
    queryKey: ["balance-enquiry-passbook", bankId, range.from, range.to],
    queryFn: () => getPassbook(bankId!, { ...range, limit: 2000 }),
    enabled: !!bankId,
  });

  const sum = summaryQ.data;
  const bank = sum?.bank ?? banks.find((b) => b.BId === bankId);
  const txns = passbookQ.data?.transactions ?? [];
  const balance = sum?.currentBalance ?? 0;
  const overdrawn = balance < -0.005;
  const busy = summaryQ.isFetching || passbookQ.isFetching;
  const bankLabel = (b: (typeof banks)[number]) => `${b.BName ?? "Bank"} — ${mask(b.BAccountNumber)}`;

  const refreshAll = () => Promise.all([summaryQ.refetch(), passbookQ.refetch()]);
  const onRefresh = async () => {
    setRefreshing(true);
    await refreshAll();
    setRefreshing(false);
  };
  const applyPreset = (k: Preset) => {
    setPreset(k);
    const r = datePreset(k);
    setFrom(r.from);
    setTo(r.to);
  };

  const exportPdf = async () => {
    setExporting(true);
    const rows = txns
      .map(
        (t) => `<tr><td>${esc(dmy(t.VoucherDate))}</td><td>${esc(t.Narration || sourceLabel(t.SourceType))}<br/><span style="color:#777">${esc(sourceLabel(t.SourceType))}${t.CostCenterName ? ` · ${esc(t.CostCenterName)}` : ""}</span></td><td>${esc(docRef(t) ?? "—")}</td>
        <td class="amt">${Number(t.DebitAmount) > 0 ? esc(inr(t.DebitAmount)) : ""}</td><td class="amt">${Number(t.CreditAmount) > 0 ? esc(inr(t.CreditAmount)) : ""}</td><td class="amt">${esc(bal(t.RunningBalance))}</td></tr>`,
      )
      .join("");
    await sharePdf(
      `Balance Enquiry — ${bank?.BName ?? ""}`,
      `${mask(bank?.BAccountNumber)} · ${from || to ? `${dmy(from || null)} – ${dmy(to || null)}` : "All time"} · Current balance ${bal(balance)}`,
      `<table><tr><th>Date</th><th>Particulars</th><th>Reference</th><th class="amt">Money in</th><th class="amt">Money out</th><th class="amt">Balance</th></tr>${rows}</table>`,
    );
    setExporting(false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 96 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={S.ink} />}
      >
        <SheetShell
          eyebrow="CivilierERP · Finance"
          title="Balance enquiry"
          subtitle="A bank account's passbook: every payment, receipt, transfer and voucher, with the balance after each."
          action={<Key label={busy ? "Reading…" : "Refresh"} icon={<RefreshCw size={13} color={S.ink} />} onPress={refreshAll} disabled={busy || !bankId} />}
        >
          <Panel title="Account">
            <View>
              <PickerRow label="Company" value={companyName} placeholder="All companies" onPress={() => setPicker("company")} />
              <PickerRow
                label="Bank account"
                value={bank ? bankLabel(bank) : ""}
                placeholder={loadingBanks ? "Loading bank accounts…" : "No bank accounts found"}
                onPress={() => setPicker("bank")}
                disabled={loadingBanks || banks.length === 0}
              />
            </View>
            <Field label="Range">
              <KeyRow
                options={[
                  { value: "today", label: "Today" },
                  { value: "week", label: "7 days" },
                  { value: "month", label: "This month" },
                  { value: "fy", label: "This year" },
                  { value: "all", label: "All time" },
                ]}
                value={preset}
                onChange={applyPreset}
              />
            </Field>
            <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-end" }}>
              <Field label="From" style={{ flex: 1 }}>
                <Input value={from} onChangeText={(v) => { setFrom(v); setPreset(null); }} placeholder="YYYY-MM-DD" />
              </Field>
              <Field label="To" style={{ flex: 1 }}>
                <Input value={to} onChangeText={(v) => { setTo(v); setPreset(null); }} placeholder="YYYY-MM-DD" />
              </Field>
              {(!!from || !!to) && (
                <IconKey onPress={() => applyPreset("all")} size={44}>
                  <X size={14} color={S.ink} />
                </IconKey>
              )}
            </View>
          </Panel>

          {(summaryQ.isError || passbookQ.isError) && <Notice>{((summaryQ.error || passbookQ.error) as Error)?.message || "Could not load this account."}</Notice>}

          {!bankId ? (
            <View style={{ borderWidth: 1, borderColor: S.ink, paddingVertical: 36, paddingHorizontal: 16 }}>
              <Body color={S.graphite} style={{ textAlign: "center" }}>
                {loadingBanks ? "Loading bank accounts…" : "No bank account to show. Select a company with a bank account, or add one in Bank Master."}
              </Body>
            </View>
          ) : (
            <>
              {/* The balance, the account it belongs to, and the range's movement */}
              <View style={{ borderWidth: 1, borderColor: S.ink }}>
                <View style={{ padding: 14, gap: 6 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Label color={overdrawn ? S.red : undefined}>{overdrawn ? "Current balance · overdrawn" : "Current balance"}</Label>
                    <Pressable onPress={() => setShow((v) => !v)} hitSlop={10}>
                      {show ? <Eye size={14} color={S.graphite} /> : <EyeOff size={14} color={S.graphite} />}
                    </Pressable>
                  </View>
                  {summaryQ.isLoading ? (
                    <Skel h={36} w="60%" />
                  ) : (
                    <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5} style={{ fontFamily: fonts.heading.semibold, fontSize: 34, letterSpacing: -0.6, color: overdrawn && show ? S.red : S.ink, fontVariant: ["tabular-nums"] }}>
                      {show ? bal(balance) : "•••••••"}
                    </Text>
                  )}
                  <Body size={12} color={S.graphite}>{sum?.lastTransactionDate ? `Last activity ${dmy(sum.lastTransactionDate)}` : "No activity yet"}</Body>
                </View>

                <View style={{ paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: 1, borderTopColor: S.ink, flexDirection: "row", flexWrap: "wrap", rowGap: 12 }}>
                  {[
                    { l: bank?.BAccountType || "Bank account", v: [bank?.BName, bank?.BBranch].filter(Boolean).join(" · ") || "—", fig: false, wide: true },
                    { l: "Account number", v: mask(bank?.BAccountNumber), fig: true },
                    { l: "IFSC", v: bank?.BIfscCode || "—", fig: true },
                  ].map((x) => (
                    <View key={x.l} style={{ width: x.wide ? "100%" : "50%", paddingRight: 10, gap: 3 }}>
                      <Label>{x.l}</Label>
                      <Text style={{ fontFamily: x.fig ? fonts.heading.semibold : fonts.body.medium, fontSize: 13, color: S.ink, letterSpacing: x.fig ? 0.5 : 0 }}>{x.v}</Text>
                    </View>
                  ))}
                </View>

                <View style={{ padding: 14, borderTopWidth: 1, borderTopColor: S.ink }}>
                  <StatRow
                    items={[
                      { label: "Opening balance", value: bal(sum?.windowOpeningBalance ?? 0), note: "at the start of the range" },
                      { label: "Money in", value: inr(sum?.periodDebit ?? 0), note: "receipts and transfers in" },
                      { label: "Money out", value: inr(sum?.periodCredit ?? 0), note: "payments and transfers out" },
                      { label: "Transactions", value: String(sum?.periodTxnCount ?? 0), note: "in the range" },
                    ]}
                  />
                </View>
              </View>

              {/* The passbook */}
              <View style={{ borderWidth: 1, borderColor: S.ink }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: S.ink }}>
                  <View style={{ flexDirection: "row", alignItems: "baseline", gap: 10 }}>
                    <Label color={S.ink}>Passbook</Label>
                    <Text style={{ fontFamily: fonts.heading.medium, fontSize: 11, color: S.graphite }}>{`${txns.length} entries`}</Text>
                  </View>
                  {rights.canExport && (
                    <Key label={exporting ? "Exporting…" : "PDF"} icon={<Download size={13} color={S.ink} />} onPress={exportPdf} disabled={exporting || passbookQ.isFetching || txns.length === 0} style={{ minHeight: 36, paddingHorizontal: 12 }} />
                  )}
                </View>

                {passbookQ.isLoading ? (
                  <View style={{ padding: 12, gap: 8 }}>
                    <Skel h={44} />
                    <Skel h={44} />
                    <Skel h={44} />
                  </View>
                ) : txns.length === 0 ? (
                  <Body color={S.graphite} style={{ textAlign: "center", paddingVertical: 32 }}>No transactions in this range.</Body>
                ) : (
                  <>
                    {txns.length >= 2000 && (
                      <Body size={12} style={{ paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: S.rule }}>
                        Showing the first 2,000 transactions. Narrow the date range to see the rest.
                      </Body>
                    )}
                    {txns.map((t, i) => {
                      const isIn = Number(t.DebitAmount) > 0; // a bank is an asset: a debit is money in
                      const amount = isIn ? Number(t.DebitAmount) : Number(t.CreditAmount);
                      const ref = docRef(t);
                      return (
                        <View key={t.EntryId} style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 12, paddingVertical: 11, borderTopWidth: i ? 1 : 0, borderTopColor: S.ruleSoft }}>
                          <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                            <Text numberOfLines={2} style={{ fontFamily: fonts.body.semibold, fontSize: 12.5, color: S.ink }}>{t.Narration || sourceLabel(t.SourceType)}</Text>
                            <Text style={{ fontFamily: fonts.body.regular, fontSize: 11, color: S.graphite }}>
                              {[dmy(t.VoucherDate), sourceLabel(t.SourceType), ref, t.CostCenterName].filter(Boolean).join(" · ")}
                            </Text>
                          </View>
                          <View style={{ alignItems: "flex-end", gap: 3 }}>
                            <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 13, color: S.ink, fontVariant: ["tabular-nums"] }}>{`${isIn ? "+" : "−"}${inr(amount)}`}</Text>
                            <Text style={{ fontFamily: fonts.heading.medium, fontSize: 10.5, color: Number(t.RunningBalance) < 0 ? S.red : S.graphite, fontVariant: ["tabular-nums"] }}>{`Bal ${bal(t.RunningBalance)}`}</Text>
                          </View>
                        </View>
                      );
                    })}
                  </>
                )}
              </View>
            </>
          )}
        </SheetShell>
      </ScrollView>

      <OptionPickerModal
        visible={picker === "company"}
        title="Select company"
        options={companies.map((c) => ({ key: String(c.id), label: c.label }))}
        selectedKey={companyId != null ? String(companyId) : null}
        clearable
        searchable
        onClose={() => setPicker(null)}
        onSelect={(k) => {
          setCompanyId(k ? Number(k) : null);
          setPicker(null);
        }}
      />
      <OptionPickerModal
        visible={picker === "bank"}
        title="Select bank account"
        options={banks.map((b) => ({ key: String(b.BId), label: bankLabel(b), sublabel: b.BCompanyName ?? undefined }))}
        selectedKey={bankId != null ? String(bankId) : null}
        searchable
        onClose={() => setPicker(null)}
        onSelect={(k) => {
          if (k) setBankId(Number(k));
          setPicker(null);
        }}
      />
    </View>
  );
}
