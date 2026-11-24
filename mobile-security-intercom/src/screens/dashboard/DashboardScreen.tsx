// The home page, on the same drawing sheet as the other Civilier apps. One page, three interfaces — the role decides
// which (navigation/securityRole.ts):
//   Guard:          title block with today's gate and shift · A today at the gate · B waiting on residents · C visitors so far
//   Security admin: A key numbers · B alerts · C guards on duty · D seven days of visitors · E visitor log
//   Resident:       flat switcher (several flats) · A waiting for you · B this week · C visitor history
// Everything is read from GET /api/security/dashboard (api/securityDashboardApi.ts).
import { useState } from "react";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { UserPlus, CloudOff } from "lucide-react-native";
import type { MainStackParamList } from "@/navigation/MainStack";
import { useVisitorQueue, refusedWhileQueued } from "@/visitors/offlineQueue";
import { useVisitorEvents } from "@/visitors/useSecuritySocket";
import { TrackingCard } from "@/tracking/TrackingCard";
import { fetchWithAuth } from "@/services/fetchWithAuth";
import { View, Text, ScrollView, RefreshControl, Alert } from "react-native";
import Svg, { G, Line, Rect, Text as SvgText } from "react-native-svg";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthContext";
import { istHour } from "@/utils/istTime";
import { colors, sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { useSecurityView, VIEW_LABEL, type SecurityView } from "@/navigation/securityRole";
import {
  fetchSecurityDashboard,
  type DayCount,
  type GuardOnDutyRow,
  type SecurityAlertRow,
  type SecurityDashboard,
  type VisitorRow,
  type VisitorStatus,
} from "@/api/securityDashboardApi";
import { Body, Detail, Figure, Key, Label, LinkLabel, Notice, Press, Seg, SheetFrame, SheetMark, Skel, StatGrid, Swatch, TitleText, Tick, type MarkTone } from "@/components/sheet/Sheet";

const STATUS: Record<VisitorStatus, { text: string; tone: MarkTone }> = {
  PENDING: { text: "Waiting", tone: "waiting" },
  APPROVED: { text: "Approved", tone: "done" },
  DENIED: { text: "Denied", tone: "stopped" },
  NO_RESPONSE: { text: "No response", tone: "draft" },
};

const ALERT_LABEL: Record<SecurityAlertRow["type"], string> = {
  LEFT_ZONE: "Left the zone",
  DEVICE_OFFLINE: "Device offline",
  UNANSWERED: "Request unanswered",
};

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(t).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—");
const flatOf = (r: { block: string | null; flat: string }) => (r.block ? `${r.block}-${r.flat}` : r.flat);

/** One visitor request as a ruled row: who and why on the left, the state and when on the right. */
function VisitorLine({ v, last, showFlat = true, showGuard = false, onOpen }: { v: VisitorRow; last: boolean; showFlat?: boolean; showGuard?: boolean; onOpen?: (v: VisitorRow) => void }) {
  const st = STATUS[v.status] ?? STATUS.PENDING;
  const sub = [showFlat ? `Flat ${flatOf(v)}` : null, v.gateName, v.vehicleNo, showGuard && v.guardName ? `by ${v.guardName}` : null].filter(Boolean).join(" · ");
  return (
    <Press
      disabled={!onOpen}
      onPress={() => onOpen?.(v)}
      style={(p) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: last ? 0 : 1, borderBottomColor: S.ruleSoft, backgroundColor: p ? S.blueWash : "transparent" })}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontFamily: fonts.body.semibold, fontSize: 13, color: S.ink }}>
          {v.visitorName || "Visitor"} <Text style={{ fontFamily: fonts.body.regular, color: S.ink2 }}>· {v.reason}</Text>
        </Text>
        {!!sub && <Text numberOfLines={1} style={{ fontFamily: fonts.body.regular, fontSize: 11.5, color: S.graphite, marginTop: 2 }}>{sub}</Text>}
      </View>
      <View style={{ alignItems: "flex-end", gap: 3 }}>
        <SheetMark text={st.text} tone={st.tone} />
        <Body size={11} color={S.graphite}>{relTime(v.decidedAt ?? v.requestedAt)}</Body>
      </View>
    </Press>
  );
}

