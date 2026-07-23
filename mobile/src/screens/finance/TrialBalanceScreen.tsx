// RN port of src/pages/finance/TrialBalance.tsx — FY-scoped account tree
// (Range/As On period modes aren't ported, same "one piece at a time"
// scoping as the rest of Finance mobile) with Company/Project/Cost Centre
// filters, expand/collapse, tap-to-drill inline transaction list per
// account, and the Cost Centre panel (individual PO/GRN/Invoice postings)
// that REPLACES the tree when a cost centre is selected — same behavior
// as web, not a filter on the tree.
import { useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator, RefreshControl, Modal } from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
  Scale, ChevronDown, ChevronRight, Folder, FolderOpen, RefreshCw,
  TrendingUp, TrendingDown, IndianRupee, Briefcase, FolderKanban, Target, Calendar, X,
} from "lucide-react-native";
import {
  fetchFinYears, fetchCompanyOptionsTB, fetchProjectOptionsTB, fetchCostCenterOptions,
  fetchTrialBalance, fetchTrialBalanceEntityTransactions, fetchCostCentreTransactions,
  toDateStr,
  type TBNode, type Option, type TBTransactionsResponse, type CCTransactionsResponse,
} from "@/api/trialBalanceApi";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { SectionLabel } from "@/components/home/SectionLabel";

const ACCENT = "#6467f2";

const TYPE_DOT: Record<string, string> = { S: "#60a5fa", C: "#fb923c", B: "#34d399", A: "#a78bfa", GL: `${ACCENT}b3` };
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

function StatTile({ label, value, icon: Icon, accent }: { label: string; value: string; icon: React.ComponentType<{ size?: number; color?: string }>; accent: string }) {
  return (
    <View style={{ width: "48%", marginBottom: 10 }} className="rounded-xl overflow-hidden">
      <View className="px-3.5 py-3" style={{ backgroundColor: `${colors.card}b3`, borderWidth: 1, borderColor: `${colors.border}80`, borderLeftWidth: 3, borderLeftColor: accent }}>
        <View className="flex-row items-center justify-between mb-1.5">
          <Text style={{ color: `${colors.mutedForeground}b3`, fontSize: 9, fontFamily: fonts.body.regular, textTransform: "uppercase" }}>{label}</Text>
          <Icon size={12} color={accent} />
        </View>
        <Text numberOfLines={1} style={{ color: colors.foreground, fontFamily: fonts.heading.bold, fontSize: 14 }}>{value}</Text>
      </View>
    </View>
  );
}

