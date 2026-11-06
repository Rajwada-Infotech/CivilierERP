// RN port of src/pages/finance/BalanceSheet.tsx, on the drawing sheet as the web draws it: the title block with Print
// (here a shared PDF) and Refresh; the As-at date with its Today / Half-year end / Year end keys and the Company and
// Project pickers; the four figures (assets, liabilities, difference, profit) and the four ratios each marked Healthy /
// Watch / Attention; then the vertical statement under its letterhead — Liabilities (partners' capital roll-forward per
// partner, reserves & surplus, provisions, fixed and current liabilities) and Assets (fixed tangible / intangible,
// investments, current, fictitious), every group numbered as a note and opening to its ledger heads; and the balance check.
import { useMemo, useState } from "react";
import { View, Text, ScrollView, RefreshControl } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Download, Info, RefreshCw } from "lucide-react-native";
import { fetchBalanceSheet, type BalanceSheetResponse, type StatementGroup } from "@/api/financialStatementsApi";
import { fetchCompanyOptionsTB, fetchProjectOptionsTB } from "@/api/trialBalanceApi";
import { colors, sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { Body, Field, Input, Key, Label, Notice, Panel, SheetMark, SheetShell, Skel, StatRow } from "@/components/sheet/Sheet";
import { OptionPickerModal, PickerRow } from "./payment/OptionPicker";
import { HeadsList, KeyRow, Letterhead, SectionHead, StLine, dmy, fyStartYear, htmlRow, inr, isoToday, isNeg, sharePdf, signed } from "./statements/StatementParts";

type Health = "good" | "warn" | "bad" | "neutral";
function ratioHealth(key: string, v: number | null): Health {
  if (v == null) return "neutral";
  switch (key) {
    case "currentRatio": return v >= 2 ? "good" : v >= 1 ? "warn" : "bad";
    case "quickRatio": return v >= 1 ? "good" : v >= 0.5 ? "warn" : "bad";
    case "debtToEquity": return v <= 1 ? "good" : v <= 2 ? "warn" : "bad";
    case "workingCapital": return v > 0 ? "good" : "bad";
    default: return "neutral";
  }
}
const HEALTH_MARK = { good: { text: "Healthy", tone: "done" }, warn: { text: "Watch", tone: "waiting" }, bad: { text: "Attention", tone: "stopped" } } as const;
const r2 = (n: number | null) => (n == null ? "—" : n.toFixed(2));
const sum = (gs: StatementGroup[]) => gs.reduce((s, g) => s + g.total, 0);

function Ratio({ label, value, formatted, healthKey, subtitle, benchmark, right }: { label: string; value: number | null; formatted: string; healthKey: string; subtitle: string; benchmark?: string; right?: boolean }) {
  const h = ratioHealth(healthKey, value);
  return (
    <View style={{ width: "50%", paddingLeft: right ? 14 : 0, paddingRight: right ? 0 : 14, borderLeftWidth: right ? 1 : 0, borderLeftColor: S.rule, gap: 5 }}>
      <Label>{label}</Label>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ fontFamily: fonts.heading.semibold, fontSize: 22, color: h === "bad" ? S.red : S.ink, marginTop: 3, fontVariant: ["tabular-nums"] }}>{formatted}</Text>
      <Body size={11} color={S.graphite}>{subtitle}</Body>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 2 }}>
        {h !== "neutral" && <SheetMark text={HEALTH_MARK[h].text} tone={HEALTH_MARK[h].tone} />}
        {!!benchmark && <Body size={10.5} color={S.graphite}>{benchmark}</Body>}
      </View>
    </View>
  );
}