function VisitorList({ rows, empty, loading, showFlat, showGuard, max = 8, onOpen }: { rows: VisitorRow[]; empty: string; loading: boolean; showFlat?: boolean; showGuard?: boolean; max?: number; onOpen?: (v: VisitorRow) => void }) {
  if (loading) return <><Skel h={34} /><Skel h={34} /></>;
  if (!rows.length) return <Body size={13.5} color={S.ink2}>{empty}</Body>;
  const shown = rows.slice(0, max);
  return <>{shown.map((v, i) => <VisitorLine key={v.id} v={v} last={i === shown.length - 1} showFlat={showFlat} showGuard={showGuard} onOpen={onOpen} />)}</>;
}

/** Seven days of requests: approved solid, denied red, no response hatched-light, stacked. */
function WeekBars({ rows }: { rows: DayCount[] }) {
  const [W, setW] = useState(320);
  const H = 170, base = 140, top = 22, pad = 4;
  const n = Math.max(1, rows.length);
  const slot = (W - pad * 2) / n;
  const w = Math.min(28, slot * 0.5);
  const max = Math.max(1, ...rows.map((r) => r.approved + r.denied + r.noResponse));
  const h = (v: number) => (v / max) * (base - top);
  const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" }).toUpperCase();
  return (
    <View onLayout={(e) => setW(Math.max(200, e.nativeEvent.layout.width))}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14, marginBottom: 8 }}>
        <Swatch kind="solid" label="Approved" />
        <Swatch kind="red" label="Denied" />
        <Swatch kind="hatch" label="No response" />
      </View>
      <Svg width={W} height={H}>
        <Line x1={pad} x2={W - pad} y1={base} y2={base} stroke={S.rule} />
        <SvgText x={pad + 2} y={12} fontFamily={fonts.body.regular} fontSize={10} fill={S.graphite}>{`${max} requests`}</SvgText>
        {rows.map((r, i) => {
          const x = pad + slot * i + slot / 2 - w / 2;
          const a = h(r.approved), d = h(r.denied), nr = h(r.noResponse);
          const total = r.approved + r.denied + r.noResponse;
          return (
            <G key={r.date}>
              <Rect x={x} y={base - a} width={w} height={a} fill={S.blue} fillOpacity={0.9} />
              <Rect x={x} y={base - a - d} width={w} height={d} fill={S.red} fillOpacity={0.85} />
              <Rect x={x} y={base - a - d - nr} width={w} height={nr} fill={S.hatch} />
              {total > 0 && (
                <SvgText x={x + w / 2} y={base - a - d - nr - 5} textAnchor="middle" fontFamily={fonts.heading.semibold} fontSize={10} fill={S.ink}>{String(total)}</SvgText>
              )}
              <SvgText x={x + w / 2} y={base + 18} textAnchor="middle" fontFamily={fonts.heading.semibold} fontSize={9.5} letterSpacing={1} fill={S.graphite}>{day(r.date)}</SvgText>
            </G>
          );
        })}
      </Svg>
    </View>
  );
}

function AlertLine({ a, last, onAck }: { a: SecurityAlertRow; last: boolean; onAck?: (a: SecurityAlertRow) => void }) {
  const open = !a.acknowledgedBy;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: last ? 0 : 1, borderBottomColor: S.ruleSoft }}>
      <View style={{ width: 8, height: 8, backgroundColor: open ? S.red : S.graphite }} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontFamily: fonts.body.semibold, fontSize: 13, color: open ? S.red : S.ink }}>{ALERT_LABEL[a.type] ?? a.type}</Text>
        <Text numberOfLines={1} style={{ fontFamily: fonts.body.regular, fontSize: 11.5, color: S.graphite, marginTop: 2 }}>
          {[a.guardName, a.zoneName, open ? "Not acknowledged" : `Acknowledged by ${a.acknowledgedBy}`].filter(Boolean).join(" · ")}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end", gap: 4 }}>
        <Body size={11} color={S.graphite}>{relTime(a.at)}</Body>
        {open && onAck && <LinkLabel onPress={() => onAck(a)} color={S.blue}>Acknowledge</LinkLabel>}
      </View>
    </View>
  );
}

