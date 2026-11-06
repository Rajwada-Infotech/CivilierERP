// RN port of src/pages/finance/TrialBalance.tsx, on the drawing sheet (SheetShell, ruled panels, ink segments for the
// period, a ruled account tree) — account tree with all
// three period modes (FY / Range / As On), Company/Project/Cost Centre
// filters, expand/collapse, tap-to-drill inline transaction list per
// account (with payment-detail drill-through — tapping a payment-sourced
// row opens that payment's full detail), PDF export (via expo-print — CSV
// isn't ported, it needs a file-write capability like expo-file-system that
// isn't installed; PDF covers the sharing/printing use case), and the Cost
// Centre panel (individual PO/GRN/Invoice postings) that REPLACES the tree
// when a cost centre is selected — same behavior as web, not a filter on it.
import { useMemo, useState } from "react";
import { View, Text, ScrollView, RefreshControl, Alert } from "react-native";
import { useQuery } from "@tanstack/react-query";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { ChevronDown, ChevronRight, RefreshCw, Target, Download } from "lucide-react-native";
import {
  fetchFinYears, fetchCompanyOptionsTB, fetchProjectOptionsTB, fetchCostCenterOptions,
  fetchTrialBalance, fetchTrialBalanceEntityTransactions, fetchCostCentreTransactions,
  toDateStr,
  type TBNode, type Option, type TBTransaction, type TBTransactionsResponse, type CCTransactionsResponse,
} from "@/api/trialBalanceApi";
import { getPaymentById, type PaymentRecord } from "@/api/newPaymentApi";
import { colors, sheet as S } from "@/theme/colors";
import { Body, Field, InfoGrid, Input, Key, Label, Notice, Panel, Press, Seg, SheetShell, Skel, StatRow } from "@/components/sheet/Sheet";
import { SheetPicker } from "@/components/sheet/FormParts";
import { OptionPickerModal, PickerRow } from "./payment/OptionPicker";
import { fonts } from "@/theme/fonts";

type FilterMode = "fy" | "range" | "ason";


const TYPE_LABEL: Record<string, string> = { S: "Supplier", C: "Contractor", B: "Bank", A: "Customer", GL: "GL" };

function fmt(n: number) {
  return n === 0 ? "—" : `₹${Math.round(n).toLocaleString("en-IN")}`;
}

