// RN port of src/pages/material/MaterialDashboard.tsx (web), on the same drawing sheet and in the same order: the
// title block with the date and Re-read, then A right now (MR -> PO -> GRN, each figure opens its records), B ordered
// against received, C material requests, D fourteen days, E purchase orders by status, F most received items,
// G latest documents, H go to. Figures count up as on the web (Tick); bars grow; the parts rise in one by one.
// The web's hover becomes a tap. UOM and T&C masters have no mobile screen and say so.
import { useState } from "react";
import { View, Text, ScrollView, RefreshControl, Alert } from "react-native";
import Svg, { Defs, G, Line, Pattern, Rect, Text as SvgText } from "react-native-svg";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { fetchMaterialDashboard, type DrillKey, type MaterialDashboardData, type PipelineKey } from "@/api/materialDashboardApi";
import type { MainStackParamList } from "@/navigation/MainStack";
import { colors, sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import {
  Body,
  Detail,
  Grow,
  Hatch,
  Label,
  LinkLabel,
  Notice,
  Seg,
  SheetFrame,
  SheetTable,
  Skel,
  Swatch,
  Tick,
  TitleText,
  statusTone, Press } from "@/components/sheet/Sheet";
import { DRILLS, DrillSheet } from "./dashboard/DrillSheet";

const fmt = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n ?? 0);
const short = (v: number) => (v >= 1e7 ? `${(v / 1e7).toFixed(1)}Cr` : v >= 1e5 ? `${(v / 1e5).toFixed(1)}L` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : String(Math.round(v)));
const share = (part: number, whole: number) => (whole > 0 ? Math.min(100, Math.max(0, (part / whole) * 100)) : 0);
const pct = (n: number) => `${Math.round(n)}%`;

type Recent = "grns" | "pos" | "expenses" | "issues" | "requests";
const RECENT: Record<Recent, { label: string; key: keyof MaterialDashboardData; empty: string; route: keyof MainStackParamList }> = {
  grns: { label: "GRNs", key: "recentGRNs", empty: "No goods receipts yet.", route: "GRN" },
  pos: { label: "Purchase orders", key: "recentPOs", empty: "No purchase orders yet.", route: "PurchaseOrder" },
  expenses: { label: "Expenses", key: "recentExpenses", empty: "No expense bookings yet.", route: "Invoice" },
  issues: { label: "Issues", key: "recentIssues", empty: "No material issues yet.", route: "MaterialIssues" },
  requests: { label: "Requests", key: "recentRequests", empty: "No material requests yet.", route: "MaterialRequest" },
};

/** A figure in Sora; give it a Tick or a string. */
function Fig({ children, size = 30, color = S.ink }: { children: React.ReactNode; size?: number; color?: string }) {
  return <Text style={{ fontFamily: fonts.heading.semibold, fontSize: size, lineHeight: size * 1.05, letterSpacing: -size * 0.02, color, fontVariant: ["tabular-nums"] }}>{children}</Text>;
}

/** A legend square for a status: solid when settled, hatched while waiting, red when stopped. */
function StatusSquare({ status }: { status: string }) {
  const tone = statusTone(status);
  return (
    <View style={{ width: 10, height: 10, borderWidth: 1, borderColor: S.ink, overflow: "hidden", backgroundColor: tone === "done" ? S.blue : tone === "stopped" ? S.red : "transparent" }}>
      {tone === "waiting" && <Hatch id={`sq-${status}`} />}
    </View>
  );
}