function Statement({ data, asOfLabel }: { data: BalanceSheetResponse; asOfLabel: string }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const toggle = (k: string) => setOpenKey((c) => (c === k ? null : k));
  // One note counter threaded down the whole statement, as the printed Schedule III "Note No." column runs.
  let note = 1;

  const groups = (gs: StatementGroup[], empty: string) =>
    gs.length === 0 ? (
      <Body size={11} color={S.graphite} style={{ fontStyle: "italic", paddingVertical: 6, paddingLeft: 12 }}>{`— ${empty} —`}</Body>
    ) : (
      gs.map((g) => {
        const k = `g-${g.groupId}`;
        const n = note++;
        const open = openKey === k;
        return (
          <View key={k}>
            <StLine
              label={g.groupName}
              amount={Math.abs(g.total)}
              indent={1}
              aside={`Note ${n}${g.heads.length > 1 ? ` · ${g.heads.length} heads` : ""}`}
              open={open}
              onPress={g.heads.length ? () => toggle(k) : undefined}
            />
            {open && <HeadsList heads={g.heads} indent={1} />}
          </View>
        );
      })
    );

  const block = (label: string, amount: number, gs: StatementGroup[], empty: string) => (
    <View>
      <SectionHead>{label}</SectionHead>
      {groups(gs, empty)}
      <StLine label={`Sub-total: ${label}`} amount={Math.abs(amount)} kind="sub" indent={1} />
    </View>
  );

  const pc = data.partnersCapital;
  const showCredits = pc.partners.some((p) => Math.abs(p.credits) > 0.005);
  const tangible = sum(data.fixedAssets.tangible);
  const intangible = sum(data.fixedAssets.intangible);

  return (
    <View style={{ borderWidth: 1, borderColor: S.ink }}>
      <Letterhead company={data.companyName} statement="Balance Sheet" period={asOfLabel} note="(All amounts in Indian Rupees ₹, unless otherwise stated)" />
      <View style={{ paddingHorizontal: 12, paddingBottom: 14 }}>
        <SectionHead roman="I" ruled>Liabilities</SectionHead>

        {/* Partners' capital: one roll-forward per partner, then the period's profit not yet allocated */}
        <SectionHead>{"Partners' Capital Account"}</SectionHead>
        {pc.partners.length === 0 && <Body size={11} color={S.graphite} style={{ fontStyle: "italic", paddingVertical: 6, paddingLeft: 12 }}>No partner capital recorded</Body>}
        {pc.partners.map((p) => (
          <View key={p.key} style={{ marginBottom: 4 }}>
            <Text style={{ fontFamily: fonts.body.semibold, fontSize: 12, color: S.ink, textDecorationLine: "underline", paddingLeft: 12, paddingTop: 8, paddingBottom: 2 }}>{`${p.name} :`}</Text>
            <StLine label="Balance as per last account" amount={p.opening} indent={2} muted />
            <StLine label="Add: Capital introduced" amount={p.capitalIntroduced} indent={2} muted />
            {showCredits && <StLine label="Add: Share of Profit / Remuneration / Interest" amount={p.credits} indent={2} muted />}
            <StLine label="Sub-total" amount={p.opening + p.capitalIntroduced + p.credits} kind="soft" indent={2} muted />
            <StLine label="Less: Drawings" amount={-Math.abs(p.drawings)} indent={2} muted />
            <StLine label={`Closing balance: ${p.name}`} amount={p.closing} kind="soft" indent={2} strong />
          </View>
        ))}
        <StLine label="Add: Net Profit / (Loss) for the period" note="not yet allocated to partners" amount={pc.netProfitCurrent} kind="soft" indent={1} />
        <StLine label="Sub-total: Partners' Capital Account" amount={pc.total} kind="sub" indent={1} />

        {Math.abs(data.reservesAndSurplus.total) >= 0.005 && (
          <View>
            <SectionHead>{"Reserves & Surplus"}</SectionHead>
            <StLine label="Retained Earnings b/f (Prior Years)" amount={data.reservesAndSurplus.retainedEarningsPrior} indent={1} />
            <StLine label="Sub-total: Reserves & Surplus" amount={Math.abs(data.reservesAndSurplus.total)} kind="sub" indent={1} />
          </View>
        )}

        {block("Provisions & Reserves", sum(data.provisionsReserves), data.provisionsReserves, "No provisions or reserves")}
        {block("Fixed Liabilities", sum(data.fixedLiabilities), data.fixedLiabilities, "No fixed liabilities")}
        {block("Current Liabilities", sum(data.currentLiabilities), data.currentLiabilities, "No current liabilities")}
        <StLine label="Total liabilities" amount={Math.abs(data.totals.liabilities)} kind="total" />

        <View style={{ height: 14 }} />
        <SectionHead roman="II" ruled>Assets</SectionHead>
        <SectionHead>Fixed Assets</SectionHead>
        <Label style={{ paddingLeft: 12, paddingTop: 4 }}>Tangible assets</Label>
        {groups(data.fixedAssets.tangible, "No tangible assets")}
        <Label style={{ paddingLeft: 12, paddingTop: 8 }}>Intangible assets</Label>
        {groups(data.fixedAssets.intangible, "No intangible assets")}
        <StLine label="Sub-total: Fixed Assets" amount={Math.abs(tangible + intangible)} kind="sub" indent={1} />

        {block("Investments", sum(data.investments), data.investments, "No investments")}
        {block("Current Assets", sum(data.currentAssets), data.currentAssets, "No current assets")}
        {block("Fictitious Assets / Deferred Revenue Expenditure", sum(data.fictitiousAssets), data.fictitiousAssets, "No fictitious assets")}
        <StLine label="Total assets" amount={Math.abs(data.totals.assets)} kind="total" />

        {/* The balance check */}
        <View style={{ marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: S.ink, gap: 8 }}>
          <SheetMark
            text={data.balanced ? "Balanced: total liabilities equal total assets" : "Out of balance: check for unposted entries"}
            tone={data.balanced ? "done" : "stopped"}
          />
          <Text style={{ fontFamily: fonts.heading.medium, fontSize: 11, color: S.ink, fontVariant: ["tabular-nums"] }}>
            {`Assets ${inr(data.totals.assets)} · Liabilities ${inr(data.totals.liabilities)}`}
            {!data.balanced && <Text style={{ color: S.red, fontFamily: fonts.heading.semibold }}>{` · Difference ${inr(data.totals.difference)}`}</Text>}
          </Text>
        </View>
        <Body size={10.5} color={S.graphite} style={{ marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: S.rule }}>
          {"Prepared per the classic vertical Balance Sheet format for partnership/proprietorship entities. Every figure is pulled live from the account groups tagged in Account Group Master; tap any row (›) to view the underlying ledger heads. Net Profit is pulled from the current Profit & Loss statement; Partners' Drawings are deducted from Partners' Capital."}
        </Body>
      </View>
    </View>
  );
}

