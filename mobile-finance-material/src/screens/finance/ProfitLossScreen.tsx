// RN port of src/pages/finance/ProfitAndLoss.tsx, on the drawing sheet as the web draws it: the title block with
// Against prior year (a toggle key), Print (a shared PDF) and Refresh; the period keys (this FY and its four quarters),
// From / To and the Company, Project and Cost Centre pickers; for a structured company the four figures (revenue,
// gross profit, indirect expenses, net profit — a loss in red, in brackets) with the change against the prior year;
// then the statement under its letterhead — Schedule III's vertical form (revenue, other income, direct expenses, gross
// profit, indirect and other sections, net profit; each row opens to its ledger heads, with % of revenue and the prior
// year's figure) or, for a partnership / proprietorship, the classic Trading and P&L account (Dr above Cr on a phone).
import { useMemo, useState } from "react";
import { View, Text, ScrollView, RefreshControl } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Download, Info, RefreshCw } from "lucide-react-native";
import { fetchProfitLoss, type Head, type PLStatement, type ProfitLossResponse } from "@/api/financialStatementsApi";
import { fetchCompanyOptionsTB, fetchCostCenterOptions, fetchProjectOptionsTB } from "@/api/trialBalanceApi";
import { colors, sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { usePageRights } from "@/hooks/usePageRights";
import { Body, Field, Input, Key, Label, Notice, Panel, SheetShell, Skel, StatRow } from "@/components/sheet/Sheet";
import { OptionPickerModal, PickerRow } from "./payment/OptionPicker";
import { HeadsList, KeyRow, Letterhead, SectionHead, StLine, dmy, fyStartYear, htmlRow, inr, isNeg, sharePdf, signed } from "./statements/StatementParts";

type EntityClass = "construction" | "trading" | "services" | "manufacturing" | "generic";
function classifyEntity(t: string | null): EntityClass {
  if (!t) return "generic";
  const s = t.toLowerCase();
  if (s.includes("construction") || s.includes("real estate") || s.includes("developer") || s.includes("infra")) return "construction";
  if (s.includes("trading") || s.includes("trade")) return "trading";
  if (s.includes("service") || s.includes("it ") || s.includes("software") || s.includes("consult")) return "services";
  if (s.includes("manufactur") || s.includes("factory") || s.includes("production")) return "manufacturing";
  return "generic";
}
const CLASS_LABEL: Record<EntityClass, string> = { construction: "Real Estate & Construction", trading: "Trading", services: "Services", manufacturing: "Manufacturing", generic: "General" };
const SECTION_LABELS: Record<string, Partial<Record<EntityClass, string>>> = {
  projectExpenses: { construction: "Contract & Project Costs", generic: "Project & Construction Expenses" },
  costOfMaterials: { construction: "Cost of Construction Materials", manufacturing: "Cost of Raw Materials Consumed", trading: "Cost of Goods Sold", generic: "Cost of Materials Consumed" },
  purchaseStockInTrade: { generic: "Purchases of Stock-in-Trade" },
  stockChanges: { construction: "Changes in WIP / Stock (Completed Projects)", manufacturing: "Changes in Inventories (FG, WIP, RM)", generic: "Changes in Inventories of Stock-in-Trade" },
  employeeBenefits: { construction: "Employee & Labour Benefits Expense", services: "Employee Benefits & Manpower Expense", generic: "Employee Benefits Expense" },
  otherExpenses: { construction: "Other Project & Administrative Expenses", services: "Other Operating & Administrative Expenses", generic: "Other Expenses" },
};
const sectionLabel = (key: string, cls: EntityClass) => SECTION_LABELS[key]?.[cls] ?? SECTION_LABELS[key]?.generic ?? key;
const revenueLabel = (cls: EntityClass) =>
  cls === "construction" ? "Revenue from Contracts / Operations" : cls === "services" ? "Revenue from Services Rendered" : cls === "trading" ? "Revenue from Sale of Goods" : "Revenue from Operations";
const pct = (n: number, base: number) => (base === 0 ? "—" : `${((Math.abs(n) / Math.abs(base)) * 100).toFixed(1)}%`);
const alpha = (n: number) => String.fromCharCode(96 + n);

function shiftYear(d: string, delta: number) {
  const dt = new Date(d);
  dt.setFullYear(dt.getFullYear() + delta);
  return dt.toISOString().slice(0, 10);
}

/** The figure column's second line: % of revenue, and the prior year's figure when comparing. */
const asideOf = (amount: number, base: number, prior?: number) => [`${pct(amount, base)} rev`, prior !== undefined ? `PY ${signed(prior)}` : null].filter(Boolean).join(" · ");

function Structured({ st, prior, cls }: { st: PLStatement; prior: PLStatement | null; cls: EntityClass }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const toggle = (k: string) => setOpenKey((c) => (c === k ? null : k));
  const base = st.totalRevenue;

  const row = (k: string, prefix: string, label: string, amount: number, heads: Head[], priorAmount?: number, sub?: boolean) => (
    <View key={k}>
      <StLine
        prefix={prefix}
        label={label}
        amount={amount}
        indent={sub ? 1 : 0}
        strong={!sub}
        aside={asideOf(amount, base, prior ? priorAmount ?? 0 : undefined)}
        open={openKey === k}
        onPress={heads.length ? () => toggle(k) : undefined}
      />
      {openKey === k && <HeadsList heads={heads} indent={sub ? 2 : 1} />}
    </View>
  );
  const total = (label: string, amount: number, priorAmount: number | undefined, kind: "sub" | "total", note?: string) => (
    <StLine label={label} note={note} amount={amount} kind={kind} aside={asideOf(amount, base, prior ? priorAmount ?? 0 : undefined)} />
  );

  const direct = st.expenseSections.find((s) => s.key === "directExpenses");
  const indirect = st.expenseSections.find((s) => s.key === "indirectExpenses");
  const others = st.expenseSections.filter((s) => s.key !== "directExpenses" && s.key !== "indirectExpenses");
  const priorSec = (key: string) => prior?.expenseSections.find((s) => s.key === key)?.total;

  return (
    <>
      {row("rev-ops", "I.", revenueLabel(cls), st.revenueFromOperations.total, st.revenueFromOperations.heads, prior?.revenueFromOperations.total)}
      {row("other-income", "II.", "Other Income", st.otherIncome.total, st.otherIncome.heads, prior?.otherIncome.total)}
      {total("Total Income (I + II)", st.totalRevenue, prior?.totalRevenue, "sub")}

      <SectionHead roman="III">Expenses</SectionHead>
      {direct && row(`exp-${direct.key}`, "(a)", direct.label ?? sectionLabel(direct.key, cls), direct.total, direct.heads, priorSec(direct.key), true)}
      {total("Gross Profit / (Loss)", st.grossProfit, prior?.grossProfit, "sub", "(Total Revenue − Direct Expenses)")}
      {indirect && row(`exp-${indirect.key}`, "(b)", indirect.label ?? sectionLabel(indirect.key, cls), indirect.total, indirect.heads, priorSec(indirect.key), true)}
      {others.map((s, i) => row(`exp-${s.key}`, `(${alpha(i + 3)})`, s.label ?? sectionLabel(s.key, cls), s.total, s.heads, priorSec(s.key), true))}
      {total("Total Expenses (III)", st.totalExpenses, prior?.totalExpenses, "sub")}

      <View style={{ height: 12 }} />
      {total("Net Profit / (Loss)", st.netProfit, prior?.netProfit, "total", "(Gross Profit − Indirect Expenses)")}

      <Body size={10.5} color={S.graphite} style={{ marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: S.rule }}>
        The accompanying notes form an integral part of these financial statements. Tap any row with a chevron (›) to view its ledger heads.
      </Body>
    </>
  );
}

function Classic({ data }: { data: ProfitLossResponse }) {
  const { income, expenses, totals } = data;
  const profit = totals.netProfit >= 0;
  const grand = Math.max(totals.income, totals.expenses);
  if (income.length === 0 && expenses.length === 0) {
    return <Body size={12} color={S.graphite} style={{ fontStyle: "italic", textAlign: "center", paddingVertical: 28 }}>No transactions found for this period.</Body>;
  }
  return (
    <>
      <SectionHead ruled>Expenditure (Dr.)</SectionHead>
      {expenses.map((g) => <StLine key={`e-${g.groupId}`} label={`To ${g.groupName}`} amount={Math.abs(g.total)} />)}
      {profit && <StLine label="To Net Profit c/f" amount={totals.netProfit} kind="soft" strong />}
      <StLine label="Total" amount={grand} kind="sub" />

      <View style={{ height: 12 }} />
      <SectionHead ruled>Income (Cr.)</SectionHead>
      {income.map((g) => <StLine key={`i-${g.groupId}`} label={`By ${g.groupName}`} amount={Math.abs(g.total)} />)}
      {!profit && Math.abs(totals.netProfit) > 0.005 && <StLine label="By Net Loss c/f" amount={Math.abs(totals.netProfit)} kind="soft" strong color={S.red} />}
      <StLine label="Total" amount={grand} kind="sub" />
    </>
  );
}

function statementHtml(d: ProfitLossResponse, cls: EntityClass) {
  const st = d.statement;
  const rows: string[] = [];
  if (d.presentation === "structured" && st) {
    const line = (label: string, amount: number, heads: Head[], cls2 = "") => {
      rows.push(htmlRow(cls2, label, amount, pct(amount, st.totalRevenue)));
      heads.forEach((h) => rows.push(htmlRow("head", h.name, h.amount, "")));
    };
    line(`I. ${revenueLabel(cls)}`, st.revenueFromOperations.total, st.revenueFromOperations.heads);
    line("II. Other Income", st.otherIncome.total, st.otherIncome.heads);
    rows.push(htmlRow("sub", "Total Income (I + II)", st.totalRevenue, "100.0%"));
    rows.push(htmlRow("sec", "III. Expenses", "", ""));
    st.expenseSections.forEach((s) => line(s.label ?? sectionLabel(s.key, cls), s.total, s.heads));
    rows.push(htmlRow("sub", "Gross Profit / (Loss)", st.grossProfit, pct(st.grossProfit, st.totalRevenue)));
    rows.push(htmlRow("sub", "Total Expenses (III)", st.totalExpenses, pct(st.totalExpenses, st.totalRevenue)));
    rows.push(htmlRow("tot", "Net Profit / (Loss)", st.netProfit, pct(st.netProfit, st.totalRevenue)));
    return `<table><tr><th>Particulars</th><th class="amt">Amount ₹</th><th class="amt">% Rev</th></tr>${rows.join("")}</table>`;
  }
  rows.push(htmlRow("sec", "Expenditure (Dr.)", ""));
  d.expenses.forEach((g) => rows.push(htmlRow("", `To ${g.groupName}`, Math.abs(g.total))));
  if (d.totals.netProfit >= 0) rows.push(htmlRow("", "To Net Profit c/f", d.totals.netProfit));
  rows.push(htmlRow("sec", "Income (Cr.)", ""));
  d.income.forEach((g) => rows.push(htmlRow("", `By ${g.groupName}`, Math.abs(g.total))));
  if (d.totals.netProfit < 0) rows.push(htmlRow("", "By Net Loss c/f", Math.abs(d.totals.netProfit)));
  rows.push(htmlRow("tot", "Total", Math.max(d.totals.income, d.totals.expenses)));
  return `<table><tr><th>Particulars</th><th class="amt">Amount ₹</th></tr>${rows.join("")}</table>`;
}

export default function ProfitLossScreen() {
  const rights = usePageRights("profit-and-loss");
  const fy = fyStartYear();
  const [from, setFrom] = useState(`${fy}-04-01`);
  const [to, setTo] = useState(`${fy + 1}-03-31`);
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [costCentreId, setCostCentreId] = useState<number | null>(null);
  const [compare, setCompare] = useState(false);
  const [picker, setPicker] = useState<"company" | "project" | "cc" | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);

  const { data: companies = [] } = useQuery({ queryKey: ["tb-companies"], queryFn: fetchCompanyOptionsTB });
  const { data: projects = [] } = useQuery({ queryKey: ["tb-projects"], queryFn: fetchProjectOptionsTB });
  const { data: costCentres = [] } = useQuery({ queryKey: ["tb-cost-centers"], queryFn: fetchCostCenterOptions });

  const valid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to);
  const filters = { companyId, projectId, costCenterId: costCentreId };
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["profit-loss", from, to, companyId, projectId, costCentreId],
    queryFn: () => fetchProfitLoss({ from, to, ...filters }),
    enabled: valid,
  });
  const priorQ = useQuery({
    queryKey: ["profit-loss", shiftYear(from, -1), shiftYear(to, -1), companyId, projectId, costCentreId],
    queryFn: () => fetchProfitLoss({ from: shiftYear(from, -1), to: shiftYear(to, -1), ...filters }),
    enabled: valid && compare,
  });

  const quarters: Record<string, [string, string]> = {
    fy: [`${fy}-04-01`, `${fy + 1}-03-31`],
    q1: [`${fy}-04-01`, `${fy}-06-30`],
    q2: [`${fy}-07-01`, `${fy}-09-30`],
    q3: [`${fy}-10-01`, `${fy}-12-31`],
    q4: [`${fy + 1}-01-01`, `${fy + 1}-03-31`],
  };
  const preset = (Object.keys(quarters).find((k) => quarters[k][0] === from && quarters[k][1] === to) ?? null) as string | null;

  const st = data?.statement ?? null;
  const pst = compare ? priorQ.data?.statement ?? null : null;
  const cls = classifyEntity(data?.entityType ?? null);
  const periodLabel = data ? `For the period ${dmy(data.from)} to ${dmy(data.to)}` : "";
  const companyLabel = companies.find((c) => c.id === companyId)?.label ?? "";
  const projectLabel = projects.find((p) => p.id === projectId)?.label ?? "";
  const ccLabel = costCentres.find((c) => c.id === costCentreId)?.label ?? "";

  const figures = useMemo(() => {
    if (!st) return [];
    return [
      { label: "Revenue from operations", value: inr(st.revenueFromOperations.total), note: `plus ${inr(st.otherIncome.total)} other income` },
      { label: isNeg(st.grossProfit) ? "Gross loss" : "Gross profit", value: signed(st.grossProfit), note: `margin ${pct(st.grossProfit, st.revenueFromOperations.total)}`, red: isNeg(st.grossProfit) },
      { label: "Indirect expenses", value: inr(st.indirectTotal), note: `including tax ${inr(st.taxExpense.total)}` },
      { label: isNeg(st.netProfit) ? "Net loss" : "Net profit", value: signed(st.netProfit), note: `margin ${pct(st.netProfit, st.totalRevenue)}`, red: isNeg(st.netProfit) },
    ];
  }, [st]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetch(), compare ? priorQ.refetch() : null]);
    setRefreshing(false);
  };

  const exportPdf = async () => {
    if (!data) return;
    setExporting(true);
    const name = data.presentation === "structured" && st ? "Statement of Profit and Loss" : "Trading and Profit & Loss Account";
    await sharePdf(data.companyName || "Consolidated: all companies", `${name} · ${periodLabel}`, statementHtml(data, cls));
    setExporting(false);
  };

  const structured = data?.presentation === "structured" && !!st;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 96 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={S.ink} />}
      >
        <SheetShell
          eyebrow="CivilierERP · Finance"
          title="Profit and loss"
          subtitle={[periodLabel, data?.companyName || (companyId ? null : "All companies")].filter(Boolean).join(" · ") || "What the business earned and spent over a period."}
          action={
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <Key tone={compare ? "ink" : "line"} label="Against prior year" onPress={() => setCompare((v) => !v)} />
              {rights.canExport && <Key label={exporting ? "Exporting…" : "Print / PDF"} icon={<Download size={13} color={S.ink} />} onPress={exportPdf} disabled={exporting || !data} />}
              <Key label={isFetching ? "Reading…" : "Refresh"} icon={<RefreshCw size={13} color={S.ink} />} onPress={() => refetch()} disabled={isFetching || !valid} />
            </View>
          }
        >
          <Panel title="Period">
            <KeyRow
              options={[
                { value: "fy", label: `FY ${fy}–${String(fy + 1).slice(-2)}` },
                { value: "q1", label: "Q1 Apr–Jun" },
                { value: "q2", label: "Q2 Jul–Sep" },
                { value: "q3", label: "Q3 Oct–Dec" },
                { value: "q4", label: "Q4 Jan–Mar" },
              ]}
              value={preset}
              onChange={(k) => {
                setFrom(quarters[k][0]);
                setTo(quarters[k][1]);
              }}
            />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Field label="From" style={{ flex: 1 }}>
                <Input value={from} onChangeText={setFrom} placeholder="YYYY-MM-DD" />
              </Field>
              <Field label="To" style={{ flex: 1 }}>
                <Input value={to} onChangeText={setTo} placeholder="YYYY-MM-DD" />
              </Field>
            </View>
            <View>
              <PickerRow label="Company" value={companyLabel} placeholder="All companies" onPress={() => setPicker("company")} />
              <PickerRow label="Project" value={projectLabel} placeholder="All projects" onPress={() => setPicker("project")} />
              {costCentres.length > 0 && <PickerRow label="Cost Centre" value={ccLabel} placeholder="All cost centres" onPress={() => setPicker("cc")} />}
            </View>
          </Panel>

          {!valid && <Notice tone="ink">Type both dates as YYYY-MM-DD.</Notice>}
          {isError && <Notice>{(error as Error)?.message || "Could not load the statement."}</Notice>}

          {isLoading && valid ? (
            <>
              <Skel h={120} />
              <Skel h={320} />
            </>
          ) : data ? (
            <>
              {structured && st && (
                <View style={{ borderWidth: 1, borderColor: S.ink }}>
                  <View style={{ padding: 14 }}>
                    <StatRow items={figures} />
                  </View>
                  {compare && (
                    <View style={{ paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: 1, borderTopColor: S.ink, gap: 6 }}>
                      <Label>Against prior year</Label>
                      {priorQ.isLoading ? (
                        <Body size={12} color={S.graphite}>Loading prior year…</Body>
                      ) : !pst ? (
                        <Body size={12} color={S.graphite}>No prior-year statement to compare with.</Body>
                      ) : (
                        <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 16, rowGap: 4 }}>
                          {[
                            { label: "Revenue", cur: st.totalRevenue, pri: pst.totalRevenue },
                            { label: "Gross profit", cur: st.grossProfit, pri: pst.grossProfit },
                            { label: "Net profit", cur: st.netProfit, pri: pst.netProfit },
                          ].map(({ label, cur, pri }) => {
                            const up = cur - pri >= 0;
                            return (
                              <Text key={label} style={{ fontFamily: fonts.body.regular, fontSize: 12, color: S.graphite }}>
                                {`${label} `}
                                <Text style={{ fontFamily: fonts.heading.semibold, color: up ? S.ink : S.red }}>{`${up ? "▲" : "▼"} ${inr(cur - pri)}`}</Text>
                              </Text>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  )}
                </View>
              )}

              <View style={{ borderWidth: 1, borderColor: S.ink }}>
                <Letterhead
                  kicker={data.entityType ? `${CLASS_LABEL[cls]} · ${data.entityType}` : null}
                  company={data.companyName}
                  statement={structured ? "Statement of Profit and Loss" : "Trading and Profit & Loss Account"}
                  period={periodLabel}
                  note="(All amounts in Indian Rupees ₹, unless otherwise stated) · As per Schedule III, Division II, Companies Act 2013"
                />
                <View style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: 14 }}>
                  {structured && st ? <Structured st={st} prior={pst} cls={cls} /> : <Classic data={data} />}
                </View>
              </View>

              {!!data.entityType && (
                <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
                  <Info size={12} color={S.graphite} style={{ marginTop: 2 }} />
                  <Body size={11} color={S.graphite} style={{ flex: 1 }}>
                    {`${data.entityType} · Presenting as ${
                      structured
                        ? "Schedule III, Division II (Companies Act 2013) — Structured vertical format"
                        : "Classic Trading & P&L Account — Traditional Dr/Cr format for non-corporate entities"
                    }.${cls !== "generic" ? ` Industry classification: ${cls.charAt(0).toUpperCase() + cls.slice(1)} — sector-specific line item labels applied.` : ""}`}
                  </Body>
                </View>
              )}
            </>
          ) : null}
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
        visible={picker === "project"}
        title="Select project"
        options={projects.map((p) => ({ key: String(p.id), label: p.label }))}
        selectedKey={projectId != null ? String(projectId) : null}
        clearable
        searchable
        onClose={() => setPicker(null)}
        onSelect={(k) => {
          setProjectId(k ? Number(k) : null);
          setPicker(null);
        }}
      />
      <OptionPickerModal
        visible={picker === "cc"}
        title="Select cost centre"
        options={costCentres.map((c) => ({ key: String(c.id), label: c.label }))}
        selectedKey={costCentreId != null ? String(costCentreId) : null}
        clearable
        searchable
        onClose={() => setPicker(null)}
        onSelect={(k) => {
          setCostCentreId(k ? Number(k) : null);
          setPicker(null);
        }}
      />
    </View>
  );
}

