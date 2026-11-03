// Fixed Asset overview — the web dashboard's figures, read from GET /api/fixed-assets/dashboard so the two always agree:
// right-now figures, what needs attention, value by category / project, assets by status, twelve months of depreciation,
// quality checks, latest activity, and quick links into every module.
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Boxes, ChevronRight, Tag, UserCheck, ArrowLeftRight, ShieldCheck, Wrench, TrendingDown } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import { SectionLabel } from "@/components/home/SectionLabel";
import { StatusPill } from "@/components/StatusPill";
import { navigate } from "@/navigation/navigationRef";
import { useAuth } from "@/auth/AuthContext";
import { PRIVILEGED_ROLES } from "@/auth/permissions";
import { useRefetchOnFocus } from "@/hooks/useRefetchOnFocus";
import { getFixedAssetDashboard, type DashboardBreakdown, type FixedAssetDashboardData } from "@/api/fixedAssetApi";
import type { MainStackParamList } from "@/navigation/MainStack";

const ACCENT = "#eab308";
const BLUE = "#3b82f6";
const RED = "#ef4444";

type Route = keyof MainStackParamList;

// The web dashboard's links, mapped to the screens the app has. A page with no screen here (Inventory Import, Depreciation
// Setup) is left out of the links.
const ROUTE_OF_PATH: Record<string, Route> = {
  "/fixed-asset/record": "AssetRegister",
  "/fixed-asset/tagging": "Tagging",
  "/fixed-asset/assignment": "Assignment",
  "/fixed-asset/transfer": "AssetTransfer",
  "/fixed-asset/quality-check": "QualityCheck",
  "/fixed-asset/maintenance": "Maintenance",
  "/fixed-asset/depreciation-generate": "DepreciationRun",
};
const go = (path: string) => { const r = ROUTE_OF_PATH[path]; if (r) navigate(r as never); };

const n = (v: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(v ?? 0);
const share = (part: number, whole: number) => (whole > 0 ? Math.min(100, Math.max(0, (part / whole) * 100)) : 0);
const short = (v: number) => (v >= 1e7 ? `${(v / 1e7).toFixed(1)}Cr` : v >= 1e5 ? `${(v / 1e5).toFixed(1)}L` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : String(Math.round(v)));
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—");
const monthLong = (iso: string | null) => (iso ? new Date(iso.length === 7 ? `${iso}-01T00:00:00` : iso).toLocaleDateString("en-IN", { month: "long", year: "numeric" }) : "—");
const when = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

const card = { backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14 } as const;
const muted = { color: colors.mutedForeground, fontFamily: fonts.body.regular } as const;

function Figure({ label, value, sub, warn, path }: { label: string; value: string; sub: string; warn?: boolean; path: string }) {
  return (
    <Pressable onPress={() => go(path)} style={{ ...card, flex: 1, minWidth: "45%", padding: 13 }}>
      <Text style={{ ...muted, fontSize: 11, fontFamily: fonts.body.medium }}>{label}</Text>
      <Text numberOfLines={1} style={{ color: warn ? RED : colors.foreground, fontSize: 19, fontFamily: fonts.heading.bold, marginTop: 4 }}>{value}</Text>
      <Text style={{ ...muted, color: "#5c6270", fontSize: 10, marginTop: 3 }}>{sub}</Text>
    </Pressable>
  );
}

function CostBars({ rows, empty }: { rows: DashboardBreakdown[]; empty: string }) {
  if (!rows.length) return <Text style={{ ...muted, fontSize: 12 }}>{empty}</Text>;
  const max = Math.max(1, ...rows.map((r) => r.cost));
  return (
    <View style={{ gap: 12 }}>
      {rows.map((r) => (
        <View key={r.name}>
          <View className="flex-row items-center justify-between" style={{ marginBottom: 4, gap: 8 }}>
            <Text numberOfLines={1} style={{ flex: 1, color: colors.foreground, fontSize: 11.5, fontFamily: fonts.body.medium }}>
              {r.name} <Text style={{ ...muted, fontSize: 10.5 }}>· {n(r.count)} {r.count === 1 ? "asset" : "assets"}</Text>
            </Text>
            <Text style={{ ...muted, fontSize: 11 }}>{formatINR(r.bookValue)} of {formatINR(r.cost)}</Text>
          </View>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.muted, overflow: "hidden", width: `${Math.max(2, share(r.cost, max))}%` }}>
            <View style={{ height: "100%", backgroundColor: BLUE, width: `${share(r.bookValue, r.cost)}%` }} />
          </View>
        </View>
      ))}
      <Text style={{ ...muted, fontSize: 10.5 }}>Blue is book value; the rest of each bar is depreciated.</Text>
    </View>
  );
}