// ── D: value ordered (PO, solid) against received (GRN, hatched), fourteen days ──
function FortnightPlot({ rows }: { rows: { date: string; grn: number; po: number }[] }) {
  const [tap, setTap] = useState<number | null>(null);
  const [W, setW] = useState(320);
  const H = 214, pad = 4, top = 22, base = 176;
  const n = Math.max(1, rows.length);
  const slot = (W - pad * 2) / n;
  const max = Math.max(1, ...rows.flatMap((r) => [r.grn, r.po]));
  const w = Math.min(9, slot * 0.3);
  const cx = (i: number) => pad + slot * i + slot / 2;
  const day = (d: string) => new Date(`${d}T00:00:00`);
  const active = tap != null ? rows[tap] : null;
  return (
    <View onLayout={(e) => setW(Math.max(200, e.nativeEvent.layout.width))}>
      <View style={{ gap: 6, marginBottom: 8 }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
          <Swatch kind="solid" label="Ordered (PO)" />
          <Swatch kind="hatch" label="Received (GRN)" />
        </View>
        <Body size={12} color={S.ink2}>
          {active ? `${day(active.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} · ordered ${fmt(active.po)} · received ${fmt(active.grn)}` : "Tap a day for its figures"}
        </Body>
      </View>
      <Svg width={W} height={H}>
        <Defs>
          <Pattern id="mat-hatch" width={5} height={5} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <Line x1={0} y1={0} x2={0} y2={5} stroke={S.ink} strokeWidth={1.2} />
          </Pattern>
        </Defs>
        <Line x1={pad} x2={W - pad} y1={top} y2={top} stroke={S.rule} strokeDasharray="2 5" />
        <SvgText x={pad + 2} y={top - 6} fontFamily={fonts.body.regular} fontSize={10} fill={S.graphite}>{short(max)}</SvgText>
        {rows.map((r, i) => {
          const on = tap == null || tap === i;
          const hp = (r.po / max) * (base - top);
          const hg = (r.grn / max) * (base - top);
          const d = day(r.date);
          return (
            <G key={r.date} onPress={() => setTap(tap === i ? null : i)}>
              <Rect x={pad + slot * i} y={0} width={slot} height={H} fill={tap === i ? S.blueWash : "transparent"} />
              {r.po > 0 && <Rect x={cx(i) - w - 1} y={base - hp} width={w} height={hp} fill={S.blue} fillOpacity={on ? 0.92 : 0.4} />}
              {r.grn > 0 && <Rect x={cx(i) + 1} y={base - hg} width={w} height={hg} fill="url(#mat-hatch)" stroke={S.ink} strokeWidth={1} opacity={on ? 1 : 0.4} />}
              {r.po === 0 && r.grn === 0 && (
                <SvgText x={cx(i)} y={base - 6} textAnchor="middle" fontFamily={fonts.body.regular} fontSize={10} fill={S.faint}>—</SvgText>
              )}
              <SvgText x={cx(i)} y={base + 16} textAnchor="middle" fontFamily={fonts.heading.semibold} fontSize={9.5} fill={tap === i ? S.ink : S.graphite}>{String(d.getDate())}</SvgText>
              {(i === 0 || d.getDate() === 1) && (
                <SvgText x={cx(i)} y={base + 28} textAnchor="middle" fontFamily={fonts.heading.semibold} fontSize={8} letterSpacing={1} fill={S.faint}>
                  {d.toLocaleDateString("en-IN", { month: "short" }).toUpperCase()}
                </SvgText>
              )}
            </G>
          );
        })}
        <Line x1={pad} x2={W - pad} y1={base} y2={base} stroke={S.ink} strokeWidth={1.5} />
      </Svg>
    </View>
  );
}

function notOnMobile(title: string) {
  Alert.alert(title, `The ${title} screen isn't built on mobile yet. Use the web app for now.`);
}

export default function MaterialDashboardScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const [refreshing, setRefreshing] = useState(false);
  const [drill, setDrill] = useState<DrillKey | null>(null);
  const [recent, setRecent] = useState<Recent>("grns");

  const { data: d, isLoading, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery<MaterialDashboardData>({
    queryKey: ["material-dashboard"],
    queryFn: fetchMaterialDashboard,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
    retry: 1,
  });

  const readAt = dataUpdatedAt ? new Date(dataUpdatedAt) : new Date();
  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const pipelineRows: { doc: string; figures: { key: PipelineKey; label: string; sub: string; late?: boolean }[] }[] = [
    {
      doc: "Material requests",
      figures: [
        { key: "mr-unapproved", label: "Unapproved", sub: "draft or awaiting approval" },
        { key: "mr-pending", label: "Pending", sub: "no PO made" },
        { key: "mr-overdue", label: "Overdue", sub: "past required-by date", late: true },
      ],
    },
    {
      doc: "Purchase orders",
      figures: [
        { key: "po-unapproved", label: "Unapproved", sub: "draft or awaiting approval" },
        { key: "po-pending", label: "Pending", sub: "no GRN made" },
        { key: "po-overdue", label: "Overdue", sub: "past expected delivery", late: true },
      ],
    },
    {
      doc: "Goods receipts",
      figures: [
        { key: "grn-unapproved", label: "Unapproved", sub: "awaiting approval" },
        { key: "grn-pending", label: "Pending", sub: "no invoice booked" },
        { key: "grn-overdue", label: "Overdue", sub: `not invoiced in ${d?.grnInvoiceDays ?? 7} days`, late: true },
      ],
    },
  ];

  const requestRows = d
    ? [
        { label: "Pending", count: d.materialRequests.pending, fill: "none" as const },
        { label: "Approved", count: d.materialRequests.approved, fill: "blue" as const },
        { label: "Ordered", count: d.materialRequests.ordered, fill: "blue" as const },
        { label: "Partially Ordered", count: d.materialRequests.partiallyOrdered, fill: "mid" as const },
        { label: "Draft", count: d.materialRequests.draft, fill: "none" as const },
      ]
    : [];

  const poTotal = d ? d.poStatusBreakdown.reduce((s, r) => s + r.Count, 0) : 0;
  const maxIn = d ? Math.max(1, ...d.topItems.map((i) => Number(i.TotalIn) || 0)) : 1;
  const hasTimeline = !!d && d.timeline.some((t) => t.grn > 0 || t.po > 0);
  const recentRows = ((d?.[RECENT[recent].key] as any[]) ?? []).slice(0, 8);
  const recentDrill: Record<Recent, DrillKey> = { grns: "grns", pos: "pos", expenses: "expenses", issues: "issues", requests: "requests" };

  const shortcuts: { label: string; onPress: () => void }[] = [
    { label: "New GRN", onPress: () => navigation.navigate("GRN") },
    { label: "Purchase order", onPress: () => navigation.navigate("PurchaseOrder") },
    { label: "Issues", onPress: () => navigation.navigate("MaterialIssues") },
    { label: "Material request", onPress: () => navigation.navigate("MaterialRequest") },
    { label: "Expense booking", onPress: () => navigation.navigate("Invoice") },
    { label: "UOM master", onPress: () => notOnMobile("UOM Master") },
    { label: "Inventory", onPress: () => navigation.navigate("Stock") },
    { label: "T&C master", onPress: () => notOnMobile("T&C Master") },
  ];

  const skel3 = (h: number) => (
    <>
      <Skel h={h} />
      <Skel h={h} />
      <Skel h={h} />
    </>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 96 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={S.ink} />}>
        <SheetFrame>
          {/* Title block */}
          <View>
            <View style={{ paddingHorizontal: 16, paddingTop: 20, paddingBottom: 18, gap: 8 }}>
              <Label>CivilierERP · Material</Label>
              <TitleText size={30}>Material overview</TitleText>
              <Body size={13} color={S.ink2}>What has been ordered, received, issued and requested, what is still open, and how stock stands.</Body>
            </View>
            <View style={{ borderTopWidth: 1, borderTopColor: S.ink }}>
              <View style={{ paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: S.ink }}>
                <Label style={{ marginBottom: 3 }}>Date</Label>
                <Body size={13}>{readAt.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</Body>
              </View>
              <View style={{ flexDirection: "row" }}>
                <View style={{ flex: 1, paddingHorizontal: 14, paddingVertical: 10, borderRightWidth: 1, borderRightColor: S.ink }}>
                  <Label style={{ marginBottom: 3 }}>Read at</Label>
                  <Body size={13}>{readAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</Body>
                </View>
                <View style={{ flex: 1, paddingHorizontal: 14, paddingVertical: 10, justifyContent: "flex-end" }}>
                  <LinkLabel onPress={() => refetch()} color={S.blue}>{isFetching ? "Reading…" : "Re-read"}</LinkLabel>
                </View>
              </View>
            </View>
          </View>

          {isError && !d && (
            <View style={{ borderTopWidth: 1, borderTopColor: S.rule, padding: 16 }}>
              <Notice>Could not load the material figures{(error as Error)?.message ? ` (${(error as Error).message})` : ""}. Use Re-read to try again.</Notice>
            </View>
          )}

          {/* A — figures, each opens the records behind it */}
          <Detail tag="A" title="Right now" note="Open a figure">
            {isLoading ? (
              <Skel h={200} />
            ) : !d?.pipeline ? (
              <Body color={S.red}>These figures could not be worked out. Use Re-read to try again.</Body>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View>
                  <View style={{ flexDirection: "row" }}>
                    <View style={{ width: 104 }} />
                    {pipelineRows[0].figures.map((f) => (
                      <View key={f.label} style={{ width: 118, paddingBottom: 10 }}>
                        <Label color={f.late ? S.red : S.graphite}>{f.label}</Label>
                      </View>
                    ))}
                  </View>
                  {pipelineRows.map((row) => (
                    <View key={row.doc} style={{ flexDirection: "row", borderTopWidth: 1, borderTopColor: S.ruleSoft }}>
                      <View style={{ width: 104, paddingVertical: 14, paddingRight: 8, justifyContent: "center" }}>
                        <Label color={S.ink}>{row.doc}</Label>
                      </View>
                      {row.figures.map((f) => {
                        const n = d.pipeline![f.key] ?? 0;
                        const red = !!f.late && n > 0;
                        return (
                          <Press
                            key={f.key}
                            onPress={() => setDrill(f.key)}
                            style={(pressed) => ({ width: 118, paddingVertical: 14, paddingRight: 8, gap: 4, backgroundColor: pressed ? S.blueWash : "transparent" })}
                          >
                            <Text style={{ alignSelf: "flex-start", borderBottomWidth: 1, borderStyle: "dotted", borderBottomColor: red ? S.red : S.graphite }}>
                              <Fig size={28} color={red ? S.red : S.ink}>
                                <Tick value={n} />
                              </Fig>
                            </Text>
                            <Body size={11.5} color={S.graphite}>{f.sub}</Body>
                          </Press>
                        );
                      })}
                    </View>
                  ))}
                </View>
              </ScrollView>
            )}
          </Detail>

          {/* B */}
          <Detail tag="B" title="Ordered against received">
            {isLoading || !d ? (
              <>
                <Skel h={54} w="60%" />
                <Skel h={28} />
                <Skel w="70%" />
              </>
            ) : (
              <>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 20, alignItems: "flex-end" }}>
                  <View style={{ gap: 8 }}>
                    <Label>Ordered (PO)</Label>
                    <Fig size={28}>
                      <Tick value={d.purchaseOrders.totalValue} format={fmt} />
                    </Fig>
                  </View>
                  <View style={{ gap: 8 }}>
                    <Label>Received (GRN)</Label>
                    <Fig size={28} color={S.ink2}>
                      <Tick value={d.grns.totalValue} format={fmt} />
                    </Fig>
                  </View>
                </View>
                <View style={{ marginTop: 20 }}>
                  <View style={{ height: 26, borderWidth: 1.5, borderColor: S.ink, backgroundColor: S.paper, overflow: "hidden" }}>
                    <Hatch id="mat-b" />
                    <Grow style={{ height: "100%", width: `${share(d.grns.totalValue, d.purchaseOrders.totalValue)}%`, backgroundColor: S.blue }} />
                  </View>
                  <Text style={{ marginTop: 6, fontSize: 11.5, color: S.graphite, fontFamily: fonts.body.regular }}>
                    <Tick value={share(d.grns.totalValue, d.purchaseOrders.totalValue)} format={pct} /> of the value ordered has been received · <Tick value={d.purchaseOrders.total} /> orders,{" "}
                    <Tick value={d.grns.total} /> receipts
                  </Text>
                </View>
                <View style={{ marginTop: 16 }}>
                  {[
                    { label: "Still open", sub: <><Tick value={d.purchaseOrders.open} /> orders not yet fully received</>, value: d.purchaseOrders.openValue, go: "pos" as DrillKey },
                    { label: "Expenses booked", sub: <><Tick value={d.expenses.approved} /> approved · <Tick value={d.expenses.pending} /> pending</>, value: d.expenses.totalAmount, go: "expenses" as DrillKey },
                  ].map((s) => (
                    <Press
                      key={s.label}
                      onPress={() => setDrill(s.go)}
                      style={(pressed) => ({ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: S.ruleSoft, backgroundColor: pressed ? S.blueWash : "transparent" })}
                    >
                      <View style={{ flexShrink: 1, gap: 4 }}>
                        <LinkLabel onPress={() => setDrill(s.go)}>{s.label}</LinkLabel>
                        <Text style={{ fontSize: 12, color: S.graphite, fontFamily: fonts.body.regular }}>{s.sub}</Text>
                      </View>
                      <Fig size={20}>
                        <Tick value={s.value} format={fmt} />
                      </Fig>
                    </Press>
                  ))}
                </View>
              </>
            )}
          </Detail>

          {/* C */}
          <Detail tag="C" title="Material requests" note={d ? `${d.materialRequests.total.toLocaleString("en-IN")} in all` : undefined}>
            {isLoading || !d ? (
              skel3(26)
            ) : d.materialRequests.total === 0 ? (
              <Body color={S.graphite}>No material requests yet.</Body>
            ) : (
              <View>
                {requestRows.map((r) => (
                  <Press
                    key={r.label}
                    onPress={() => navigation.navigate("MaterialRequest")}
                    style={(pressed) => ({ paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: S.ruleSoft, opacity: r.count ? 1 : 0.5, backgroundColor: pressed ? S.blueWash : "transparent" })}
                  >
                    <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                      <LinkLabel onPress={() => navigation.navigate("MaterialRequest")}>{r.label}</LinkLabel>
                      <Text style={{ fontSize: 12, color: S.graphite, fontFamily: fonts.body.regular }}>
                        <Fig size={15}>
                          <Tick value={r.count} />
                        </Fig>
                        {"   "}
                        <Tick value={share(r.count, d.materialRequests.total)} format={pct} />
                      </Text>
                    </View>
                    <View style={{ height: 7, marginTop: 7, borderWidth: 1, borderColor: S.ink, overflow: "hidden" }}>
                      <Hatch id={`mr-${r.label}`} />
                      <Grow
                        style={{
                          height: "100%",
                          width: `${share(r.count, d.materialRequests.total)}%`,
                          backgroundColor: r.fill === "blue" ? S.blue : r.fill === "mid" ? S.blueTint : "transparent",
                        }}
                      />
                    </View>
                  </Press>
                ))}
                <Text style={{ marginTop: 10, fontSize: 11.5, color: S.graphite, fontFamily: fonts.body.regular }}>
                  <Tick value={d.materialRequests.thisMonth} /> raised this month
                </Text>
              </View>
            )}
          </Detail>

          {/* D */}
          <Detail tag="D" title="Fourteen days" note="Ordered and received">
            {isLoading ? <Skel h={200} /> : !hasTimeline ? <Body color={S.graphite}>Nothing was ordered or received in the last fourteen days.</Body> : <FortnightPlot rows={d!.timeline} />}
          </Detail>

          {/* E */}
          <Detail tag="E" title="Purchase orders by status" note={d ? `${poTotal.toLocaleString("en-IN")} orders` : undefined}>
            {isLoading || !d ? (
              skel3(26)
            ) : d.poStatusBreakdown.length === 0 ? (
              <Body color={S.graphite}>No purchase orders yet.</Body>
            ) : (
              d.poStatusBreakdown.map((r) => (
                <View key={r.Status} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: S.ruleSoft }}>
                  <StatusSquare status={r.Status || "Draft"} />
                  <Label color={S.ink} style={{ flex: 1 }}>{r.Status || "Draft"}</Label>
                  <Text style={{ fontSize: 12, color: S.graphite, fontFamily: fonts.body.regular }}>
                    <Tick value={r.Count} /> · <Tick value={share(r.Count, poTotal)} format={pct} />
                  </Text>
                  <View style={{ minWidth: 92, alignItems: "flex-end" }}>
                    <Fig size={14}>
                      <Tick value={Number(r.TotalValue)} format={fmt} />
                    </Fig>
                  </View>
                </View>
              ))
            )}
          </Detail>

          {/* F */}
          <Detail tag="F" title="Most received items" note="By quantity in">
            {isLoading || !d ? (
              skel3(24)
            ) : d.topItems.length === 0 ? (
              <Body color={S.graphite}>No stock movements yet.</Body>
            ) : (
              <View>
                {d.topItems.map((item, idx) => {
                  const inQty = Number(item.TotalIn) || 0;
                  const outQty = Number(item.TotalOut) || 0;
                  return (
                    <View key={item.ItemID || idx} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: S.ruleSoft }}>
                      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 10 }}>
                        <Label style={{ width: 16 }}>{String(idx + 1)}</Label>
                        <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, fontSize: 13, color: S.ink, fontFamily: fonts.body.regular }}>{item.ItemName || "Unnamed item"}</Text>
                        <Text style={{ fontSize: 12, color: S.graphite, fontFamily: fonts.body.regular }}>
                          <Tick value={inQty} /> in · <Tick value={outQty} /> out
                        </Text>
                      </View>
                      {/* in measured against the busiest item; the issued share of it drawn over in blue */}
                      <View style={{ marginLeft: 26, marginTop: 6 }}>
                        <View style={{ height: 7, width: `${Math.max(2, share(inQty, maxIn))}%`, borderWidth: 1, borderColor: S.ink, overflow: "hidden" }}>
                          <Hatch id={`ti-${idx}`} />
                          <Grow style={{ height: "100%", width: `${share(outQty, inQty)}%`, backgroundColor: S.blue }} />
                        </View>
                      </View>
                    </View>
                  );
                })}
                <Body size={11.5} color={S.graphite} style={{ marginTop: 10 }}>Bar length is quantity received; the solid part has been issued out.</Body>
              </View>
            )}
          </Detail>

          {/* G — latest documents */}
          <Detail tag="G" title="Latest documents">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
              <Seg options={(Object.keys(RECENT) as Recent[]).map((k) => ({ value: k, label: RECENT[k].label }))} value={recent} onChange={setRecent} />
            </ScrollView>
            {isLoading ? (
              skel3(26)
            ) : recentRows.length === 0 ? (
              <Body color={S.graphite}>{RECENT[recent].empty}</Body>
            ) : (
              <SheetTable rows={recentRows} cols={DRILLS[recentDrill[recent]].cols} keyOf={(_r, i) => `${recent}-${i}`} onRowPress={() => navigation.navigate(RECENT[recent].route as never)} />
            )}
            <View style={{ marginTop: 12 }}>
              <LinkLabel color={S.blue} onPress={() => navigation.navigate(RECENT[recent].route as never)}>{`All ${RECENT[recent].label.toLowerCase()} →`}</LinkLabel>
            </View>
          </Detail>

          {/* H — shortcuts */}
          <Detail tag="H" title="Go to">
            <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
              {shortcuts.map((s) => (
                <Press
                  key={s.label}
                  onPress={s.onPress}
                  style={(pressed) => ({ width: "50%", flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: S.ruleSoft, backgroundColor: pressed ? S.blueWash : "transparent" })}
                >
                  <LinkLabel onPress={s.onPress}>{s.label}</LinkLabel>
                  <Text style={{ color: S.graphite, fontSize: 13 }}>→</Text>
                </Press>
              ))}
            </View>
          </Detail>
        </SheetFrame>
      </ScrollView>

      <DrillSheet open={drill} onClose={() => setDrill(null)} />
    </View>
  );
}
