// RN port of src/pages/Home.tsx (web), on the same drawing sheet and in the same order, for the two modules this app
// covers (Finance and Material): the title block with the greeting and the day, A key numbers (from the module you
// open most), B seven days of work, D waiting on you, E more numbers, G recent activity, H approval inbox or my tasks.
// Left out because they belong to modules outside this app: C work orders (Engineering) and F the project network.
// Figures count up, bars grow, the value line draws itself and the parts rise in one after another, as on the web;
// the web's hover becomes a tap.
import { istHour } from "@/utils/istTime";
import { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, ScrollView, RefreshControl, Alert } from "react-native";
import Svg, { Circle, G, Line, Rect, Text as SvgText } from "react-native-svg";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import type { MainStackParamList } from "@/navigation/MainStack";
import { useAuth } from "@/auth/AuthContext";
import {
  fetchActivityFeed,
  fetchActivityWeek,
  fetchHomeDashboard,
  fetchModuleRanking,
  type ApprovalInboxItem,
  type HomeDashboardData,
  type LiveActivityItem,
} from "@/api/homeDashboardApi";
import { colors, sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { useModuleAccess } from "@/navigation/moduleAccess";
import {
  AnimatedPath,
  Body,
  Detail,
  Grow,
  Label,
  LinkLabel,
  Notice,
  SheetFrame,
  SheetTable,
  Skel,
  Swatch,
  TitleText,
  motionOff,
  useDraw,
  type Col, Press } from "@/components/sheet/Sheet";

// This app is the Finance + Material workspace. Approval-inbox items for any other module are not shown on its home.
const FINANCE_MATERIAL_APPROVAL = /purchase|goods|grn|payment|expense|material|journal|voucher|debit|stock|vehicle|contract|invoice|quotation|issue|transfer|boq/i;

type Mod = "finance" | "material";
const MODULE_LABELS: Record<Mod, string> = { finance: "Finance", material: "Material" };

const compactINR = (n: number) =>
  n >= 1e7 ? `₹${(n / 1e7).toFixed(2)}Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)}L` : n >= 1e3 ? `₹${(n / 1e3).toFixed(1)}K` : `₹${Math.round(n)}`;

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 7 ? `${d}d ago` : new Date(t).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

// ── Tiles (web: pages/home/homeTiles.ts — the Finance and Material ones, same order) ──
type TileValue = { value: number | string | null; prefix?: string; suffix?: string };
const rupees = (n: number): TileValue => {
  if (Math.abs(n) >= 1e7) return { value: (n / 1e7).toFixed(2), prefix: "₹", suffix: "Cr" };
  if (Math.abs(n) >= 1e5) return { value: Math.round(n / 1e5), prefix: "₹", suffix: "L" };
  return { value: Math.round(n), prefix: "₹" };
};
const num = (n: unknown): TileValue => ({ value: Number(n) || 0 });
type TileDef = { id: string; module: Mod; label: string; compute: (fin: any, mat: any) => TileValue };
const TILES: TileDef[] = [
  { id: "fin-transferred", module: "finance", label: "Transferred all-time", compute: (f) => rupees(f?.payments?.totalAmount ?? 0) },
  { id: "fin-month", module: "finance", label: "Payments this month", compute: (f) => rupees(f?.payments?.thisMonthAmount ?? 0) },
  { id: "fin-today", module: "finance", label: "Payments today", compute: (f) => num(f?.payments?.todayCount) },
  { id: "fin-suppliers", module: "finance", label: "Active suppliers", compute: (f) => num(f?.parties?.activeSupplierCount) },
  { id: "fin-cheques", module: "finance", label: "Active cheques", compute: (f) => num(f?.cheques?.activeCount) },
  { id: "mat-po-value", module: "material", label: "Open PO value", compute: (f, m) => rupees(m?.purchaseOrders?.openValue ?? f?.purchaseOrders?.openValue ?? 0) },
  { id: "mat-po-open", module: "material", label: "Open purchase orders", compute: (_f, m) => num(m?.purchaseOrders?.open) },
  { id: "mat-grn-month", module: "material", label: "GRNs this month", compute: (_f, m) => num(m?.grns?.thisMonth) },
  { id: "mat-grn-today", module: "material", label: "GRNs today", compute: (_f, m) => num(m?.grns?.today) },
  { id: "mat-items", module: "material", label: "Catalogue items", compute: (_f, m) => num(m?.items?.count) },
];

/** The hero row: the top module gets two slots, the next one; any slot left goes to the next tile in order. */
function pickHero(ordered: TileDef[], order: Mod[], count = 4): TileDef[] {
  const picked: TileDef[] = [];
  const quotas = [2, 1, 1];
  order.forEach((m, i) => picked.push(...ordered.filter((t) => t.module === m).slice(0, quotas[i] ?? 0)));
  for (const t of ordered) {
    if (picked.length >= count) break;
    if (!picked.includes(t)) picked.push(t);
  }
  return picked.slice(0, count);
}

/** The web's AnimatedCounter: counts 0 → target once, ease-out quart, 1.2s. */
function Counter({ target, prefix = "", suffix = "" }: { target: number; prefix?: string; suffix?: string }) {
  const [v, setV] = useState(() => (motionOff("counts") ? target : 0));
  const from = useRef(0);
  useEffect(() => {
    if (motionOff("counts")) {
      setV(target);
      return;
    }
    const start = Date.now();
    const s0 = from.current;
    let raf = 0;
    const tick = () => {
      const t = Math.min((Date.now() - start) / 1200, 1);
      const x = s0 + (target - s0) * (1 - Math.pow(1 - t, 4));
      from.current = x;
      setV(Math.round(x));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return (
    <>
      {prefix}
      {v.toLocaleString("en-IN")}
      {suffix}
    </>
  );
}

// ── B: seven days — documents on the bars, their value on the line ──
function WeekPlot({ rows }: { rows: Array<{ day: string; count: number; amount: number }> }) {
  const [tap, setTap] = useState<number | null>(null);
  const [W, setW] = useState(320);
  const H = 210, pad = 4, top = 38, base = 172;
  const n = Math.max(1, rows.length);
  const slot = (W - pad * 2) / n;
  const maxCount = Math.max(1, ...rows.map((r) => r.count));
  const maxAmount = Math.max(1, ...rows.map((r) => r.amount));
  const y = (v: number, max: number) => base - (v / max) * (base - top);
  const cx = (i: number) => pad + slot * i + slot / 2;
  const w = Math.min(30, slot * 0.5);
  const line = rows.map((r, i) => `${i ? "L" : "M"}${cx(i).toFixed(1)},${y(r.amount, maxAmount).toFixed(1)}`).join(" ");
  const len = rows.reduce((acc, r, i) => (i ? acc + Math.hypot(slot, y(r.amount, maxAmount) - y(rows[i - 1].amount, maxAmount)) : 0), 0) + 2;
  const dash = useDraw(len);
  const active = tap != null ? rows[tap] : null;
  return (
    <View onLayout={(e) => setW(Math.max(200, e.nativeEvent.layout.width))}>
      <View style={{ gap: 6, marginBottom: 8 }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
          <Swatch kind="solid" label="Documents" />
          <Swatch kind="line" label="Value" />
        </View>
        <Body size={12} color={S.ink2}>
          {active ? `${active.day} · ${active.count.toLocaleString("en-IN")} document${active.count === 1 ? "" : "s"} · ${compactINR(active.amount)}` : "Tap a day for its figures"}
        </Body>
      </View>
      <Svg width={W} height={H}>
        <Line x1={pad} x2={W - pad} y1={base} y2={base} stroke={S.rule} />
        <Line x1={pad} x2={W - pad} y1={top} y2={top} stroke={S.rule} strokeDasharray="2 5" />
        <SvgText x={pad + 2} y={12} fontFamily={fonts.body.regular} fontSize={10} fill={S.graphite}>{`${maxCount.toLocaleString("en-IN")} documents · ${compactINR(maxAmount)}`}</SvgText>
        {rows.map((r, i) => {
          const h = base - y(r.count, maxCount);
          return (
            <G key={i} onPress={() => setTap(tap === i ? null : i)}>
              <Rect x={pad + slot * i} y={0} width={slot} height={H} fill={tap === i ? S.blueWash : "transparent"} />
              <Rect x={cx(i) - w / 2} y={base - h} width={w} height={Math.max(0, h)} fill={S.blue} fillOpacity={tap == null || tap === i ? 0.9 : 0.4} />
              <SvgText x={cx(i)} y={base + 20} textAnchor="middle" fontFamily={fonts.heading.semibold} fontSize={9.5} letterSpacing={1} fill={tap === i ? S.ink : S.graphite}>
                {r.day.toUpperCase()}
              </SvgText>
            </G>
          );
        })}
        {rows.length > 1 && (
          <>
            <AnimatedPath d={line} fill="none" stroke={S.ink} strokeWidth={2} strokeLinejoin="round" strokeDasharray={`${len} ${len}`} strokeDashoffset={dash} />
            {rows.map((r, i) => (
              <Circle key={i} cx={cx(i)} cy={y(r.amount, maxAmount)} r={tap === i ? 4.5 : 3} fill={S.paper} stroke={S.ink} strokeWidth={1.6} />
            ))}
          </>
        )}
        {rows.map((r, i) => {
          if (r.count <= 0) return null;
          const h = base - y(r.count, maxCount);
          const labelY = base - h - 7;
          const dotY = y(r.amount, maxAmount);
          const clash = rows.length > 1 && dotY > labelY - 14 && dotY < labelY + 8;
          const at = { x: clash ? cx(i) + w / 2 + 3 : cx(i), y: clash ? Math.max(labelY + 12, top + 10) : labelY, textAnchor: (clash ? "start" : "middle") as "start" | "middle" };
          // The count sits on a paper halo so the value line never cuts through it (the web's paint-order: stroke).
          return (
            <G key={`c${i}`}>
              <SvgText {...at} fontFamily={fonts.heading.semibold} fontSize={10.5} fill={S.paper} stroke={S.paper} strokeWidth={3} strokeLinejoin="round">{String(r.count)}</SvgText>
              <SvgText {...at} fontFamily={fonts.heading.semibold} fontSize={10.5} fill={S.ink}>{String(r.count)}</SvgText>
            </G>
          );
        })}
      </Svg>
    </View>
  );
}

// Where a feed row's web address lands in this app (only the screens it has).
const ROUTE_OF: Array<[RegExp, keyof MainStackParamList]> = [
  [/^\/received-payments/, "ReceivedPayment"],
  [/^\/payments/, "Payment"],
  [/^\/journal-voucher/, "JournalVoucher"],
  [/^\/(finance\/)?contract/, "Contract"],
  [/^\/material\/grn/, "GRN"],
  [/^\/material\/purchase-order/, "PurchaseOrder"],
  [/^\/material\/material-request/, "MaterialRequest"],
  [/^\/material\/issues/, "MaterialIssues"],
  [/^\/material\/expense-booking|^\/invoice/, "Invoice"],
  [/^\/material\/vehicle/, "VehicleInOut"],
];
const routeOf = (href: string) => ROUTE_OF.find(([re]) => re.test((href || "").split("?")[0]))?.[1];

export default function DashboardScreen() {
  const { currentUser } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const [refreshing, setRefreshing] = useState(false);
  const { role, privileged, access } = useModuleAccess();

  const firstName = currentUser?.name?.split(" ")[0] ?? "there";
  const hour = istHour();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const modules = useMemo(() => (["finance", "material"] as Mod[]).filter((m) => access[m]), [access]);

  // Only the two modules this app is for are fetched.
  const { data, isLoading, isError, refetch, isFetching, dataUpdatedAt } = useQuery<HomeDashboardData>({
    queryKey: ["home-dashboard", role, access.finance, access.material],
    queryFn: () => fetchHomeDashboard(false, { finance: access.finance, material: access.material }),
    staleTime: 2 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    retry: 2,
  });
  const { data: ranking } = useQuery({
    queryKey: ["home-module-ranking", modules.join(",")],
    queryFn: () => fetchModuleRanking(modules),
    enabled: modules.length > 0,
    staleTime: 2 * 60 * 1000,
    retry: 0,
  });
  const { data: feed, refetch: refetchFeed } = useQuery({
    queryKey: ["home-activity-feed", modules.join(",")],
    queryFn: () => fetchActivityFeed(modules),
    enabled: modules.length > 0,
    staleTime: 60 * 1000,
    refetchInterval: 90 * 1000,
    retry: 1,
  });
  const { data: week, refetch: refetchWeek } = useQuery({
    queryKey: ["home-activity-week", modules.join(",")],
    queryFn: () => fetchActivityWeek(modules),
    enabled: modules.length > 0,
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    retry: 1,
  });

  const fin: any = data?.finance;
  const mat: any = data?.material;
  const pendingApprovals = (data?.pendingApprovals ?? []).filter((a: ApprovalInboxItem) => FINANCE_MATERIAL_APPROVAL.test(`${a.Module} ${a.ModuleLabel}`));
  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : null;

  // The modules in the user's own order (most opened first), then the default order.
  const moduleOrder: Mod[] = useMemo(() => {
    const out: Mod[] = [];
    for (const r of ranking?.modules ?? []) if (modules.includes(r.module as Mod) && !out.includes(r.module as Mod)) out.push(r.module as Mod);
    for (const m of modules) if (!out.includes(m)) out.push(m);
    return out;
  }, [ranking, modules]);
  const totalVisits = (ranking?.modules ?? []).reduce((a, m) => a + m.visits, 0);
  const sharePct = (m: Mod) => {
    const v = ranking?.modules.find((x) => x.module === m)?.visits ?? 0;
    if (!totalVisits || !v) return null;
    const p = (v / totalVisits) * 100;
    return p < 1 ? "<1%" : `${Math.round(p)}%`;
  };

  const ordered = TILES.filter((t) => moduleOrder.includes(t.module)).sort((a, b) => moduleOrder.indexOf(a.module) - moduleOrder.indexOf(b.module));
  const kpis = ordered.map((t) => {
    const v = t.compute(fin, mat);
    return { id: t.id, module: t.module, label: t.label, value: isLoading ? null : v.value, prefix: v.prefix, suffix: v.suffix };
  });
  const heroIds = new Set(pickHero(ordered, moduleOrder).map((t) => t.id));
  const heroKpis = kpis.filter((k) => heroIds.has(k.id));
  const restKpis = kpis.filter((k) => !heroIds.has(k.id));
  const kpiText = (k: { value: number | string | null; prefix?: string; suffix?: string }) =>
    k.value == null ? null : `${k.prefix ?? ""}${typeof k.value === "number" ? k.value.toLocaleString("en-IN") : k.value}${k.suffix ?? ""}`;

  type Attention = { severity: "high" | "low"; label: string; count: number; hint: string; go?: () => void };
  // Admins and super admins approve (in the Admin app); every other role waits on the appointed approver.
  const approver = role === "admin" || role === "super_admin";
  const attention: Attention[] = (
    [
      {
        severity: "high",
        label: approver ? "Approvals awaiting you" : "Awaiting approval",
        count: pendingApprovals.length,
        hint: `${new Set(pendingApprovals.map((a) => a.Module)).size} module(s) affected`,
        // Approving is not done in this app: an admin approves in the Admin app; anyone else waits on the approver.
        go: () =>
          approver
            ? Alert.alert("Approvals awaiting you", "Approve these in the CivilierERP Admin app. Approvals aren't done in the Finance & Material app.")
            : Alert.alert("Awaiting approval", "These are waiting for the person appointed to approve them. They'll move on here once that person approves them."),
      },
      access.material && { severity: "low", label: "Purchase orders open", count: mat?.purchaseOrders?.open ?? 0, hint: "Not yet closed / cancelled", go: () => navigation.navigate("PurchaseOrder") },
    ].filter(Boolean) as Attention[]
  ).filter((a) => a.count > 0);
  const attnMax = Math.max(1, ...attention.map((x) => x.count));

  const dayLabel = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" });
  const fallbackDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() + 330 * 60_000);
    d.setUTCDate(d.getUTCDate() - (6 - i));
    return { date: d.toISOString().slice(0, 10), count: 0, amount: 0 };
  });
  const series = (week?.length ? week : fallbackDays).map((d) => ({ day: dayLabel(d.date), count: d.count, amount: d.amount }));
  const feedItems: LiveActivityItem[] = feed ?? [];
  const hasAnyAccess = modules.length > 0;
  const today = new Date();

  const reread = () => {
    void refetch();
    void refetchFeed();
    void refetchWeek();
  };
  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetch(), refetchFeed(), refetchWeek()]);
    setRefreshing(false);
  };

  const approvalCols: Col<ApprovalInboxItem>[] = [
    { title: "Module", width: 120, render: (x) => <Body weight="semibold" size={12.5}>{x.ModuleLabel}</Body> },
    { title: "Reference", width: 130, render: (x) => <Body size={12} color={S.ink2}>{x.Reference}</Body> },
    { title: "Date", width: 62, render: (x) => <Body size={12} color={S.ink2}>{x.RecordDate ? new Date(x.RecordDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—"}</Body> },
    { title: "Status", width: 80, render: (x) => <Label>{x.Status}</Label> },
    { title: "Amount", width: 80, num: true, render: (x) => <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 13, color: S.ink }}>{x.Amount != null ? compactINR(x.Amount) : "—"}</Text> },
  ];
  const taskCols: Col<NonNullable<HomeDashboardData["recentTasks"]>[number]>[] = [
    { title: "Task", width: 190, render: (t) => <Body weight="semibold" size={12.5}>{t.title}</Body> },
    { title: "Priority", width: 80, render: (t) => <Body size={12} color={S.ink2}>{t.priority}</Body> },
    { title: "Status", width: 90, render: (t) => <Label>{t.status}</Label> },
    { title: "Due", width: 66, num: true, render: (t) => <Body size={12} color={S.ink2}>{t.dueDate ? new Date(t.dueDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—"}</Body> },
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
          <View style={{ paddingHorizontal: 16, paddingTop: 24, paddingBottom: 22, gap: 10 }}>
            <Label>CivilierERP · {role.replace(/_/g, " ") || "user"}</Label>
            <TitleText size={36}>
              {greeting}, <Text style={{ color: S.blue }}>{firstName}.</Text>
            </TitleText>
            {moduleOrder.length > 0 && (
              <Text style={{ fontSize: 13, color: S.ink2, fontFamily: fonts.body.regular }}>
                <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 10, letterSpacing: 1.2, color: S.graphite }}>{"YOU WORK MOST IN  "}</Text>
                {moduleOrder.map((m, i) => (
                  <Text key={m}>
                    {i > 0 ? " · " : ""}
                    <Text style={{ fontFamily: fonts.body.bold, color: S.ink }}>{MODULE_LABELS[m]}</Text>
                    {sharePct(m) ? <Text style={{ color: S.graphite }}> {sharePct(m)}</Text> : null}
                  </Text>
                ))}
              </Text>
            )}
          </View>
          <View style={{ borderTopWidth: 1, borderTopColor: S.ink }}>
            <View style={{ paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: S.ink }}>
              <Label style={{ marginBottom: 3 }}>Day</Label>
              <Body size={13}>{today.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</Body>
            </View>
            <View style={{ flexDirection: "row" }}>
              <View style={{ flex: 1, paddingHorizontal: 14, paddingVertical: 10, borderRightWidth: 1, borderRightColor: S.ink }}>
                <Label style={{ marginBottom: 3 }}>Read at</Label>
                <Body size={13}>{lastUpdated ?? "—"}</Body>
              </View>
              <View style={{ flex: 1, paddingHorizontal: 14, paddingVertical: 10, justifyContent: "flex-end" }}>
                <LinkLabel onPress={reread} color={S.blue}>{isFetching ? "Reading…" : "Re-read"}</LinkLabel>
              </View>
            </View>
          </View>
        </View>

        {isError && (
          <View style={{ borderTopWidth: 1, borderTopColor: S.rule, padding: 16 }}>
            <Notice>Could not reach the server. Showing the last figures read.</Notice>
          </View>
        )}

        {!hasAnyAccess ? (
          <View style={{ borderTopWidth: 1, borderTopColor: S.rule, paddingVertical: 40, paddingHorizontal: 16, alignItems: "center", gap: 6 }}>
            <Body weight="semibold" size={15}>No Finance or Material access assigned.</Body>
            <Body size={13} color={S.graphite}>Contact your administrator to get module permissions.</Body>
          </View>
        ) : null}

        {hasAnyAccess && heroKpis.length > 0 && (
          <Detail tag="A" title="Key numbers" note="From the modules you use most">
            <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
              {heroKpis.map((k, i) => (
                <View key={k.id} style={{ width: "50%", paddingVertical: 10, paddingLeft: i % 2 ? 14 : 0, paddingRight: 10, borderLeftWidth: i % 2 ? 1 : 0, borderLeftColor: S.rule, borderTopWidth: i > 1 ? 1 : 0, borderTopColor: S.ruleSoft }}>
                  <Label>{k.label}</Label>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.heading.semibold, fontSize: 26, letterSpacing: -0.5, color: S.ink, marginTop: 10, fontVariant: ["tabular-nums"] }}>
                    {typeof k.value === "number" ? <Counter target={k.value} prefix={k.prefix} suffix={k.suffix} /> : kpiText(k) ?? "…"}
                  </Text>
                  {k.value == null && <Skel h={26} w="60%" />}
                  <Body size={11.5} color={S.graphite} style={{ marginTop: 8 }}>{MODULE_LABELS[k.module]}</Body>
                </View>
              ))}
            </View>
          </Detail>
        )}

        {hasAnyAccess && (
          <Detail tag="B" title="Seven days of work" note="Bars documents, line value">
            <WeekPlot rows={series} />
          </Detail>
        )}

        {hasAnyAccess && (
          <Detail tag="D" title="Waiting on you" note={attention.length ? `${attention.length} open` : "All clear"}>
            {isLoading ? (
              <>
                <Skel h={30} />
                <Skel h={30} />
              </>
            ) : attention.length === 0 ? (
              <Body size={14} color={S.ink2}>Nothing needs your action right now.</Body>
            ) : (
              attention.map((x, i) => {
                const hot = x.severity === "high";
                return (
                  <Press
                    key={x.label}
                    onPress={x.go}
                    style={(pressed) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 9, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: S.ruleSoft, backgroundColor: pressed ? (hot ? S.redWash : S.blueWash) : "transparent" })}
                  >
                    <Text style={{ width: 18, fontSize: 10, color: hot ? S.red : S.graphite, fontFamily: fonts.body.regular }}>{String(i + 1).padStart(2, "0")}</Text>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={{ fontSize: 13.5, fontFamily: fonts.body.semibold, color: hot ? S.red : S.ink }}>{x.label}</Text>
                      <View style={{ height: 3, marginTop: 6, backgroundColor: S.ruleSoft }}>
                        <Grow style={{ height: 3, width: `${(x.count / attnMax) * 100}%`, backgroundColor: hot ? S.red : S.blue }} />
                      </View>
                      <Text numberOfLines={1} style={{ fontSize: 11.5, color: S.graphite, marginTop: 5, fontFamily: fonts.body.regular }}>{x.hint}</Text>
                    </View>
                    <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 22, color: hot ? S.red : S.ink, minWidth: 44, textAlign: "right" }}>{x.count.toLocaleString("en-IN")}</Text>
                  </Press>
                );
              })
            )}
          </Detail>
        )}

        {hasAnyAccess && (
          <Detail tag="E" title="More numbers">
            {restKpis.length === 0 ? (
              <Body color={S.graphite}>Nothing else to show.</Body>
            ) : (
              restKpis.map((k) => (
                <View key={k.id} style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: S.ruleSoft }}>
                  <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 12, color: S.ink2, fontFamily: fonts.body.regular }}>{k.label}</Text>
                  <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 15, color: S.ink }}>{kpiText(k) ?? "…"}</Text>
                </View>
              ))
            )}
          </Detail>
        )}

        {hasAnyAccess && (
          <Detail tag="G" title="Recent activity" note="Latest in your modules">
            {feedItems.length === 0 ? (
              <Body color={S.graphite}>{isLoading ? "Reading…" : "No recent activity."}</Body>
            ) : (
              // Phone width: one ruled row per document rather than the web's five-column table.
              feedItems.slice(0, 8).map((it, i, arr) => {
                const r = routeOf(it.Href);
                return (
                  <Press
                    key={`${it.Kind}-${it.DocNo ?? i}-${it.At}`}
                    disabled={!r}
                    onPress={() => r && navigation.navigate(r as never)}
                    style={(pressed) => ({ paddingVertical: 11, borderBottomWidth: i === arr.length - 1 ? 0 : 1, borderBottomColor: S.ruleSoft, backgroundColor: pressed ? S.blueWash : "transparent" })}
                  >
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                      <Label color={S.ink2}>{it.Module === "finance" ? "Finance" : it.Module === "material" ? "Material" : it.Module}</Label>
                      <Body size={11.5} color={S.graphite}>{relTime(it.At)}</Body>
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 12, marginTop: 4 }}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} style={{ fontFamily: fonts.body.semibold, fontSize: 13, color: S.ink }}>{it.Title}</Text>
                        {!!it.Subtitle && <Text numberOfLines={1} style={{ fontFamily: fonts.body.regular, fontSize: 11.5, color: S.graphite, marginTop: 1 }}>{it.Subtitle}</Text>}
                        {!!it.Actor && <Text numberOfLines={1} style={{ fontFamily: fonts.body.regular, fontSize: 11.5, color: S.ink2, marginTop: 3 }}>By {it.Actor}</Text>}
                      </View>
                      <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 15, color: S.ink }}>{it.Amount != null && it.Amount > 0 ? compactINR(it.Amount) : "—"}</Text>
                    </View>
                  </Press>
                );
              })
            )}
          </Detail>
        )}

        {hasAnyAccess && privileged ? (
          <Detail tag="H" title="Approval inbox" note={pendingApprovals.length ? `${pendingApprovals.length} waiting` : undefined}>
            {pendingApprovals.length === 0 ? (
              <Body color={S.graphite}>{isLoading ? "Reading…" : "Nothing waiting on approval."}</Body>
            ) : (
              <SheetTable rows={pendingApprovals.slice(0, 8)} cols={approvalCols} keyOf={(x, i) => `${x.Module}-${x.RecordId}-${i}`} />
            )}
          </Detail>
        ) : hasAnyAccess && data?.recentTasks && data.recentTasks.length > 0 ? (
          <Detail tag="H" title="My tasks">
            <SheetTable rows={data.recentTasks.slice(0, 8)} cols={taskCols} keyOf={(t) => t.id} />
          </Detail>
        ) : null}

        <View style={{ borderTopWidth: 1, borderTopColor: S.rule, flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: 8, paddingHorizontal: 16, paddingVertical: 12 }}>
          <Label>Civilier ERP · {today.getFullYear()}</Label>
          <Label>Crafted by Rajwada Infotech</Label>
        </View>
      </SheetFrame>
    </ScrollView>
  );
}