function statementHtml(d: BalanceSheetResponse) {
  const rows: string[] = [];
  const groups = (label: string, gs: StatementGroup[]) => {
    rows.push(htmlRow("sec", label, ""));
    gs.forEach((g) => {
      rows.push(htmlRow("", g.groupName, Math.abs(g.total)));
      g.heads.forEach((h) => rows.push(htmlRow("head", h.name, h.amount)));
    });
    rows.push(htmlRow("sub", `Sub-total: ${label}`, Math.abs(sum(gs))));
  };
  rows.push(htmlRow("sec", "I. Liabilities", ""));
  rows.push(htmlRow("sec", "Partners' Capital Account", ""));
  d.partnersCapital.partners.forEach((p) => {
    rows.push(htmlRow("", `${p.name}: balance as per last account`, p.opening));
    rows.push(htmlRow("head", "Add: Capital introduced", p.capitalIntroduced));
    if (Math.abs(p.credits) > 0.005) rows.push(htmlRow("head", "Add: Share of Profit / Remuneration / Interest", p.credits));
    rows.push(htmlRow("head", "Less: Drawings", -Math.abs(p.drawings)));
    rows.push(htmlRow("sub", `Closing balance: ${p.name}`, p.closing));
  });
  rows.push(htmlRow("", "Add: Net Profit / (Loss) for the period", d.partnersCapital.netProfitCurrent));
  rows.push(htmlRow("sub", "Sub-total: Partners' Capital Account", d.partnersCapital.total));
  if (Math.abs(d.reservesAndSurplus.total) >= 0.005) {
    rows.push(htmlRow("sec", "Reserves & Surplus", ""));
    rows.push(htmlRow("", "Retained Earnings b/f (Prior Years)", d.reservesAndSurplus.retainedEarningsPrior));
  }
  groups("Provisions & Reserves", d.provisionsReserves);
  groups("Fixed Liabilities", d.fixedLiabilities);
  groups("Current Liabilities", d.currentLiabilities);
  rows.push(htmlRow("tot", "Total liabilities", Math.abs(d.totals.liabilities)));
  rows.push(htmlRow("sec", "II. Assets", ""));
  groups("Fixed Assets — Tangible", d.fixedAssets.tangible);
  groups("Fixed Assets — Intangible", d.fixedAssets.intangible);
  groups("Investments", d.investments);
  groups("Current Assets", d.currentAssets);
  groups("Fictitious Assets / Deferred Revenue Expenditure", d.fictitiousAssets);
  rows.push(htmlRow("tot", "Total assets", Math.abs(d.totals.assets)));
  return `<table><tr><th>Particulars</th><th class="amt">Amount ₹</th></tr>${rows.join("")}</table>
    <p style="font-size:10px;margin-top:12px">${d.balanced ? "Balanced: total liabilities equal total assets" : `Out of balance by ${inr(d.totals.difference)}`}</p>`;
}