function GuardLine({ g, last }: { g: GuardOnDutyRow; last: boolean }) {
  const out = g.inZone === false;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: last ? 0 : 1, borderBottomColor: S.ruleSoft }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontFamily: fonts.body.semibold, fontSize: 13, color: S.ink }}>{g.name}</Text>
        <Text numberOfLines={1} style={{ fontFamily: fonts.body.regular, fontSize: 11.5, color: S.graphite, marginTop: 2 }}>{g.gateName ?? "No gate assigned"}</Text>
      </View>
      <View style={{ alignItems: "flex-end", gap: 3 }}>
        <SheetMark text={g.inZone == null ? "No fix" : out ? "Out of zone" : "In zone"} tone={g.inZone == null ? "draft" : out ? "stopped" : "done"} />
        <Body size={11} color={S.graphite}>Seen {relTime(g.lastPingAt)}</Body>
      </View>
    </View>
  );
}

export default function DashboardScreen() {
  const { currentUser } = useAuth();
  const { role, view } = useSecurityView();
  const [residentId, setResidentId] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const queued = useVisitorQueue(view === "guard");
  const openVisitor = (v: VisitorRow) => (view === "customer" ? navigation.navigate("VisitorDecision", { id: v.id }) : navigation.navigate("VisitorStatus", { id: v.id }));

  const { data, isLoading, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery<SecurityDashboard | null>({
    queryKey: ["security-dashboard", view, residentId],
    queryFn: () => fetchSecurityDashboard(view as SecurityView, residentId),
    enabled: !!view,
    staleTime: 15 * 1000,
    // While a visitor is waiting, re-read often in case the socket is down; otherwise once a minute.
    refetchInterval: (q) => ((q.state.data?.pending?.length ?? 0) > 0 ? 8000 : 60 * 1000),
    retry: 1,
  });

  const acknowledge = async (al: SecurityAlertRow) => {
    try {
      const res = await fetchWithAuth(`/api/security/alerts/${al.id}/acknowledge`, { method: "POST" });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || "Could not acknowledge.");
      }
      void refetch();
    } catch (e) {
      Alert.alert("Alert", (e as Error).message);
    }
  };

  // A new request, a decision, an escalation or a timeout re-reads the figures at once (every interface).
  useVisitorEvents(!!view, () => void refetch());

  const firstName = currentUser?.name?.split(" ")[0] ?? "there";
  const hour = istHour();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const today = new Date();
  const readAt = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : null;
  const notSetUp = data === null && !isLoading && !isError;
  const loading = isLoading && !!view;
  const c = data?.counts;
  // A count for StatGrid: the animated number has to sit inside text (Figure), never straight in a View.
  const num = (v: number | undefined, red = false) =>
    loading || v == null ? "…" : <Figure size={20} color={red ? S.red : S.ink}><Tick value={v} /></Figure>;

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const flats = data?.flats ?? [];
  const activeResident = residentId ?? data?.residentId ?? flats[0]?.residentId ?? null;
  const activeFlat = flats.find((f) => f.residentId === activeResident);
  const a = data?.assignment;

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
            <Label>Civilier Security · {view ? VIEW_LABEL[view] : role.replace(/_/g, " ") || "user"}</Label>
            <TitleText size={34}>
              {greeting}, <Text style={{ color: S.blue }}>{firstName}.</Text>
            </TitleText>
          </View>
          <View style={{ borderTopWidth: 1, borderTopColor: S.ink }}>
            {view === "guard" && (
              <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: S.ink }}>
                <View style={{ flex: 1.4, paddingHorizontal: 14, paddingVertical: 10, borderRightWidth: 1, borderRightColor: S.ink }}>
                  <Label style={{ marginBottom: 3 }}>Gate</Label>
                  <Body size={13} weight="semibold">{loading ? "…" : a ? a.gateName : "Not assigned today"}</Body>
                  {!!a?.projectName && <Body size={11.5} color={S.graphite}>{a.projectName}</Body>}
                </View>
                <View style={{ flex: 1, paddingHorizontal: 14, paddingVertical: 10 }}>
                  <Label style={{ marginBottom: 3 }}>Shift</Label>
                  <Body size={13}>{a?.shiftStart ? `${clock(a.shiftStart)} – ${clock(a.shiftEnd)}` : "—"}</Body>
                  {a && <Body size={11.5} color={a.onDuty ? S.blue : S.graphite}>{a.onDuty ? "On duty" : "Off duty"}</Body>}
                </View>
              </View>
            )}
            {view === "customer" && activeFlat && (
              <View style={{ paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: S.ink }}>
                <Label style={{ marginBottom: 3 }}>Flat</Label>
                <Body size={13} weight="semibold">{flatOf(activeFlat)} · {activeFlat.projectName}</Body>
              </View>
            )}
            <View style={{ paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: S.ink }}>
              <Label style={{ marginBottom: 3 }}>Day</Label>
              <Body size={13}>{today.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</Body>
            </View>
            <View style={{ flexDirection: "row" }}>
              <View style={{ flex: 1, paddingHorizontal: 14, paddingVertical: 10, borderRightWidth: 1, borderRightColor: S.ink }}>
                <Label style={{ marginBottom: 3 }}>Read at</Label>
                <Body size={13}>{readAt ?? "—"}</Body>
              </View>
              <View style={{ flex: 1, paddingHorizontal: 14, paddingVertical: 10, justifyContent: "flex-end" }}>
                <LinkLabel onPress={() => void refetch()} color={S.blue}>{isFetching ? "Reading…" : "Re-read"}</LinkLabel>
              </View>
            </View>
          </View>
        </View>

        {!view && (
          <View style={{ borderTopWidth: 1, borderTopColor: S.rule, paddingVertical: 40, paddingHorizontal: 16, alignItems: "center", gap: 6 }}>
            <Body weight="semibold" size={15}>This account has no security role.</Body>
            <Body size={13} color={S.graphite} style={{ textAlign: "center" }}>
              Guards, security admins and residents use this app. Ask your administrator to give your account one of those roles.
            </Body>
          </View>
        )}

        {isError && (
          <View style={{ borderTopWidth: 1, borderTopColor: S.rule, padding: 16 }}>
            <Notice>{(error as Error)?.message || "Could not reach the server."}</Notice>
          </View>
        )}
        {notSetUp && (
          <View style={{ borderTopWidth: 1, borderTopColor: S.rule, padding: 16 }}>
            <Notice tone="ink">Security isn't set up on the server yet, so there are no figures to show.</Notice>
          </View>
        )}

        {/* ── Guard ── */}
        {view === "guard" && (
          <>
            <TrackingCard onDuty={!!a?.onDuty} shiftEnd={a?.shiftEnd ?? null} />
            <View style={{ borderTopWidth: 1, borderTopColor: S.rule, padding: 16, gap: 10 }}>
              <Key tone="ink" label="New visitor" icon={<UserPlus size={15} color={S.paper} />} onPress={() => {
                  refusedWhileQueued.length = 0;
                  navigation.navigate("NewVisitor");
                }} disabled={!loading && data !== null && !a} />
              {queued > 0 && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <CloudOff size={14} color={S.red} />
                  <Body size={12.5} color={S.red}>{queued} request{queued === 1 ? "" : "s"} waiting for the network. They're sent once it's back.</Body>
                </View>
              )}
              {refusedWhileQueued.length > 0 && (
                <Notice>{refusedWhileQueued.map((r) => `Flat ${r.flat}: ${r.error}`).join("\n")}</Notice>
              )}
            </View>
            <Detail tag="A" title="Today at the gate">
              <StatGrid
                cols={2}
                items={[
                  { label: "Visitors today", value: num(c?.today) },
                  { label: "Waiting on residents", value: num(c?.pending) },
                  { label: "Approved", value: num(c?.approved) },
                  { label: "Denied", value: num(c?.denied, (c?.denied ?? 0) > 0) },
                  { label: "No response", value: num(c?.noResponse), wide: true },
                ]}
              />
            </Detail>
            <Detail tag="B" title="Waiting on residents" note={data?.pending.length ? `${data.pending.length} open` : "All clear"}>
              <VisitorList rows={data?.pending ?? []} loading={loading} onOpen={openVisitor} empty="No visitor is waiting for a decision." />
            </Detail>
            <Detail tag="C" title="Visitors so far" note="Today, latest first">
              <VisitorList rows={data?.recent ?? []} loading={loading} onOpen={openVisitor} empty="No visitors yet today." />
            </Detail>
          </>
        )}

        {/* ── Security admin ── */}
        {view === "admin" && (
          <>
            <Detail tag="A" title="Key numbers" note="Today, all gates">
              <StatGrid
                cols={2}
                items={[
                  { label: "Guards on duty", value: num(c?.guardsOnDuty) },
                  { label: "Open alerts", value: num(c?.openAlerts, (c?.openAlerts ?? 0) > 0) },
                  { label: "Visitors today", value: num(c?.today) },
                  { label: "Unanswered today", value: num(c?.noResponse, (c?.noResponse ?? 0) > 0) },
                ]}
              />
            </Detail>
            <Detail tag="B" title="Alerts" note={c?.openAlerts ? `${c.openAlerts} not acknowledged` : "All clear"}>
              {loading ? (
                <Skel h={34} />
              ) : (data?.alerts ?? []).length === 0 ? (
                <Body size={13.5} color={S.ink2}>No alerts. Every guard is in their zone and online.</Body>
              ) : (
                (data?.alerts ?? []).slice(0, 8).map((x, i, arr) => <AlertLine key={x.id} a={x} last={i === arr.length - 1} onAck={acknowledge} />)
              )}
            </Detail>
            <Detail tag="C" title="Guards on duty" note={c?.guardsOnDuty != null ? `${c.guardsOnDuty} on shift` : undefined}>
              {loading ? (
                <Skel h={34} />
              ) : (data?.guards ?? []).length === 0 ? (
                <Body size={13.5} color={S.ink2}>No guard is on shift right now.</Body>
              ) : (
                (data?.guards ?? []).map((g, i, arr) => <GuardLine key={g.guardId} g={g} last={i === arr.length - 1} />)
              )}
            </Detail>
            <Detail tag="D" title="Seven days of visitors" note="Requests by outcome">
              {(data?.week ?? []).length ? <WeekBars rows={data!.week!} /> : <Body color={S.graphite}>{loading ? "Reading…" : "No visitors in the last seven days."}</Body>}
            </Detail>
            <Detail tag="E" title="Visitor log" note="Latest at every gate">
              <VisitorList rows={data?.recent ?? []} loading={loading} showGuard onOpen={openVisitor} empty="No visitors logged yet." />
            </Detail>
          </>
        )}

        {/* ── Resident ── */}
        {view === "customer" && (
          <>
            {flats.length > 1 && (
              <View style={{ borderTopWidth: 1, borderTopColor: S.rule, paddingHorizontal: 16, paddingVertical: 12, gap: 8 }}>
                <Label>Your flats</Label>
                <Seg
                  options={flats.map((f) => ({ value: String(f.residentId), label: flatOf(f) }))}
                  value={String(activeResident ?? "")}
                  onChange={(v) => setResidentId(Number(v))}
                />
              </View>
            )}
            <Detail tag="A" title="Waiting for you" note={data?.pending.length ? `${data.pending.length} at the gate` : "Nobody waiting"}>
              <VisitorList rows={data?.pending ?? []} loading={loading} showFlat={false} onOpen={openVisitor} empty="Nobody is waiting at the gate for you." />
            </Detail>
            <Detail tag="B" title="This week">
              <StatGrid
                cols={3}
                items={[
                  { label: "Approved", value: num(c?.approved) },
                  { label: "Denied", value: num(c?.denied) },
                  { label: "Missed", value: num(c?.noResponse, (c?.noResponse ?? 0) > 0) },
                ]}
              />
            </Detail>
            <Detail tag="C" title="Visitor history" note="Latest first">
              <VisitorList rows={data?.recent ?? []} loading={loading} showFlat={false} onOpen={openVisitor} empty="No visitors yet." />
            </Detail>
          </>
        )}

        <View style={{ borderTopWidth: 1, borderTopColor: S.rule, flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: 8, paddingHorizontal: 16, paddingVertical: 12 }}>
          <Label>Civilier Security · {today.getFullYear()}</Label>
          <Label>Crafted by Rajwada Infotech</Label>
        </View>
      </SheetFrame>
    </ScrollView>
  );
}