function OptionSheet({
  visible, title, options, value, onSelect, onClose,
}: {
  visible: boolean; title: string; options: Array<{ id: number | string; label: string }>; value: number | string | null; onSelect: (id: number | string | null) => void; onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }} onPress={onClose}>
        <Pressable onPress={() => {}} style={{ backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "65%", borderWidth: 1, borderColor: colors.border }}>
          <View className="flex-row items-center justify-between px-4 py-3" style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold }}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={8}><X size={16} color={colors.mutedForeground} /></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingVertical: 8, paddingBottom: 20 }}>
            <Pressable onPress={() => onSelect(null)} className="px-5 py-3">
              <Text style={{ color: value == null ? ACCENT : colors.foreground, fontSize: 13, fontFamily: value == null ? fonts.heading.semibold : fonts.body.regular }}>All</Text>
            </Pressable>
            {options.map((o, i) => (
              <Pressable key={`${o.id}-${i}`} onPress={() => onSelect(o.id)} className="px-5 py-3">
                <Text style={{ color: value === o.id ? ACCENT : colors.foreground, fontSize: 13, fontFamily: value === o.id ? fonts.heading.semibold : fonts.body.regular }}>{o.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function FilterChip({ label, icon: Icon, onPress }: { label: string; icon: React.ComponentType<{ size?: number; color?: string }>; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ width: "48%", marginBottom: 8 }} className="flex-row items-center justify-between rounded-xl px-3 py-2.5" >
      <View className="flex-row items-center gap-1.5 flex-1 min-w-0" style={{ backgroundColor: `${colors.muted}50`, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 9, flex: 1 }}>
        <Icon size={11} color={colors.mutedForeground} />
        <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 11.5, fontFamily: fonts.body.medium, flexShrink: 1 }}>{label}</Text>
        <ChevronDown size={11} color={colors.mutedForeground} style={{ marginLeft: "auto" }} />
      </View>
    </Pressable>
  );
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

  const { data: finYears = [] } = useQuery({ queryKey: ["tb-finyears"], queryFn: fetchFinYears });
  const { data: companies = [] } = useQuery({ queryKey: ["tb-companies"], queryFn: fetchCompanyOptionsTB });
  const { data: allProjects = [] } = useQuery({ queryKey: ["tb-projects"], queryFn: fetchProjectOptionsTB });
  const { data: costCenters = [] } = useQuery({ queryKey: ["tb-cost-centers"], queryFn: fetchCostCenterOptions });

  const activeFY = finYears.find((f) => f.FId === selectedFYId) ?? finYears.find((f) => f.FStatus === 1 || f.FStatus === true) ?? finYears[0] ?? null;
  const from = activeFY ? toDateStr(activeFY.FStartDate) : "";
  const to = activeFY ? toDateStr(activeFY.FEndDate) : "";

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

  return (
    <ScrollView
      className="flex-1"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      {/* Header */}
      <View className="flex-row items-center gap-2.5 mb-1">
        <View className="w-9 h-9 rounded-xl items-center justify-center" style={{ backgroundColor: `${ACCENT}26`, borderWidth: 1, borderColor: `${ACCENT}4d` }}>
          <Scale size={16} color={ACCENT} />
        </View>
        <View className="flex-1">
          <Text style={{ color: colors.foreground, fontFamily: fonts.heading.bold, fontSize: 20 }}>Trial Balance</Text>
          <Text style={{ color: `${colors.mutedForeground}b3`, fontSize: 10.5, fontFamily: fonts.body.regular, marginTop: 1 }}>
            Account-wise opening, transaction and closing balances
          </Text>
        </View>
        <Pressable onPress={() => refetch()} disabled={isFetching} hitSlop={8} className="p-2 rounded-lg" style={{ borderWidth: 1, borderColor: colors.border }}>
          {isFetching ? <ActivityIndicator size="small" color={colors.mutedForeground} /> : <RefreshCw size={14} color={colors.mutedForeground} />}
        </Pressable>
      </View>

      {isError && (
        <View className="mt-3 flex-row items-center gap-2 px-4 py-2.5 rounded-xl" style={{ backgroundColor: `${colors.destructive}1a`, borderWidth: 1, borderColor: `${colors.destructive}33` }}>
          <Text style={{ color: colors.destructive, fontSize: 11, fontFamily: fonts.body.medium, flex: 1 }}>Could not load the report.</Text>
        </View>
      )}

      {/* Filters */}
      <View className="mt-5">
        <SectionLabel>Filters</SectionLabel>
        <View className="flex-row flex-wrap justify-between">
          <FilterChip label={activeFY ? activeFY.FName : "Select FY…"} icon={Calendar} onPress={() => setFyPickerOpen(true)} />
          <FilterChip label={companies.find((c) => c.id === selCompanyId)?.label || "All companies"} icon={Briefcase} onPress={() => setCompanyPickerOpen(true)} />
          <FilterChip label={projects.find((p) => p.id === selProjectId)?.label || "All projects"} icon={FolderKanban} onPress={() => setProjectPickerOpen(true)} />
          <FilterChip label={costCenters.find((c) => c.id === selCostCenterId)?.label || "All cost centres"} icon={Target} onPress={() => setCostCenterPickerOpen(true)} />
        </View>
        <Pressable onPress={() => setHideEmpty((v) => !v)} className="flex-row items-center gap-2 mt-1">
          <View className="w-4 h-4 rounded items-center justify-center" style={{ borderWidth: 1, borderColor: hideEmpty ? ACCENT : colors.border, backgroundColor: hideEmpty ? ACCENT : "transparent" }}>
            {hideEmpty && <View style={{ width: 7, height: 7, borderRadius: 1, backgroundColor: "#fff" }} />}
          </View>
          <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular }}>Hide accounts with no activity</Text>
        </Pressable>
      </View>

      {isLoading ? (
        <View className="py-16 items-center"><ActivityIndicator color={colors.mutedForeground} /></View>
      ) : selCostCenterId ? (
        /* ── Cost Centre panel — replaces the tree entirely ── */
        <View className="mt-5">
          <SectionLabel>{costCenters.find((c) => c.id === selCostCenterId)?.label ?? "Cost Centre"}</SectionLabel>
          {ccLoading ? (
            <View className="py-12 items-center"><ActivityIndicator color={colors.mutedForeground} /></View>
          ) : !ccData || ccData.transactions.length === 0 ? (
            <Text className="text-center py-10" style={{ color: `${colors.mutedForeground}80`, fontSize: 12, fontFamily: fonts.body.regular }}>
              No postings found for this cost centre in the selected period.
            </Text>
          ) : (
            <>
              <View className="flex-row justify-between mb-3">
                <StatTile label="Total Debit" value={fmt(ccData.totals.debit)} icon={TrendingUp} accent="#fb7185" />
                <StatTile label="Total Credit" value={fmt(ccData.totals.credit)} icon={TrendingDown} accent="#34d399" />
              </View>
              {ccData.transactions.map((t) => (
                <View key={t.entryId} className="rounded-xl p-3 mb-2" style={{ backgroundColor: `${colors.card}b3`, borderWidth: 1, borderColor: `${colors.border}80` }}>
                  <View className="flex-row items-start justify-between gap-2">
                    <View className="flex-1 min-w-0">
                      <Text numberOfLines={1} style={{ color: ACCENT, fontSize: 11.5, fontFamily: fonts.heading.semibold }}>{t.voucherNo || "—"}</Text>
                      <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 11.5, fontFamily: fonts.body.medium, marginTop: 2 }}>{t.account.name || "—"}</Text>
                      {(t.poNo || t.docNo) && (
                        <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.regular, marginTop: 1 }}>
                          {t.poNo || t.docNo}
                        </Text>
                      )}
                    </View>
                    <View className="items-end">
                      <Text style={{ color: colors.mutedForeground, fontSize: 9.5, fontFamily: fonts.body.regular }}>{fmtDate(t.date)}</Text>
                      {t.debit > 0 && <Text style={{ color: "#fb7185", fontSize: 12, fontFamily: fonts.heading.semibold, marginTop: 3 }}>{fmt(t.debit)}</Text>}
                      {t.credit > 0 && <Text style={{ color: "#34d399", fontSize: 12, fontFamily: fonts.heading.semibold, marginTop: 3 }}>{fmt(t.credit)}</Text>}
                    </View>
                  </View>
                  {!!t.narration && (
                    <Text numberOfLines={2} style={{ color: `${colors.mutedForeground}99`, fontSize: 10, fontFamily: fonts.body.regular, marginTop: 5 }}>{t.narration}</Text>
                  )}
                </View>
              ))}
            </>
          )}
        </View>
      ) : (
        <>
          {/* Stats */}
          {summary && (
            <View className="mt-5">
              <SectionLabel>Overview</SectionLabel>
              <View className="flex-row flex-wrap justify-between">
                <StatTile label="Transaction Debit" value={fmt(summary.totalDebit)} icon={TrendingUp} accent="#fb7185" />
                <StatTile label="Transaction Credit" value={fmt(summary.totalCredit)} icon={TrendingDown} accent="#34d399" />
                <StatTile label="Net Balance" value={fmt(Math.abs(summary.totalDebit - summary.totalCredit))} icon={Scale} accent={balanced ? "#34d399" : "#f59e0b"} />
                <StatTile label="Opening Balance" value={fmt(summary.openingDebit + summary.openingCredit)} icon={IndianRupee} accent={ACCENT} />
              </View>
            </View>
          )}

          {/* Tree */}
          <View className="mt-1 mb-2">
            <View className="flex-row items-center justify-between mb-2">
              <SectionLabel>Accounts</SectionLabel>
              <View className="flex-row gap-1.5 mb-4">
                <Pressable onPress={expandAll} className="px-2.5 py-1 rounded-lg" style={{ borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.medium }}>Expand</Text>
                </Pressable>
                <Pressable onPress={() => setExpanded(new Set())} className="px-2.5 py-1 rounded-lg" style={{ borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.medium }}>Collapse</Text>
                </Pressable>
              </View>
            </View>

            {visible.length === 0 ? (
              <Text className="text-center py-10" style={{ color: `${colors.mutedForeground}80`, fontSize: 12, fontFamily: fonts.body.regular }}>
                No accounts to show for this period.
              </Text>
            ) : (
              visible.map((node) => {
                const hasKids = node.children.length > 0;
                const isOpen = expanded.has(node.id);
                const isDrillOpen = drillNodeId === node.id;
                const dot = node.type ? TYPE_DOT[node.type] : null;
                return (
                  <View key={node.id}>
                    <Pressable
                      onPress={() => (node.isGroup ? (hasKids ? toggle(node.id) : undefined) : openDrill(node))}
                      className="rounded-lg mb-1 px-2.5 py-2.5"
                      style={{
                        marginLeft: node.level * 12,
                        backgroundColor: node.isGroup ? (node.level === 0 ? `${colors.muted}80` : `${colors.muted}40`) : isDrillOpen ? `${ACCENT}18` : `${colors.card}80`,
                        borderWidth: 1,
                        borderColor: isDrillOpen ? `${ACCENT}40` : `${colors.border}60`,
                      }}
                    >
                      <View className="flex-row items-center justify-between gap-2">
                        <View className="flex-row items-center gap-1.5 flex-1 min-w-0">
                          {node.isGroup && hasKids ? (
                            isOpen ? <ChevronDown size={13} color={colors.mutedForeground} /> : <ChevronRight size={13} color={colors.mutedForeground} />
                          ) : (
                            <View style={{ width: 13 }} />
                          )}
                          {node.isGroup ? (
                            isOpen && hasKids ? <FolderOpen size={12} color="#fbbf24" /> : <Folder size={12} color="#fbbf24" />
                          ) : dot ? (
                            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dot }} />
                          ) : null}
                          <Text
                            numberOfLines={1}
                            style={{
                              color: colors.foreground,
                              fontSize: node.isGroup ? (node.level === 0 ? 11 : 11.5) : 11.5,
                              fontFamily: node.isGroup ? fonts.heading.bold : fonts.body.medium,
                              textTransform: node.isGroup ? "uppercase" : "none",
                              flexShrink: 1,
                            }}
                          >
                            {node.name}
                          </Text>
                          {!node.isGroup && node.type && (
                            <Text style={{ color: `${colors.mutedForeground}80`, fontSize: 8.5, fontFamily: fonts.body.regular, textTransform: "uppercase" }}>
                              {TYPE_LABEL[node.type] ?? node.type}
                            </Text>
                          )}
                        </View>
                      </View>
                      <View className="flex-row justify-between mt-1.5">
                        <View>
                          <Text style={{ color: `${colors.mutedForeground}80`, fontSize: 8.5, fontFamily: fonts.body.regular }}>Opening</Text>
                          <Text style={{ color: colors.foreground, fontSize: 10.5, fontFamily: fonts.body.medium }}>
                            {node.opening.debit ? `Dr ${fmt(node.opening.debit)}` : node.opening.credit ? `Cr ${fmt(node.opening.credit)}` : "—"}
                          </Text>
                        </View>
                        <View>
                          <Text style={{ color: `${colors.mutedForeground}80`, fontSize: 8.5, fontFamily: fonts.body.regular }}>Txn Dr / Cr</Text>
                          <Text style={{ color: colors.foreground, fontSize: 10.5, fontFamily: fonts.body.medium }}>
                            {fmt(node.transactions.debit)} / {fmt(node.transactions.credit)}
                          </Text>
                        </View>
                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={{ color: `${colors.mutedForeground}80`, fontSize: 8.5, fontFamily: fonts.body.regular }}>Closing</Text>
                          <Text style={{ color: node.closing.debit > 0 ? "#fb7185" : node.closing.credit > 0 ? "#34d399" : `${colors.mutedForeground}60`, fontSize: 10.5, fontFamily: fonts.heading.semibold }}>
                            {node.closing.debit > 0 ? `Dr ${fmt(node.closing.debit)}` : node.closing.credit > 0 ? `Cr ${fmt(node.closing.credit)}` : "—"}
                          </Text>
                        </View>
                      </View>
                    </Pressable>

                    {isDrillOpen && (
                      <View style={{ marginLeft: node.level * 12 }} className="rounded-xl mb-2 overflow-hidden" >
                        <View className="px-3 py-2" style={{ backgroundColor: `${ACCENT}12`, borderWidth: 1, borderColor: `${ACCENT}30`, borderBottomWidth: 0, borderTopLeftRadius: 12, borderTopRightRadius: 12 }}>
                          <Text style={{ color: ACCENT, fontSize: 10, fontFamily: fonts.heading.semibold }}>{node.name} · transactions in period</Text>
                        </View>
                        <View style={{ borderWidth: 1, borderColor: `${ACCENT}30`, borderTopWidth: 0, borderBottomLeftRadius: 12, borderBottomRightRadius: 12 }}>
                          {drillLoading ? (
                            <View className="py-6 items-center"><ActivityIndicator size="small" color={colors.mutedForeground} /></View>
                          ) : !drillData || drillData.transactions.length === 0 ? (
                            <Text className="text-center py-6" style={{ color: `${colors.mutedForeground}80`, fontSize: 11, fontFamily: fonts.body.regular }}>
                              No transactions found in the selected period.
                            </Text>
                          ) : (
                            drillData.transactions.map((t, i) => (
                              <View
                                key={t.entryId ?? i}
                                className="flex-row items-center justify-between px-3 py-2"
                                style={i < drillData.transactions.length - 1 ? { borderBottomWidth: 1, borderBottomColor: `${colors.border}40` } : undefined}
                              >
                                <View className="flex-1 min-w-0 pr-2">
                                  <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 10.5, fontFamily: fonts.body.medium }}>{t.voucherNo || "—"}</Text>
                                  <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 9.5, fontFamily: fonts.body.regular, marginTop: 1 }}>
                                    {fmtDate(t.date)}{t.narration ? ` · ${t.narration}` : ""}
                                  </Text>
                                </View>
                                <Text style={{ color: t.debit ? "#fb7185" : "#34d399", fontSize: 11, fontFamily: fonts.heading.semibold }}>
                                  {t.debit ? fmt(t.debit) : fmt(t.credit)}
                                </Text>
                              </View>
                            ))
                          )}
                        </View>
                      </View>
                    )}
                  </View>
                );
              })
            )}
          </View>
        </>
      )}

      <OptionSheet
        visible={fyPickerOpen}
        title="Select Financial Year"
        options={finYears.map((f) => ({ id: f.FId, label: f.FName }))}
        value={selectedFYId}
        onClose={() => setFyPickerOpen(false)}
        onSelect={(id) => { setSelectedFYId(id as number | null); setFyPickerOpen(false); }}
      />
      <OptionSheet
        visible={companyPickerOpen}
        title="Select Company"
        options={companies.map((c) => ({ id: c.id, label: c.label }))}
        value={selCompanyId}
        onClose={() => setCompanyPickerOpen(false)}
        onSelect={(id) => { setSelCompanyId(id as number | null); setSelProjectId(null); setCompanyPickerOpen(false); }}
      />
      <OptionSheet
        visible={projectPickerOpen}
        title="Select Project"
        options={projects.map((p) => ({ id: p.id, label: p.label }))}
        value={selProjectId}
        onClose={() => setProjectPickerOpen(false)}
        onSelect={(id) => { setSelProjectId(id as number | null); setProjectPickerOpen(false); }}
      />
      <OptionSheet
        visible={costCenterPickerOpen}
        title="Select Cost Centre"
        options={costCenters.map((c) => ({ id: c.id, label: c.label }))}
        value={selCostCenterId}
        onClose={() => setCostCenterPickerOpen(false)}
        onSelect={(id) => { setSelCostCenterId(id as number | null); setDrillNodeId(null); setCostCenterPickerOpen(false); }}
      />
    </ScrollView>
  );
}