export default function BalanceSheetScreen() {
  const [asOf, setAsOf] = useState(isoToday);
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [picker, setPicker] = useState<"company" | "project" | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);

  const { data: companies = [] } = useQuery({ queryKey: ["tb-companies"], queryFn: fetchCompanyOptionsTB });
  const { data: projects = [] } = useQuery({ queryKey: ["tb-projects"], queryFn: fetchProjectOptionsTB });

  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(asOf);
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["balance-sheet", asOf, companyId, projectId],
    queryFn: () => fetchBalanceSheet({ asOf, companyId, projectId }),
    enabled: validDate,
  });

  const fy = fyStartYear();
  const preset = asOf === isoToday() ? "today" : asOf.endsWith("-09-30") ? "half" : asOf.endsWith("-03-31") ? "year" : null;
  const asOfLabel = data ? `As at ${dmy(data.asOf, "long")}` : "";
  const companyLabel = companies.find((c) => c.id === companyId)?.label ?? "";
  const projectLabel = projects.find((p) => p.id === projectId)?.label ?? "";
  const r = data?.ratios ?? null;

  const figures = useMemo(() => {
    if (!data) return [];
    const loss = isNeg(data.netProfit);
    return [
      { label: "Total assets", value: inr(data.totals.assets), note: r ? `Current ${inr(r.totalCurrentAssets)} · Non-current ${inr(r.totalNonCurrentAssets)}` : undefined },
      { label: "Total liabilities", value: inr(data.totals.liabilities), note: r ? `Partners' capital ${inr(r.totalEquity)} · Other ${inr(r.totalCurrentLiabilities + r.totalNonCurrentLiabilities)}` : undefined },
      { label: data.balanced ? "Difference" : "Out of balance by", value: inr(data.totals.difference), note: data.balanced ? "liabilities equal assets" : "liabilities and assets do not agree", red: !data.balanced },
      { label: loss ? "Loss for the period" : "Profit for the period", value: signed(data.netProfit), note: "carried into partners' capital", red: loss },
    ];
  }, [data, r]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const exportPdf = async () => {
    if (!data) return;
    setExporting(true);
    await sharePdf(data.companyName || "Consolidated: all companies", `Balance Sheet · ${asOfLabel}`, statementHtml(data));
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
          title="Balance sheet"
          subtitle={[asOfLabel, data?.companyName || (companyId ? null : "All companies")].filter(Boolean).join(" · ") || "What the business owns and owes on a given date."}
          action={
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <Key label={exporting ? "Exporting…" : "Print / PDF"} icon={<Download size={13} color={S.ink} />} onPress={exportPdf} disabled={exporting || !data} />
              <Key label={isFetching ? "Reading…" : "Refresh"} icon={<RefreshCw size={13} color={S.ink} />} onPress={() => refetch()} disabled={isFetching || !validDate} />
            </View>
          }
        >
          <Panel title="As at">
            <Field label="Date">
              <Input value={asOf} onChangeText={setAsOf} placeholder="YYYY-MM-DD" />
            </Field>
            <KeyRow
              options={[
                { value: "today", label: "Today" },
                { value: "half", label: "Half-year end" },
                { value: "year", label: "Year end" },
              ]}
              value={preset}
              onChange={(k) => setAsOf(k === "today" ? isoToday() : k === "half" ? `${fy}-09-30` : `${fy + 1}-03-31`)}
            />
            <View>
              <PickerRow label="Company" value={companyLabel} placeholder="All companies" onPress={() => setPicker("company")} />
              <PickerRow label="Project" value={projectLabel} placeholder="All projects" onPress={() => setPicker("project")} />
            </View>
          </Panel>

          {!validDate && <Notice tone="ink">Type the date as YYYY-MM-DD.</Notice>}
          {isError && <Notice>{(error as Error)?.message || "Could not load the balance sheet."}</Notice>}

          {isLoading && validDate ? (
            <>
              <Skel h={120} />
              <Skel h={320} />
            </>
          ) : data ? (
            <>
              <View style={{ borderWidth: 1, borderColor: S.ink }}>
                <View style={{ padding: 14 }}>
                  <StatRow items={figures} />
                </View>
                {r && (
                  <View style={{ padding: 14, borderTopWidth: 1, borderTopColor: S.ink, gap: 18 }}>
                    <View style={{ flexDirection: "row" }}>
                      <Ratio label="Current ratio" value={r.currentRatio} formatted={r2(r.currentRatio)} healthKey="currentRatio" subtitle="Current assets / current liabilities" benchmark="Ideal ≥ 2.0" />
                      <Ratio label="Quick ratio" value={r.quickRatio} formatted={r2(r.quickRatio)} healthKey="quickRatio" subtitle="(Current assets − stock) / current liabilities" benchmark="Ideal ≥ 1.0" right />
                    </View>
                    <View style={{ flexDirection: "row" }}>
                      <Ratio label="Working capital" value={r.workingCapital} formatted={signed(r.workingCapital)} healthKey="workingCapital" subtitle="Current assets − current liabilities" />
                      <Ratio label="Debt / capital" value={r.debtToEquity} formatted={r2(r.debtToEquity)} healthKey="debtToEquity" subtitle="Total liabilities / partners' capital" benchmark="Ideal ≤ 1.0" right />
                    </View>
                  </View>
                )}
              </View>

              <Statement data={data} asOfLabel={asOfLabel} />

              <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
                <Info size={12} color={S.graphite} style={{ marginTop: 2 }} />
                <Body size={11} color={S.graphite} style={{ flex: 1 }}>
                  Section classification is heuristic-based on Account Group names — set up Partners Drawings / Fictitious Assets account heads in Account Group Master to have them flow in here automatically.
                </Body>
              </View>
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
    </View>
  );
}
