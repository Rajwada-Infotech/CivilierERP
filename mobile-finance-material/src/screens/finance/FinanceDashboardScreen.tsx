// RN port of src/pages/finance/FinanceDashboard.tsx (web), on the same drawing sheet and in the same order:
// the title block with the date and Re-read, then A received against paid, B today, C fourteen days about the cash
// line, D instruments, E income by month, F latest payments made, G latest receipts, H go to.
//
// The one idea of the page is the cash line: money received is drawn solid above it, money paid out is drawn hatched
// below it — in the totals (A) and day by day (C). Red is kept for a net outflow. The web's hover becomes a tap here:
// tap a day or a month to read its figures. The sheet's parts rise in one after another, the bars grow and the net
// line draws itself, as on the web.
import { useState } from "react";
import { View, Text, ScrollView, Pressable, RefreshControl } from "react-native";
import Svg, { Circle, Defs, G, Line, Pattern, Rect, Text as SvgText } from "react-native-svg";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import {
  fetchFinanceDashboard,
  fetchMonthlyIncome,
  type FinanceDashboardData,
  type MonthlyIncomePoint,
  type RecentPaymentMade,
  type RecentPaymentReceived,
} from "@/api/financeDashboardApi";
import { colors, sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import {
  Body,
  Detail,
  Dimension,
  Grow,
  Hatch,
  Label,
  LinkLabel,
  Notice,
  SheetFrame,
  SheetTable,
  Skel,
  Swatch,
  TitleText,
  AnimatedPath,
  fmtInt,
  n0,
  useDraw,
  type Col, Press } from "@/components/sheet/Sheet";
import type { MainStackParamList } from "@/navigation/MainStack";
import { Alert } from "react-native";

// ─── Helpers (the web page's own) ─────────────────────────────────────────────
const split = (v: unknown) => {
  const n = Math.abs(n0(v));
  if (n >= 1_00_00_000) return { num: (n / 1_00_00_000).toFixed(2), unit: "Cr" };
  if (n >= 1_00_000) return { num: (n / 1_00_000).toFixed(1), unit: "L" };
  if (n >= 1_000) return { num: (n / 1_000).toFixed(0), unit: "K" };
  return { num: n.toFixed(0), unit: "" };
};
const money = (v: unknown) => {
  const m = split(v);
  return `${n0(v) < 0 ? "−" : ""}₹${m.num}${m.unit ? ` ${m.unit}` : ""}`;
};
const fmtDate = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—");
const share = (part: number, whole: number) => (whole > 0 ? Math.min(100, Math.max(0, (part / whole) * 100)) : 0);

/** A money figure: a small ₹, the number, and its unit (Cr / L / K) set smaller after it. */
function MoneyFigure({ value, size = 40, color = S.ink }: { value: unknown; size?: number; color?: string }) {
  const m = split(value);
  return (
    <Text style={{ fontFamily: fonts.heading.semibold, fontSize: size, lineHeight: size * 1.05, letterSpacing: -size * 0.02, color, fontVariant: ["tabular-nums"] }}>
      {n0(value) < 0 ? "−" : ""}
      <Text style={{ fontSize: size * 0.5, fontFamily: fonts.heading.medium }}>₹ </Text>
      {m.num}
      {!!m.unit && <Text style={{ fontSize: size * 0.36, fontFamily: fonts.heading.medium }}> {m.unit}</Text>}
    </Text>
  );
}

/** The plot's caption line: the legend on the left, the tapped day's figures (or how to read it) under it. */
function PlotHead({ legend, reading, scale }: { legend: React.ReactNode; reading: string; scale?: string }) {
  return (
    <View style={{ gap: 6, marginBottom: 8 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>{legend}</View>
      {!!scale && <Body size={11} color={S.graphite}>{scale}</Body>}
      <Body size={12} color={S.ink2}>{reading}</Body>
    </View>
  );
}

// ── C: fourteen days about the cash line — received above it, paid below ────
function CashLinePlot({ rows }: { rows: { date: string; made: number; received: number }[] }) {
  const [tap, setTap] = useState<number | null>(null);
  const [box, setBox] = useState(320);
  const H = 276, pad = 4, top = 44, bottom = 218, mid = (top + bottom) / 2;
  const n = Math.max(1, rows.length);
  const W = box;
  const slot = (W - pad * 2) / n;
  const max = Math.max(1, ...rows.map((r) => Math.max(n0(r.made), n0(r.received))));
  const half = mid - top;
  const cx = (i: number) => pad + slot * i + slot / 2;
  const w = Math.min(18, slot * 0.56);
  const ny = (r: { made: number; received: number }) => mid - ((n0(r.received) - n0(r.made)) / max) * half;
  const net = rows.map((r, i) => `${i ? "L" : "M"}${cx(i).toFixed(1)},${ny(r).toFixed(1)}`).join(" ");
  const len = rows.reduce((acc, r, i) => (i ? acc + Math.hypot(slot, ny(r) - ny(rows[i - 1])) : 0), 0) + 2;
  const dash = useDraw(len);
  const active = tap != null ? rows[tap] : null;
  return (
    <View onLayout={(e) => setBox(Math.max(200, e.nativeEvent.layout.width))}>
      <PlotHead
        legend={
          <>
            <Swatch kind="solid" label="Received" />
            <Swatch kind="hatch" label="Paid out" />
            <Swatch kind="line" label="Net for the day" />
          </>
        }
        scale={`Dashed lines: ${money(max)} in · ${money(max)} out`}
        reading={
          active
            ? `${fmtDate(active.date)} · ${money(active.received)} in · ${money(active.made)} out · net ${money(n0(active.received) - n0(active.made))}`
            : "Tap a day for its figures"
        }
      />
      <Svg width={W} height={H}>
        <Defs>
          <Pattern id="fin-hatch" width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <Line x1={0} y1={0} x2={0} y2={6} stroke={S.ink} strokeWidth={1} opacity={0.55} />
          </Pattern>
        </Defs>
        <Line x1={pad} x2={W - pad} y1={top} y2={top} stroke={S.rule} strokeDasharray="2 5" />
        <Line x1={pad} x2={W - pad} y1={bottom} y2={bottom} stroke={S.rule} strokeDasharray="2 5" />
        {rows.map((r, i) => {
          const up = (n0(r.received) / max) * half;
          const down = (n0(r.made) / max) * half;
          const d = new Date(r.date);
          const on = tap == null || tap === i;
          return (
            <G key={r.date || i} onPress={() => setTap(tap === i ? null : i)}>
              <Rect x={pad + slot * i} y={0} width={slot} height={H} fill={tap === i ? S.blueWash : "transparent"} />
              <Rect x={cx(i) - w / 2} y={mid - up} width={w} height={up} fill={S.blue} fillOpacity={on ? 0.92 : 0.4} />
              <Rect x={cx(i) - w / 2} y={mid} width={w} height={down} fill="url(#fin-hatch)" stroke={S.ink} strokeWidth={1} opacity={on ? 1 : 0.45} />
              {n0(r.received) > 0 && <BarFigure x={cx(i)} y={mid - up} text={barFigure(r.received)} slot={slot} index={i} color={S.blue} />}
              {n0(r.made) > 0 && <BarFigure x={cx(i)} y={mid + down} text={barFigure(r.made)} slot={slot} index={i} below />}
              <SvgText x={cx(i)} y={H - 16} textAnchor="middle" fontFamily={fonts.heading.semibold} fontSize={9.5} fill={tap === i ? S.ink : S.graphite}>
                {String(d.getDate())}
              </SvgText>
              {(i === 0 || d.getDate() === 1) && (
                <SvgText x={cx(i)} y={H - 4} textAnchor="middle" fontFamily={fonts.heading.semibold} fontSize={8} letterSpacing={1} fill={S.faint}>
                  {d.toLocaleDateString("en-IN", { month: "short" }).toUpperCase()}
                </SvgText>
              )}
            </G>
          );
        })}
        {/* the cash line itself */}
        <Line x1={pad} x2={W - pad} y1={mid} y2={mid} stroke={S.ink} strokeWidth={1.5} />
        {rows.length > 1 && (
          <AnimatedPath d={net} fill="none" stroke={S.ink} strokeWidth={1.6} strokeLinejoin="round" opacity={0.85} strokeDasharray={`${len} ${len}`} strokeDashoffset={dash} />
        )}
        {rows.map((r, i) => (
          <Circle key={i} cx={cx(i)} cy={ny(r)} r={tap === i ? 4 : 2.6} fill={S.paper} stroke={S.ink} strokeWidth={1.4} />
        ))}
      </Svg>
    </View>
  );
}

// ── E: income by month; a fall from the month before is drawn in red ────────
function IncomePlot({ rows }: { rows: MonthlyIncomePoint[] }) {
  const [tap, setTap] = useState<number | null>(null);
  const [box, setBox] = useState(320);
  const H = 214, pad = 4, top = 44, base = 176;
  const n = Math.max(1, rows.length);
  const W = box;
  const slot = (W - pad * 2) / n;
  const max = Math.max(1, ...rows.map((r) => Math.abs(n0(r.income))));
  const cx = (i: number) => pad + slot * i + slot / 2;
  const w = Math.min(28, slot * 0.56);
  const active = tap != null ? rows[tap] : null;
  return (
    <View onLayout={(e) => setBox(Math.max(200, e.nativeEvent.layout.width))}>
      <PlotHead
        legend={
          <>
            <Swatch kind="solid" label="Up on the month before" />
            <Swatch kind="red" label="Down" />
          </>
        }
        scale={`Dashed line: ${money(max)}`}
        reading={active ? `${active.month} ${active.year} · ${money(active.income)}` : "Tap a month for its figure"}
      />
      <Svg width={W} height={H}>
        <Line x1={pad} x2={W - pad} y1={base} y2={base} stroke={S.ink} />
        <Line x1={pad} x2={W - pad} y1={top} y2={top} stroke={S.rule} strokeDasharray="2 5" />
        {rows.map((r, i) => {
          const h = (Math.abs(n0(r.income)) / max) * (base - top);
          const fill = r.trend === "degrowth" ? S.red : S.blue;
          return (
            <G key={r.key || i} onPress={() => setTap(tap === i ? null : i)}>
              <Rect x={pad + slot * i} y={0} width={slot} height={H} fill={tap === i ? S.blueWash : "transparent"} />
              <Rect x={cx(i) - w / 2} y={base - h} width={w} height={h} fill={fill} fillOpacity={(tap == null || tap === i ? 0.92 : 0.4) * (r.trend === "neutral" ? 0.6 : 1)} />
              {Math.abs(n0(r.income)) > 0.005 && <BarFigure x={cx(i)} y={base - h} text={barFigure(r.income)} slot={slot} index={i} color={r.trend === "degrowth" ? S.red : S.ink} />}
              <SvgText x={cx(i)} y={base + 16} textAnchor="middle" fontFamily={fonts.heading.semibold} fontSize={9} letterSpacing={0.6} fill={tap === i ? S.ink : S.graphite}>
                {String(r.month).slice(0, 3).toUpperCase()}
              </SvgText>
              <SvgText x={cx(i)} y={base + 28} textAnchor="middle" fontFamily={fonts.body.regular} fontSize={8} fill={S.faint}>
                {String(r.year).slice(-2)}
              </SvgText>
            </G>
          );
        })}
      </Svg>
    </View>
  );
}

/** A bar's figure, lying flat over (or, with `below`, under) the end of its bar, sized to the bar's slot. When figures
 * are wider than their bars, every other one (odd `index`) stands one line further off, so neighbours alternate
 * between two heights instead of running into each other. */
function BarFigure({ x, y, text, slot, index, color = S.ink, below }: { x: number; y: number; text: string; slot: number; index: number; color?: string; below?: boolean }) {
  const size = Math.min(9, Math.max(7, slot / 3.2));
  const crowded = text.length * size * 0.6 > slot - 3;
  const off = 4 + (crowded && index % 2 ? size + 3 : 0);
  return (
    <SvgText x={x} y={below ? y + size + off - 1 : y - off} textAnchor="middle" fontFamily={fonts.heading.semibold} fontSize={size} fill={color}>
      {text}
    </SvgText>
  );
}

/** A bar's own figure, short enough to sit over a narrow bar: 1.2Cr, 14L, 950K. */
const barFigure = (v: unknown) => {
  const n = Math.abs(n0(v));
  const t = n >= 1e7 ? `${(n / 1e7).toFixed(1)}Cr` : n >= 1e5 ? `${Math.round(n / 1e5)}L` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : `${Math.round(n)}`;
  return `${n0(v) < 0 ? "−" : ""}${t}`;
};

/** One instrument: a bar measured out of its total, in use solid and the rest hatched. */
function Measure({ name, live, total, onOpen, last }: { name: string; live: number; total: number; onOpen: () => void; last?: boolean }) {
  return (
    <Press onPress={onOpen} style={(pressed) => ({ paddingVertical: 11, borderBottomWidth: last ? 0 : 1, borderBottomColor: S.ruleSoft, backgroundColor: pressed ? S.blueWash : "transparent" })}>
      <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <LinkLabel onPress={onOpen}>{name}</LinkLabel>
        <Text>
          <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 22, color: S.ink, letterSpacing: -0.4 }}>{fmtInt(live)}</Text>
          <Text style={{ fontSize: 12, color: S.graphite, fontFamily: fonts.body.regular }}> of {fmtInt(total)}</Text>
        </Text>
      </View>
      <View style={{ height: 9, marginTop: 8, borderWidth: 1, borderColor: S.ink, overflow: "hidden" }}>
        <Hatch id={`m-${name}`} />
        <Grow style={{ height: "100%", width: `${share(live, total)}%`, backgroundColor: S.blue }} />
      </View>
      <Body size={11.5} color={S.graphite} style={{ marginTop: 6 }}>
        {fmtInt(live)} active · {fmtInt(Math.max(0, total - live))} inactive
      </Body>
    </Press>
  );
}

function notOnMobile(title: string) {
  Alert.alert(title, `The ${title} screen isn't built on mobile yet. Use the web app for now.`);
}

export default function FinanceDashboardScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const [refreshing, setRefreshing] = useState(false);
  const goToPayments = (openForm?: boolean) => navigation.navigate("Payment", openForm ? { openForm: true } : undefined);
  const goToReceived = (openForm?: boolean) => navigation.navigate("ReceivedPayment", openForm ? { openForm: true } : undefined);

  const { data: raw, isLoading, isError, refetch, isFetching, dataUpdatedAt } = useQuery<FinanceDashboardData>({
    queryKey: ["finance-dashboard"],
    queryFn: fetchFinanceDashboard,
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
    retry: 2,
  });
  const { data: monthlyIncome, isLoading: incomeLoading, refetch: refetchIncome } = useQuery<MonthlyIncomePoint[]>({
    queryKey: ["finance-monthly-income"],
    queryFn: fetchMonthlyIncome,
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });
  const income = monthlyIncome ?? [];
  const data = raw;

  const received = n0(data?.receivedPayments.totalAmount);
  const paid = n0(data?.paymentsMade.totalAmount);
  const net = received - paid;
  const receivedPct = share(received, received + paid);
  const readAt = dataUpdatedAt ? new Date(dataUpdatedAt) : new Date();
  const todayNet = n0(data?.receivedPayments.todayAmount) - n0(data?.paymentsMade.todayAmount);

  const reread = () => {
    void refetch();
    void refetchIncome();
  };
  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetch(), refetchIncome()]);
    setRefreshing(false);
  };

  const madeCols: Col<RecentPaymentMade>[] = [
    {
      title: "Paid to",
      width: 170,
      render: (p) => (
        <View>
          <Body weight="semibold" size={12.5}>{p.PPaymentName || "—"}</Body>
          {!!(p.PProject || p.PBankName) && <Body size={11} color={S.graphite}>{[p.PProject, p.PBankName].filter(Boolean).join(" · ")}</Body>}
        </View>
      ),
    },
    { title: "Mode", width: 74, render: (p) => <Label>{p.PMode || "—"}</Label> },
    { title: "Date", width: 62, render: (p) => <Body size={12} color={S.ink2}>{fmtDate(p.PDate)}</Body> },
    { title: "Amount", width: 84, num: true, render: (p) => <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 13, color: S.ink }}>{money(p.PAmount)}</Text> },
  ];
  const receivedCols: Col<RecentPaymentReceived>[] = [
    {
      title: "Received from",
      width: 160,
      render: (p) => (
        <View>
          <Body weight="semibold" size={12.5}>{p.RPReceivedFrom || "—"}</Body>
          {!!(p.RPMode || p.RPBankName) && <Body size={11} color={S.graphite}>{[p.RPMode, p.RPBankName].filter(Boolean).join(" · ")}</Body>}
        </View>
      ),
    },
    { title: "Status", width: 78, render: (p) => <Label color={/reject|bounce|cancel/i.test(p.RPStatus || "") ? S.red : S.graphite}>{p.RPStatus || "—"}</Label> },
    { title: "Date", width: 62, render: (p) => <Body size={12} color={S.ink2}>{fmtDate(p.RPDocDate)}</Body> },
    { title: "Amount", width: 84, num: true, render: (p) => <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 13, color: S.ink }}>{money(p.RPAmount)}</Text> },
  ];

  const go = [
    { label: "New payment", onPress: () => goToPayments(true) },
    { label: "New receipt", onPress: () => goToReceived(true) },
    { label: "Cheques", onPress: () => notOnMobile("Cheques") },
    { label: "Cards", onPress: () => notOnMobile("Cards") },
    { label: "Banks", onPress: () => notOnMobile("Banks") },
  ];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingBottom: 96 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={S.ink} />}
    >
      <SheetFrame>
        {/* Title block */}
        <View>
          <View style={{ paddingHorizontal: 16, paddingTop: 20, paddingBottom: 18, gap: 8 }}>
            <Label>CivilierERP · Finance</Label>
            <TitleText size={30}>Finance overview</TitleText>
            <Body size={13} color={S.ink2}>What has been received and paid, how the last fortnight ran, and the cheques, cards and banks behind it.</Body>
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
                <LinkLabel onPress={reread} color={S.blue}>{isFetching ? "Reading…" : "Re-read"}</LinkLabel>
              </View>
            </View>
          </View>
        </View>

        {isError && (
          <View style={{ borderTopWidth: 1, borderTopColor: S.rule, padding: 16 }}>
            <Notice>Could not load the finance figures. Use Re-read to try again.</Notice>
          </View>
        )}

        <Detail tag="A" title="Received against paid" note="All time">
          {isLoading ? (
            <>
              <Skel h={54} w="60%" />
              <Skel h={28} />
              <Skel w="70%" />
            </>
          ) : (
            <>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14, alignItems: "flex-end" }}>
                <Pressable onPress={() => goToReceived()} style={{ gap: 8 }}>
                  <LinkLabel onPress={() => goToReceived()} color={S.graphite}>Received</LinkLabel>
                  <MoneyFigure value={received} />
                </Pressable>
                <Pressable onPress={() => goToPayments()} style={{ gap: 8 }}>
                  <LinkLabel onPress={() => goToPayments()} color={S.graphite}>Paid out</LinkLabel>
                  <MoneyFigure value={paid} color={S.ink2} />
                </Pressable>
                <View style={{ marginLeft: "auto", alignItems: "flex-end", gap: 8 }}>
                  <Label>{net >= 0 ? "Net inflow" : "Net outflow"}</Label>
                  <MoneyFigure value={net} size={26} color={net < 0 ? S.red : S.blue} />
                </View>
              </View>

              <View style={{ marginTop: 22 }}>
                <View style={{ flexDirection: "row", height: 30, borderWidth: 1.5, borderColor: S.ink, backgroundColor: S.paper, overflow: "hidden" }}>
                  <Grow style={{ width: `${receivedPct}%`, backgroundColor: S.blue }} />
                  <View style={{ flex: 1, borderLeftWidth: received + paid > 0 ? 1.5 : 0, borderLeftColor: S.ink, overflow: "hidden" }}>
                    <Hatch id="fin-a" />
                  </View>
                </View>
                <View style={{ flexDirection: "row" }}>
                  <View style={{ width: `${Math.min(Math.max(receivedPct, 24), 76)}%`, minWidth: 0 }}>
                    <Dimension text={`${fmtInt(data?.receivedPayments.totalCount)} receipts`} color={S.blue} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                    <Dimension text={`${fmtInt(data?.paymentsMade.totalCount)} payments`} />
                  </View>
                </View>
              </View>

              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 18, alignItems: "center" }}>
                <Swatch kind="solid" label="Received" />
                <Swatch kind="hatch" label="Paid out" />
              </View>
              <Body size={11.5} color={S.ink2} style={{ marginTop: 8 }}>
                {fmtInt(data?.receivedPayments.approvedCount)} receipts approved · {fmtInt(data?.receivedPayments.draftCount)} in draft
              </Body>
            </>
          )}
        </Detail>

        <Detail tag="B" title="Today">
          {isLoading ? (
            <>
              <Skel h={40} />
              <Skel h={40} />
              <Skel h={40} />
            </>
          ) : (
            [
              {
                label: "Received today",
                value: money(data?.receivedPayments.todayAmount),
                sub: `${fmtInt(data?.receivedPayments.todayCount)} receipt${n0(data?.receivedPayments.todayCount) === 1 ? "" : "s"}`,
                onPress: () => goToReceived(),
                red: false,
              },
              {
                label: "Paid out today",
                value: money(data?.paymentsMade.todayAmount),
                sub: `${fmtInt(data?.paymentsMade.todayCount)} payment${n0(data?.paymentsMade.todayCount) === 1 ? "" : "s"}`,
                onPress: () => goToPayments(),
                red: false,
              },
              {
                label: "Net for today",
                value: money(todayNet),
                sub: todayNet < 0 ? "more went out than came in" : "in hand after today's payments",
                onPress: undefined,
                red: todayNet < 0,
              },
            ].map((s, i) => (
              <Press
                key={s.label}
                onPress={s.onPress}
                disabled={!s.onPress}
                style={(pressed) => ({ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingVertical: 13, borderTopWidth: i ? 1 : 0, borderTopColor: S.ruleSoft, backgroundColor: pressed ? S.blueWash : "transparent" })}
              >
                <View style={{ flexShrink: 1, gap: 4 }}>
                  {s.onPress ? <LinkLabel onPress={s.onPress}>{s.label}</LinkLabel> : <Label color={S.ink}>{s.label}</Label>}
                  <Body size={12} color={S.graphite}>{s.sub}</Body>
                </View>
                <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 26, letterSpacing: -0.5, color: s.red ? S.red : S.ink }}>{s.value}</Text>
              </Press>
            ))
          )}
        </Detail>

        <Detail tag="C" title="Fourteen days about the cash line" note="In above, out below">
          {isLoading ? <Skel h={220} /> : (data?.timeline ?? []).length === 0 ? <Body color={S.graphite}>No payments in the last fourteen days.</Body> : <CashLinePlot rows={data!.timeline} />}
        </Detail>

        <Detail tag="D" title="Instruments" note="In use against held">
          {isLoading ? (
            <>
              <Skel h={44} />
              <Skel h={44} />
              <Skel h={44} />
            </>
          ) : (
            <>
              <Measure name="Bank accounts" live={n0(data?.banks.activeCount)} total={n0(data?.banks.totalCount)} onOpen={() => notOnMobile("Banks")} />
              <Measure name="Cheque lots" live={n0(data?.cheques.activeCount)} total={n0(data?.cheques.totalCount)} onOpen={() => notOnMobile("Cheques")} />
              <Measure name="Cards" live={n0(data?.cards.activeCount)} total={n0(data?.cards.totalCount)} onOpen={() => notOnMobile("Cards")} last />
            </>
          )}
        </Detail>

        <Detail tag="E" title="Income by month" note="From the trial balance">
          {incomeLoading ? <Skel h={190} /> : !income.some((m) => Math.abs(n0(m.income)) > 0.005) ? <Body color={S.graphite}>No income is posted for these months yet.</Body> : <IncomePlot rows={income} />}
        </Detail>

        <Detail tag="F" title="Latest payments made" note={`${fmtInt(data?.paymentsMade.totalCount)} in all`}>
          {isLoading ? (
            <>
              <Skel h={26} />
              <Skel h={26} />
              <Skel h={26} />
            </>
          ) : (data?.recentPaymentsMade ?? []).length === 0 ? (
            <Body color={S.graphite}>No payments recorded yet.</Body>
          ) : (
            <SheetTable rows={data!.recentPaymentsMade.slice(0, 7)} cols={madeCols} keyOf={(p, i) => p.PPaymentID ?? i} onRowPress={() => goToPayments()} />
          )}
          <View style={{ marginTop: 14 }}>
            <LinkLabel onPress={() => goToPayments()}>All payments</LinkLabel>
          </View>
        </Detail>

        <Detail tag="G" title="Latest receipts" note={`${fmtInt(data?.receivedPayments.totalCount)} in all`}>
          {isLoading ? (
            <>
              <Skel h={26} />
              <Skel h={26} />
              <Skel h={26} />
            </>
          ) : (data?.recentPaymentsReceived ?? []).length === 0 ? (
            <Body color={S.graphite}>No receipts recorded yet.</Body>
          ) : (
            <SheetTable rows={data!.recentPaymentsReceived.slice(0, 7)} cols={receivedCols} keyOf={(p, i) => p.RPPaymentID ?? i} onRowPress={() => goToReceived()} />
          )}
          <View style={{ marginTop: 14 }}>
            <LinkLabel onPress={() => goToReceived()}>All receipts</LinkLabel>
          </View>
        </Detail>

        <Detail tag="H" title="Go to">
          {/* Two even columns of link rows, as Material's Go to: nothing to overhang when the last row is short. */}
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {go.map((q) => (
              <Press
                key={q.label}
                onPress={q.onPress}
                style={(pressed) => ({ width: "50%", flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: S.ruleSoft, backgroundColor: pressed ? S.blueWash : "transparent" })}
              >
                <LinkLabel onPress={q.onPress}>{q.label}</LinkLabel>
                <Text style={{ color: S.graphite, fontSize: 13 }}>→</Text>
              </Press>
            ))}
          </View>
        </Detail>
      </SheetFrame>
    </ScrollView>
  );
}