function fmtDate(s?: string | null) {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function nodeHasOwnValue(n: TBNode): boolean {
  return n.opening.debit !== 0 || n.opening.credit !== 0 || n.transactions.debit !== 0 || n.transactions.credit !== 0 || n.closing.debit !== 0 || n.closing.credit !== 0;
}

function pruneToActive(nodes: TBNode[]): TBNode[] {
  function walk(n: TBNode): TBNode | null {
    const keptChildren = n.children.map(walk).filter((c): c is TBNode => c !== null);
    if (!nodeHasOwnValue(n) && keptChildren.length === 0) return null;
    return { ...n, children: keptChildren };
  }
  return nodes.map(walk).filter((n): n is TBNode => n !== null);
}

function flattenVisible(nodes: TBNode[], expanded: Set<number>): TBNode[] {
  const result: TBNode[] = [];
  function walk(n: TBNode) {
    result.push(n);
    if (expanded.has(n.id)) n.children.forEach(walk);
  }
  nodes.forEach(walk);
  return result;
}

function collectAllIds(nodes: TBNode[]): number[] {
  const ids: number[] = [];
  function walk(n: TBNode) {
    ids.push(n.id);
    n.children.forEach(walk);
  }
  nodes.forEach(walk);
  return ids;
}

function flattenAll(nodes: TBNode[]): TBNode[] {
  const result: TBNode[] = [];
  function walk(n: TBNode) {
    result.push(n);
    n.children.forEach(walk);
  }
  nodes.forEach(walk);
  return result;
}

// Plain, print-safe HTML — same approach as Invoice/Contract's Print.
function buildTrialBalanceHtml(nodes: TBNode[], periodLabel: string): string {
  const fmtHtml = (n: number) => (n === 0 ? "—" : `₹${Math.round(n).toLocaleString("en-IN")}`);
  const rows = flattenAll(nodes)
    .map((n) => {
      const indent = "&nbsp;&nbsp;".repeat(n.level);
      const namePrefix = n.isGroup ? "▸ " : "";
      return `<tr${n.isGroup ? ' class="grp"' : ""}>
        <td>${indent}${namePrefix}${n.name}${n.code ? ` <span class="code">${n.code}</span>` : ""}</td>
        <td class="amt">${fmtHtml(n.opening.debit)}</td>
        <td class="amt">${fmtHtml(n.opening.credit)}</td>
        <td class="amt">${fmtHtml(n.transactions.debit)}</td>
        <td class="amt">${fmtHtml(n.transactions.credit)}</td>
        <td class="amt">${fmtHtml(n.closing.debit)}</td>
        <td class="amt">${fmtHtml(n.closing.credit)}</td>
      </tr>`;
    })
    .join("");

  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #111; padding: 20px; }
          h1 { font-size: 18px; margin: 0 0 2px; }
          h2 { font-size: 11px; color: #555; margin: 0 0 14px; font-weight: normal; }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 5px 4px; border-bottom: 1px solid #eee; font-size: 10px; text-align: left; }
          th { background: #f5f5f5; text-transform: uppercase; color: #666; font-size: 9px; }
          .amt { text-align: right; }
          .code { color: #888; font-size: 9px; }
          .grp td { font-weight: 700; background: #fafafa; }
        </style>
      </head>
      <body>
        <h1>Trial Balance</h1>
        <h2>${periodLabel}</h2>
        <table>
          <tr>
            <th>Account</th><th>Opening Dr</th><th>Opening Cr</th>
            <th>Txn Dr</th><th>Txn Cr</th><th>Closing Dr</th><th>Closing Cr</th>
          </tr>
          ${rows}
        </table>
      </body>
    </html>
  `;
}

export default function TrialBalanceScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [hideEmpty, setHideEmpty] = useState(true);

  const [selectedFYId, setSelectedFYId] = useState<number | null>(null);
  const [selCompanyId, setSelCompanyId] = useState<number | null>(null);
  const [selProjectId, setSelProjectId] = useState<number | null>(null);
  const [selCostCenterId, setSelCostCenterId] = useState<number | null>(null);

  const [fyPickerOpen, setFyPickerOpen] = useState(false);
  const [companyPickerOpen, setCompanyPickerOpen] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [costCenterPickerOpen, setCostCenterPickerOpen] = useState(false);

  const [drillNodeId, setDrillNodeId] = useState<number | null>(null);
  const [drillData, setDrillData] = useState<TBTransactionsResponse | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);

  // Period mode — FY (default), a manual date Range, or a single As On date
  // (opening = start of the FY through the day before, closing = as of
  // that date). Matches web's three tabs.
  const [filterMode, setFilterMode] = useState<FilterMode>("fy");
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [asOnFyStart, setAsOnFyStart] = useState("");
  const [asOn, setAsOn] = useState("");

  const [exporting, setExporting] = useState(false);

  // Payment-detail drill-through — tapping a payment-sourced row in the
  // account drill-down opens the payment's own full detail.
  const [payDetailId, setPayDetailId] = useState<number | null>(null);
  const { data: payDetail, isLoading: payDetailLoading } = useQuery({
    queryKey: ["tb-payment-detail", payDetailId],
    queryFn: () => getPaymentById(payDetailId!),
    enabled: payDetailId != null,
  });

  const { data: finYears = [] } = useQuery({ queryKey: ["tb-finyears"], queryFn: fetchFinYears });
  const { data: companies = [] } = useQuery({ queryKey: ["tb-companies"], queryFn: fetchCompanyOptionsTB });
  const { data: allProjects = [] } = useQuery({ queryKey: ["tb-projects"], queryFn: fetchProjectOptionsTB });
  const { data: costCenters = [] } = useQuery({ queryKey: ["tb-cost-centers"], queryFn: fetchCostCenterOptions });

  const activeFY = finYears.find((f) => f.FId === selectedFYId) ?? finYears.find((f) => f.FStatus === 1 || f.FStatus === true) ?? finYears[0] ?? null;

  // Seed the Range/As-On date fields from the active FY the first time
  // each mode's inputs are still empty, same as web's switchMode().
  const switchMode = (mode: FilterMode) => {
    setFilterMode(mode);
    if (!activeFY) return;
    const fyStart = toDateStr(activeFY.FStartDate);
    const fyEnd = toDateStr(activeFY.FEndDate);
    if (mode === "range") {
      if (!rangeFrom) setRangeFrom(fyStart);
      if (!rangeTo) setRangeTo(fyEnd);
    } else if (mode === "ason") {
      if (!asOnFyStart) setAsOnFyStart(fyStart);
    }
  };

  const from = filterMode === "fy" ? (activeFY ? toDateStr(activeFY.FStartDate) : "")
    : filterMode === "range" ? rangeFrom
    : asOnFyStart;
  const to = filterMode === "fy" ? (activeFY ? toDateStr(activeFY.FEndDate) : "")
    : filterMode === "range" ? rangeTo
    : (asOn || asOnFyStart);

  const periodLabel = filterMode === "fy" ? (activeFY?.FName ?? "")
    : filterMode === "range" ? `${fmtDate(rangeFrom)} – ${fmtDate(rangeTo)}`
    : asOn ? `As On ${fmtDate(asOn)}` : "";

  const projects = useMemo(() => (selCompanyId ? (allProjects as Option[]).filter((p) => p.company_id === selCompanyId) : allProjects), [allProjects, selCompanyId]);

  const params = { from, to, companyId: selCompanyId, projectId: selProjectId, costCenterId: selCostCenterId };

  const { data: tbData, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["trial-balance", from, to, selCompanyId, selProjectId, selCostCenterId],
    queryFn: () => fetchTrialBalance(params),
    enabled: !!from && !!to,
  });

  const { data: ccData, isLoading: ccLoading } = useQuery({
    queryKey: ["tb-cost-centre-txns", selCostCenterId, from, to, selCompanyId, selProjectId],
    queryFn: () => fetchCostCentreTransactions(selCostCenterId!, params),
    enabled: !!selCostCenterId && !!from && !!to,
  });

  const rows = tbData?.rows ?? [];
  const summary = tbData?.summary ?? null;
  const displayRows = hideEmpty ? pruneToActive(rows) : rows;
  const visible = flattenVisible(displayRows, expanded);
  const balanced = summary ? Math.abs(summary.openingDebit + summary.totalDebit - (summary.openingCredit + summary.totalCredit)) < 1 : false;

  const toggle = (id: number) => setExpanded((prev) => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const expandAll = () => setExpanded(new Set(collectAllIds(displayRows)));

  const openDrill = async (node: TBNode) => {
    if (drillNodeId === node.id) {
      setDrillNodeId(null);
      setDrillData(null);
      return;
    }
    setDrillNodeId(node.id);
    setDrillData(null);
    setDrillLoading(true);
    try {
      const data = await fetchTrialBalanceEntityTransactions(node.id, params);
      setDrillData(data);
    } catch {
      setDrillData(null);
    } finally {
      setDrillLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const openSourceEntry = (t: TBTransaction) => {
    const srcType = (t.sourceType ?? "").toLowerCase();
    const payId = t.payment?.id ?? (srcType === "newpayment" ? t.sourceId : null);
    if (payId) setPayDetailId(payId);
  };

  const handleExportPdf = async () => {
    if (rows.length === 0) return;
    setExporting(true);
    try {
      const html = buildTrialBalanceHtml(displayRows, periodLabel);
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: "Trial Balance" });
      } else {
        await Print.printAsync({ uri });
      }
    } catch (e: any) {
      Alert.alert("Export failed", e?.message ?? "Could not generate the Trial Balance PDF.");
    } finally {
      setExporting(false);
    }
  };

  const companyLabel = companies.find((c) => c.id === selCompanyId)?.label || "";
  const projectLabel = projects.find((p) => p.id === selProjectId)?.label || "";
  const costCenterLabel = costCenters.find((c) => c.id === selCostCenterId)?.label || "";
  const dc = (d: number, c: number) => (d ? `Dr ${fmt(d)}` : c ? `Cr ${fmt(c)}` : "—");

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 96 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={S.ink} />}
      >
        <SheetShell
          eyebrow="CivilierERP · Finance"
          title="Trial balance"
          subtitle={[periodLabel, companyLabel, projectLabel].filter(Boolean).join(" · ") || "Opening, movement and closing balance of every account."}
          action={
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <Key label={exporting ? "Exporting…" : "Export PDF"} icon={<Download size={13} color={S.ink} />} onPress={handleExportPdf} disabled={exporting || rows.length === 0} />
              <Key label={isFetching ? "Reading…" : "Refresh"} icon={<RefreshCw size={13} color={S.ink} />} onPress={() => refetch()} disabled={isFetching} />
            </View>
          }
        >
          {isError && <Notice>Could not load the report. Pull down to try again.</Notice>}

          <Panel title="Period">
            <Seg
              options={[
                { value: "fy", label: "Fin. year" },
                { value: "range", label: "Range" },
                { value: "ason", label: "As on" },
              ]}
              value={filterMode}
              onChange={(m) => switchMode(m as FilterMode)}
            />
            {filterMode === "fy" ? (
              <PickerRow label="Financial Year" value={activeFY ? activeFY.FName : ""} placeholder="Select FY…" onPress={() => setFyPickerOpen(true)} />
            ) : filterMode === "range" ? (
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Field label="From" style={{ flex: 1 }}>
                  <Input value={rangeFrom} onChangeText={setRangeFrom} placeholder="YYYY-MM-DD" />
                </Field>
                <Field label="To" style={{ flex: 1 }}>
                  <Input value={rangeTo} onChangeText={setRangeTo} placeholder="YYYY-MM-DD" />
                </Field>
              </View>
            ) : (
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Field label="FY start" style={{ flex: 1 }}>
                  <Input value={asOnFyStart} onChangeText={setAsOnFyStart} placeholder="YYYY-MM-DD" />
                </Field>
                <Field label="As on" style={{ flex: 1 }}>
                  <Input value={asOn} onChangeText={setAsOn} placeholder="YYYY-MM-DD" />
                </Field>
              </View>
            )}
          </Panel>

          <Panel title="Filters">
            <View>
              <PickerRow label="Company" value={companyLabel} placeholder="All companies" onPress={() => setCompanyPickerOpen(true)} />
              <PickerRow label="Project" value={projectLabel} placeholder="All projects" onPress={() => setProjectPickerOpen(true)} />
              <PickerRow label="Cost Centre" value={costCenterLabel} placeholder="All cost centres" onPress={() => setCostCenterPickerOpen(true)} />
              <Press onPress={() => setHideEmpty((v) => !v)} style={(pressed) => ({ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4, opacity: pressed ? 0.7 : 1 })}>
                <View style={{ width: 18, height: 18, borderWidth: 1.5, borderColor: S.ink, backgroundColor: hideEmpty ? S.ink : "transparent", alignItems: "center", justifyContent: "center" }}>
                  {hideEmpty && <Text style={{ color: S.paper, fontSize: 11, fontFamily: fonts.heading.bold }}>✓</Text>}
                </View>
                <Body size={12.5} color={S.ink2}>Hide accounts with no activity</Body>
              </Press>
            </View>
          </Panel>

          {isLoading ? (
            <>
              <Skel h={60} />
              <Skel h={200} />
            </>
          ) : selCostCenterId ? (
            /* ── The cost centre's own postings — replaces the tree, as on the web ── */
            <Panel title={costCenterLabel || "Cost centre"} icon={<Target size={14} color={S.ink} />}>
              {ccLoading ? (
                <>
                  <Skel h={50} />
                  <Skel h={50} />
                </>
              ) : !ccData || ccData.transactions.length === 0 ? (
                <Body size={12.5} color={S.graphite}>No postings found for this cost centre in the selected period.</Body>
              ) : (
                <>
                  <StatRow
                    items={[
                      { label: "Total debit", value: fmt(ccData.totals.debit) },
                      { label: "Total credit", value: fmt(ccData.totals.credit) },
                    ]}
                  />
                  <View style={{ borderTopWidth: 1, borderTopColor: S.ink }}>
                    {ccData.transactions.map((t, i) => (
                      <View key={t.entryId} style={{ flexDirection: "row", gap: 10, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: S.ruleSoft }}>
                        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                          <Text numberOfLines={1} style={{ color: S.ink, fontSize: 12, fontFamily: fonts.heading.semibold }}>{t.voucherNo || "—"}</Text>
                          <Text numberOfLines={1} style={{ color: S.ink, fontSize: 12, fontFamily: fonts.body.medium }}>{t.account.name || "—"}</Text>
                          {!!(t.poNo || t.docNo) && <Body size={11} color={S.graphite}>{t.poNo || t.docNo || ""}</Body>}
                          {!!t.narration && <Body size={11} color={S.graphite}>{t.narration}</Body>}
                        </View>
                        <View style={{ alignItems: "flex-end", gap: 3 }}>
                          <Body size={11} color={S.graphite}>{fmtDate(t.date)}</Body>
                          {t.debit > 0 && <Text style={{ color: S.ink, fontSize: 13, fontFamily: fonts.heading.semibold }}>{`Dr ${fmt(t.debit)}`}</Text>}
                          {t.credit > 0 && <Text style={{ color: S.blue, fontSize: 13, fontFamily: fonts.heading.semibold }}>{`Cr ${fmt(t.credit)}`}</Text>}
                        </View>
                      </View>
                    ))}
                  </View>
                </>
              )}
            </Panel>
          ) : (
            <>
              {summary && (
                <StatRow
                  items={[
                    { label: "Opening balance", value: fmt(summary.openingDebit + summary.openingCredit), note: "debit and credit" },
                    { label: "Transaction debit", value: fmt(summary.totalDebit), note: "in the period" },
                    { label: "Transaction credit", value: fmt(summary.totalCredit), note: "in the period" },
                    { label: "Net balance", value: fmt(Math.abs(summary.totalDebit - summary.totalCredit)), note: balanced ? "debit and credit agree" : "debit and credit differ", red: !balanced },
                  ]}
                />
              )}

              <View style={{ borderWidth: 1, borderColor: S.ink }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: S.ink }}>
                  <Label color={S.ink}>Accounts</Label>
                  <Seg
                    options={[
                      { value: "expand", label: "Expand all" },
                      { value: "collapse", label: "Collapse" },
                    ]}
                    value={expanded.size > 0 ? "expand" : "collapse"}
                    onChange={(v) => (v === "expand" ? expandAll() : setExpanded(new Set()))}
                  />
                </View>

                {visible.length === 0 ? (
                  <Body color={S.graphite} style={{ padding: 12 }}>No accounts to show for this period.</Body>
                ) : (
                  visible.map((node, idx) => {
                    const hasKids = node.children.length > 0;
                    const isOpen = expanded.has(node.id);
                    const isDrillOpen = drillNodeId === node.id;
                    const top = node.isGroup && node.level === 0;
                    return (
                      <View key={node.id}>
                        <Press
                          onPress={() => (node.isGroup ? (hasKids ? toggle(node.id) : undefined) : openDrill(node))}
                          style={(pressed) => ({
                            paddingVertical: 10,
                            paddingRight: 12,
                            paddingLeft: 12 + node.level * 14,
                            borderTopWidth: idx ? 1 : 0,
                            borderTopColor: top ? S.ink : S.ruleSoft,
                            backgroundColor: isDrillOpen || pressed ? S.blueWash : "transparent",
                            gap: 6,
                          })}
                        >
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                            {node.isGroup && hasKids ? (
                              isOpen ? <ChevronDown size={13} color={S.ink} /> : <ChevronRight size={13} color={S.ink} />
                            ) : (
                              <View style={{ width: 13 }} />
                            )}
                            <Text
                              numberOfLines={1}
                              style={{
                                flexShrink: 1,
                                color: S.ink,
                                fontSize: node.isGroup ? 10.5 : 12.5,
                                letterSpacing: node.isGroup ? 1.1 : 0,
                                textTransform: node.isGroup ? "uppercase" : "none",
                                fontFamily: node.isGroup ? fonts.heading.semibold : fonts.body.medium,
                              }}
                            >
                              {node.name}
                            </Text>
                            {!node.isGroup && !!node.type && <Label>{TYPE_LABEL[node.type] ?? node.type}</Label>}
                          </View>
                          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8, paddingLeft: 19 }}>
                            <View style={{ flex: 1 }}>
                              <Label>Opening</Label>
                              <Text style={{ color: S.ink2, fontSize: 11.5, fontFamily: fonts.body.medium, marginTop: 2 }}>{dc(node.opening.debit, node.opening.credit)}</Text>
                            </View>
                            <View style={{ flex: 1.3 }}>
                              <Label>Dr / Cr</Label>
                              <Text style={{ color: S.ink2, fontSize: 11.5, fontFamily: fonts.body.medium, marginTop: 2 }}>{`${fmt(node.transactions.debit)} / ${fmt(node.transactions.credit)}`}</Text>
                            </View>
                            <View style={{ flex: 1, alignItems: "flex-end" }}>
                              <Label>Closing</Label>
                              <Text style={{ color: node.closing.credit > 0 && !node.closing.debit ? S.blue : S.ink, fontSize: 12, fontFamily: fonts.heading.semibold, marginTop: 2 }}>
                                {dc(node.closing.debit, node.closing.credit)}
                              </Text>
                            </View>
                          </View>
                        </Press>

                        {isDrillOpen && (
                          <View style={{ marginLeft: 12 + node.level * 14, marginRight: 12, marginBottom: 10, borderWidth: 1, borderColor: S.ink }}>
                            <View style={{ paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: S.ink }}>
                              <Label color={S.ink}>{`${node.name} · in the period`}</Label>
                            </View>
                            {drillLoading ? (
                              <View style={{ padding: 10 }}>
                                <Skel h={30} />
                                <Skel h={30} />
                              </View>
                            ) : !drillData || drillData.transactions.length === 0 ? (
                              <Body size={12} color={S.graphite} style={{ padding: 10 }}>No transactions found in the selected period.</Body>
                            ) : (
                              drillData.transactions.map((t, i) => {
                                const isPayment = (t.sourceType ?? "").toLowerCase() === "newpayment" && !!(t.payment?.id ?? t.sourceId);
                                return (
                                  <Press
                                    key={t.entryId ?? i}
                                    onPress={isPayment ? () => openSourceEntry(t) : undefined}
                                    disabled={!isPayment}
                                    style={(pressed) => ({ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 10, paddingVertical: 9, borderTopWidth: i ? 1 : 0, borderTopColor: S.ruleSoft, backgroundColor: pressed ? S.blueWash : "transparent" })}
                                  >
                                    <View style={{ flex: 1, minWidth: 0 }}>
                                      <Text
                                        numberOfLines={1}
                                        style={{ color: S.ink, fontSize: 12, fontFamily: fonts.heading.semibold, textDecorationLine: isPayment ? "underline" : "none", textDecorationStyle: "dashed" }}
                                      >
                                        {t.voucherNo || "—"}
                                      </Text>
                                      <Text numberOfLines={1} style={{ color: S.graphite, fontSize: 11, fontFamily: fonts.body.regular, marginTop: 1 }}>
                                        {fmtDate(t.date)}
                                        {t.narration ? ` · ${t.narration}` : ""}
                                      </Text>
                                    </View>
                                    <Text style={{ color: t.debit ? S.ink : S.blue, fontSize: 12.5, fontFamily: fonts.heading.semibold }}>{t.debit ? `Dr ${fmt(t.debit)}` : `Cr ${fmt(t.credit)}`}</Text>
                                  </Press>
                                );
                              })
                            )}
                          </View>
                        )}
                      </View>
                    );
                  })
                )}
              </View>
            </>
          )}
        </SheetShell>
      </ScrollView>

      <OptionPickerModal
        visible={fyPickerOpen}
        title="Select financial year"
        options={finYears.map((f) => ({ key: String(f.FId), label: f.FName }))}
        selectedKey={activeFY ? String(activeFY.FId) : null}
        onClose={() => setFyPickerOpen(false)}
        onSelect={(k) => {
          setSelectedFYId(k ? Number(k) : null);
          setFyPickerOpen(false);
        }}
      />
      <OptionPickerModal
        visible={companyPickerOpen}
        title="Select company"
        options={companies.map((c) => ({ key: String(c.id), label: c.label }))}
        selectedKey={selCompanyId != null ? String(selCompanyId) : null}
        clearable
        searchable
        onClose={() => setCompanyPickerOpen(false)}
        onSelect={(k) => {
          setSelCompanyId(k ? Number(k) : null);
          setSelProjectId(null);
          setCompanyPickerOpen(false);
        }}
      />
      <OptionPickerModal
        visible={projectPickerOpen}
        title="Select project"
        options={projects.map((p) => ({ key: String(p.id), label: p.label }))}
        selectedKey={selProjectId != null ? String(selProjectId) : null}
        clearable
        searchable
        onClose={() => setProjectPickerOpen(false)}
        onSelect={(k) => {
          setSelProjectId(k ? Number(k) : null);
          setProjectPickerOpen(false);
        }}
      />
      <OptionPickerModal
        visible={costCenterPickerOpen}
        title="Select cost centre"
        options={costCenters.map((c) => ({ key: String(c.id), label: c.label }))}
        selectedKey={selCostCenterId != null ? String(selCostCenterId) : null}
        clearable
        searchable
        onClose={() => setCostCenterPickerOpen(false)}
        onSelect={(k) => {
          setSelCostCenterId(k ? Number(k) : null);
          setDrillNodeId(null);
          setCostCenterPickerOpen(false);
        }}
      />

      {/* A payment-sourced line opens that payment's own detail */}
      <SheetPicker visible={payDetailId != null} title="Payment detail" onClose={() => setPayDetailId(null)}>
        {payDetailLoading ? (
          <View style={{ padding: 16 }}>
            <Skel h={40} />
            <Skel h={120} />
          </View>
        ) : !payDetail ? (
          <Body color={S.graphite} style={{ padding: 16 }}>Could not load this payment.</Body>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 28, gap: 14 }}>
            <InfoGrid
              items={[
                { label: "Reference", value: payDetail.docNo || "—" },
                { label: "Date", value: fmtDate(payDetail.date) },
                { label: "Mode", value: payDetail.mode || "—" },
                { label: "Status", value: payDetail.displayStatus || payDetail.status || "—" },
                { label: "Paid To", value: payDetail.paidTo || "—" },
                { label: "Bank", value: payDetail.bankName || "—" },
                { label: "Company", value: payDetail.company || "—" },
                { label: "Project", value: payDetail.project || "—" },
                { label: "Expense Ref", value: payDetail.expenseRef || "—" },
              ]}
            />
            <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", paddingTop: 10, borderTopWidth: 1.5, borderTopColor: S.ink }}>
              <Label color={S.ink}>Amount</Label>
              <Text style={{ color: S.ink, fontSize: 18, fontFamily: fonts.heading.semibold }}>{fmt(payDetail.amount ?? 0)}</Text>
            </View>
          </ScrollView>
        )}
      </SheetPicker>
    </View>
  );
}