function StatusRows({ rows, total, unit, money }: { rows: { status: string; count: number; cost?: number }[]; total: number; unit: string; money?: boolean }) {
  if (!rows.length) return <Text style={{ ...muted, fontSize: 12 }}>No {unit} yet.</Text>;
  return (
    <View style={{ gap: 9 }}>
      {rows.map((r) => (
        <View key={r.status} className="flex-row items-center" style={{ gap: 10 }}>
          <StatusPill label={r.status || "Not set"} />
          <Text style={{ ...muted, fontSize: 11, flex: 1 }}>{Math.round(share(r.count, total))}%</Text>
          <Text style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.heading.semibold }}>{money ? `${n(r.count)} · ${formatINR(r.cost ?? 0)}` : n(r.count)}</Text>
        </View>
      ))}
      <Text style={{ ...muted, fontSize: 10.5 }}>{n(total)} {unit} in all</Text>
    </View>
  );
}

function YearBars({ months }: { months: { month: string; amount: number }[] }) {
  const max = Math.max(1, ...months.map((m) => m.amount));
  const total = months.reduce((s, m) => s + m.amount, 0);
  return (
    <View>
      <Text style={{ ...muted, fontSize: 11, marginBottom: 10 }}>{formatINR(total)} over the twelve months · peak {short(max)}</Text>
      <View className="flex-row items-end" style={{ height: 110, gap: 4 }}>
        {months.map((m) => (
          <View key={m.month} style={{ flex: 1, alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
            {m.amount > 0
              ? <View style={{ width: "100%", maxWidth: 18, height: `${Math.max(3, (m.amount / max) * 100)}%`, backgroundColor: BLUE, borderRadius: 2 }} />
              : <Text style={{ ...muted, color: "#5c6270", fontSize: 10 }}>—</Text>}
          </View>
        ))}
      </View>
      <View className="flex-row" style={{ gap: 4, marginTop: 5 }}>
        {months.map((m) => (
          <Text key={m.month} style={{ ...muted, flex: 1, textAlign: "center", fontSize: 8.5 }}>
            {new Date(`${m.month}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short" }).slice(0, 3)}
          </Text>
        ))}
      </View>
    </View>
  );
}

const LINKS: { label: string; desc: string; route: Route; icon: React.ComponentType<{ size?: number; color?: string }>; pageKey: string }[] = [
  { label: "Asset Register", desc: "Fixed Asset records & depreciation", route: "AssetRegister", icon: Boxes, pageKey: "fixed-asset-record" },
  { label: "FA Inventory", desc: "Tag received stock", route: "Tagging", icon: Tag, pageKey: "fixed-asset-tagging" },
  { label: "Assignment", desc: "Who holds each asset", route: "Assignment", icon: UserCheck, pageKey: "fixed-asset-assignment" },
  { label: "User-Wise Asset Transfer", desc: "Move custody between users", route: "AssetTransfer", icon: ArrowLeftRight, pageKey: "asset-transfer" },
  { label: "Owner & Quality Checking", desc: "Condition checks & follow-ups", route: "QualityCheck", icon: ShieldCheck, pageKey: "fixed-asset-quality-check" },
  { label: "Maintenance & Repair", desc: "Repair vouchers & spend", route: "Maintenance", icon: Wrench, pageKey: "fixed-asset-maintenance" },
  { label: "Depreciation Generate", desc: "Post a month's depreciation", route: "DepreciationRun", icon: TrendingDown, pageKey: "fixed-asset-depreciation-generate" },
];

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: 22 }}>
      <SectionLabel>{title}</SectionLabel>
      <View style={card}>{children}</View>
    </View>
  );
}

function attentionOf(d: FixedAssetDashboardData): { path: string; text: string }[] {
  const prev = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const one = (c: number, a: string, b: string) => (c === 1 ? a : b);
  return [
    d.depreciation.dueLastMonth > 0 && { path: "/fixed-asset/depreciation-generate", text: `${prev}'s depreciation is not posted for ${n(d.depreciation.dueLastMonth)} active ${one(d.depreciation.dueLastMonth, "asset", "assets")}.` },
    d.inventory.untaggedBatches > 0 && { path: "/fixed-asset/tagging", text: `${n(d.inventory.untaggedQty)} received items in ${n(d.inventory.untaggedBatches)} ${one(d.inventory.untaggedBatches, "batch have", "batches have")} no asset code yet.` },
    d.inventory.noTemplate > 0 && { path: "/fixed-asset/tagging", text: `${n(d.inventory.noTemplate)} untagged ${one(d.inventory.noTemplate, "batch has", "batches have")} no code template, so codes cannot be made for ${one(d.inventory.noTemplate, "it", "them")}.` },
    d.assignment.unassigned > 0 && { path: "/fixed-asset/assignment", text: `${n(d.assignment.unassigned)} ${one(d.assignment.unassigned, "asset has", "assets have")} no user.` },
    d.qualityCheck.overdue > 0 && { path: "/fixed-asset/quality-check", text: `${n(d.qualityCheck.overdue)} quality check follow-${one(d.qualityCheck.overdue, "up is", "ups are")} past due.` },
    d.maintenance.notPosted > 0 && { path: "/fixed-asset/maintenance", text: `${n(d.maintenance.notPosted)} maintenance ${one(d.maintenance.notPosted, "entry is", "entries are")} still in draft (${formatINR(d.maintenance.notPostedAmount)}).` },
  ].filter(Boolean) as { path: string; text: string }[];
}

export default function DashboardScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const { canAccessPage, currentUser } = useAuth();
  const privileged = PRIVILEGED_ROLES.includes((currentUser?.role ?? "user") as never);

  const q = useQuery({ queryKey: ["fa-dashboard"], queryFn: getFixedAssetDashboard });
  useRefetchOnFocus(useCallback(() => { q.refetch(); }, [q.refetch]));
  const d = q.data;

  const onRefresh = async () => { setRefreshing(true); await q.refetch(); setRefreshing(false); };
  const links = LINKS.filter((l) => privileged || canAccessPage(l.pageKey));
  const attention = d ? attentionOf(d) : [];
  const qcTotal = d ? d.qualityCheck.byStatus.reduce((s, r) => s + r.count, 0) : 0;
  const hasYear = !!d && d.depreciation.months.some((m) => m.amount > 0);

  return (
    <ScrollView
      className="flex-1"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 96 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} />}
    >
      <SectionLabel>Fixed Asset Overview</SectionLabel>

      {q.isLoading ? (
        <View style={{ paddingVertical: 60, alignItems: "center" }}><ActivityIndicator color={colors.mutedForeground} /></View>
      ) : q.error || !d ? (
        <Text style={{ color: colors.destructive, fontSize: 12, fontFamily: fonts.body.regular }}>
          {(q.error as Error)?.message || "Could not load the fixed asset figures."} Pull down to try again.
        </Text>
      ) : (
        <>
          <Text style={{ ...muted, fontSize: 11, marginBottom: 10 }}>"This year" is the financial year, since {day(d.fyStart)}.</Text>
          <View className="flex-row flex-wrap" style={{ gap: 10 }}>
            <Figure path="/fixed-asset/record" label="Assets in the register" value={n(d.register.assets)} sub={`${n(d.register.addedThisYear)} added this year · ${formatINR(d.register.addedThisYearCost)}`} />
            <Figure path="/fixed-asset/record" label="Book value" value={formatINR(d.register.bookValue)} sub={`of ${formatINR(d.register.cost)} cost, after ${formatINR(d.register.depreciated)} depreciation`} />
            <Figure path="/fixed-asset/depreciation-generate" label="Depreciation this year" value={formatINR(d.depreciation.thisYear)} sub={d.depreciation.lastPeriod ? `last posted for ${monthLong(d.depreciation.lastPeriod)}` : "none posted yet"} />
            <Figure path="/fixed-asset/tagging" label="Waiting for codes" value={n(d.inventory.untaggedQty)} warn={d.inventory.untaggedQty > 0} sub={`in ${n(d.inventory.untaggedBatches)} untagged ${d.inventory.untaggedBatches === 1 ? "batch" : "batches"}`} />
            <Figure path="/fixed-asset/assignment" label="Without a user" value={n(d.assignment.unassigned)} warn={d.assignment.unassigned > 0} sub={`${n(d.assignment.assigned)} assigned`} />
            <Figure path="/fixed-asset/quality-check" label="Follow-ups overdue" value={n(d.qualityCheck.overdue)} warn={d.qualityCheck.overdue > 0} sub={`${n(d.qualityCheck.dueThisWeek)} due this week · ${n(d.qualityCheck.followUpsOpen)} open`} />
            <Figure path="/fixed-asset/maintenance" label="Maintenance this year" value={formatINR(d.maintenance.spentThisYear)} sub={`${n(d.maintenance.thisYear)} jobs · ${n(d.maintenance.notPosted)} not posted`} />
            <Figure path="/fixed-asset/inventory-import" label="Imported" value={n(d.imports.qty)} sub={`${n(d.imports.count)} imports · ${formatINR(d.imports.value)}${d.imports.lastDate ? ` · last ${day(d.imports.lastDate)}` : ""}`} />
          </View>

          <Block title="Needs Attention">
            {attention.length === 0 ? (
              <Text style={{ ...muted, fontSize: 12 }}>Nothing is waiting: every batch has codes, every asset a user, depreciation is posted and no follow-up is overdue.</Text>
            ) : attention.map((a, i) => (
              <Pressable key={a.text} onPress={() => go(a.path)} className="flex-row items-center" style={{ gap: 10, paddingVertical: 9, borderTopWidth: i ? 1 : 0, borderTopColor: `${colors.border}80` }}>
                <View style={{ width: 7, height: 7, backgroundColor: RED }} />
                <Text style={{ flex: 1, color: colors.foreground, fontSize: 12, fontFamily: fonts.body.regular }}>{a.text}</Text>
                <ChevronRight size={14} color="#5c6270" />
              </Pressable>
            ))}
          </Block>

          <Block title="Value by Category"><CostBars rows={d.byCategory} empty="No assets in the register yet." /></Block>
          <Block title="Assets by Status"><StatusRows rows={d.byStatus} total={d.register.assets} unit="assets" money /></Block>
          <Block title="Twelve Months of Depreciation">
            {hasYear ? <YearBars months={d.depreciation.months} /> : <Text style={{ ...muted, fontSize: 12 }}>No depreciation has been posted in the last twelve months.</Text>}
          </Block>
          <Block title="Value by Project"><CostBars rows={d.byProject} empty="No assets are on a project yet." /></Block>
          <Block title="Quality Checks">
            <StatusRows rows={d.qualityCheck.byStatus} total={qcTotal} unit="checks" />
            <Text style={{ ...muted, fontSize: 10.5, marginTop: 8 }}>
              {n(d.transfers.thisYear)} {d.transfers.thisYear === 1 ? "transfer" : "transfers"} this year{d.transfers.lastDate ? `, the last on ${day(d.transfers.lastDate)}` : ""} · {n(d.inventory.codesTaggedThisYear)} codes made this year
            </Text>
          </Block>

          <Block title="Latest Activity">
            {d.recent.length === 0 ? <Text style={{ ...muted, fontSize: 12 }}>Nothing has been recorded yet.</Text> : d.recent.map((r, i) => (
              <Pressable key={i} onPress={() => go(r.path)} style={{ paddingVertical: 9, borderTopWidth: i ? 1 : 0, borderTopColor: `${colors.border}80` }}>
                <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
                  <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.heading.semibold }}>{r.kind}{r.ref ? ` · ${r.ref}` : ""}</Text>
                  <Text style={{ ...muted, fontSize: 10.5 }}>{when(r.at)}</Text>
                </View>
                {!!r.detail && <Text numberOfLines={2} style={{ ...muted, fontSize: 11, marginTop: 2 }}>{r.detail}</Text>}
                {!!r.who && <Text style={{ ...muted, color: "#5c6270", fontSize: 10, marginTop: 1 }}>by {r.who}</Text>}
              </Pressable>
            ))}
          </Block>
        </>
      )}

      <View style={{ marginTop: 22 }}>
        <SectionLabel>Modules</SectionLabel>
        {links.map((l) => (
          <Pressable
            key={l.route}
            onPress={() => navigate(l.route as never)}
            className="flex-row items-center gap-3"
            style={{ backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 13, marginBottom: 8 }}
          >
            <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: `${ACCENT}1f`, alignItems: "center", justifyContent: "center" }}>
              <l.icon size={15} color={ACCENT} />
            </View>
            <View className="flex-1 min-w-0">
              <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.semibold }}>{l.label}</Text>
              <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular, marginTop: 1 }}>{l.desc}</Text>
            </View>
            <ChevronRight size={16} color="#5c6270" />
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}
