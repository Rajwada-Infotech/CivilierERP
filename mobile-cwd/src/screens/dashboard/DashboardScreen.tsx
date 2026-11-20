// The Civil Work DPR dashboard on the drawing sheet, as the Admin and Finance apps draw theirs: the title block with the
// drawing's corner box (date, when read, Re-read), then lettered details that answer "what needs me now?" first:
//   A Needs attention   overdue · due in 2 days · rework · on hold — each opens exactly that list
//   B Progress          live work's average progress, the completion rate, finished this week against last week
//   C Quality & approval awaiting QC, waiting for approval (shown to those who can open Quality Check)
//   D Work pipeline     where every activity sits, in one measured bar; a status opens its list
//   E Most overdue      the activities furthest past their end date
//   F Projects          progress per project, with its overdue count
//   G Engineers         live work per engineer, overdue in red
//   H On site today     skilled, unskilled, crews reporting
//   I Last 14 days      activities completed per day, newly allocated drawn over it
// Every number comes from GET /api/civilworkdpr-dashboard and counts each activity's CURRENT attempt only, scoped to the
// signed-in user's projects by the server. Re-read every minute and on pull-down.
import { useState } from "react";
import { RefreshControl, ScrollView, Text, View, useWindowDimensions } from "react-native";
import Svg, { Line, Rect, Text as SvgText } from "react-native-svg";
import { useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react-native";
import { colors, sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { useAuth } from "@/auth/AuthContext";
import { STATUS_LABEL } from "@/components/StatusPill";
import { getCwdDashboard, type CwdDashboard } from "@/api/cwdApi";
import { usePageRights } from "@/hooks/usePageRights";
import { AnimatedPath, Body, Detail, Grow, Label, Notice, Press, SheetFrame, Skel, Tick, TitleText, useDraw } from "@/components/sheet/Sheet";

type Nav = { navigate: (name: string, params?: object) => void };
const fmtNum = (n: number) => new Intl.NumberFormat("en-IN").format(n);
const share = (part: number, whole: number) => (whole > 0 ? Math.min(100, Math.max(0, (part / whole) * 100)) : 0);

// Pipeline statuses in order, each drawn in a tone of the sheet: settled work blue, under way ink, stopped red.
const PIPELINE = ["PENDING", "ALLOCATED", "IN_PROGRESS", "HOLD", "REWORK", "COMPLETED", "APPROVED"] as const;
type Stage = (typeof PIPELINE)[number];
const STAGE_TONE: Record<Stage, string> = {
  PENDING: S.line15,
  ALLOCATED: S.line40,
  IN_PROGRESS: S.ink,
  HOLD: S.graphite,
  REWORK: S.red,
  COMPLETED: S.blueTint,
  APPROVED: S.blue,
};

/** A big figure that counts up, with its capital label above and a note under it. */
function BigFigure({ label, value, note, suffix = "", red, size = 40 }: { label: string; value: number; note?: string; suffix?: string; red?: boolean; size?: number }) {
  return (
    <View>
      <Label color={red ? S.red : S.graphite}>{label}</Label>
      <Text style={{ fontFamily: fonts.heading.semibold, fontSize: size, lineHeight: size * 1.05, letterSpacing: -size * 0.03, color: red ? S.red : S.ink, marginTop: 8, fontVariant: ["tabular-nums"] }}>
        <Tick value={value} />
        {suffix}
      </Text>
      {!!note && <Body size={11.5} color={S.graphite} style={{ marginTop: 4 }}>{note}</Body>}
    </View>
  );
}

/** One cell of a ruled 2×2 grid of counts; the whole cell opens its list. Red when a count that matters is above zero. */
function CountCell({ label, value, note, alarm, onPress, right, bottom }: { label: string; value: number; note: string; alarm?: boolean; onPress?: () => void; right?: boolean; bottom?: boolean }) {
  const red = alarm && value > 0;
  return (
    <Press
      onPress={onPress}
      disabled={!onPress}
      style={(pressed) => ({
        width: "50%", padding: 12, gap: 6,
        borderLeftWidth: right ? 1 : 0, borderLeftColor: S.rule,
        borderTopWidth: bottom ? 1 : 0, borderTopColor: S.rule,
        backgroundColor: pressed ? S.blueWash : "transparent",
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Label color={red ? S.red : S.graphite} style={{ flex: 1 }}>{label}</Label>
        {onPress && <ChevronRight size={12} color={S.graphite} />}
      </View>
      <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 28, letterSpacing: -0.8, color: red ? S.red : value ? S.ink : S.graphite, fontVariant: ["tabular-nums"] }}>
        <Tick value={value} />
      </Text>
      <Body size={11} color={S.graphite}>{note}</Body>
    </Press>
  );
}

/** A horizontal bar: name, a track scaled to `max`, the filled part, its label at the end. */
function BarRow({ name, value, max, label, color = S.ink, note }: { name: string; value: number; max: number; label: string; color?: string; note?: string }) {
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.body.semibold, fontSize: 13, color: S.ink }}>{name}</Text>
        <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 12.5, color: S.ink, fontVariant: ["tabular-nums"] }}>{label}</Text>
      </View>
      <View style={{ height: 10, backgroundColor: S.line15 }}>
        <Grow style={{ height: "100%", width: `${share(value, max)}%`, backgroundColor: color }} />
      </View>
      {!!note && <Body size={11} color={S.graphite}>{note}</Body>}
    </View>
  );
}

/** The last 14 days: a bar per day for activities completed, with the newly allocated drawn as a line over them. */
function TwoWeeks({ rows, width }: { rows: CwdDashboard["assignmentTimeline"]; width: number }) {
  const W = Math.max(200, width);
  const H = 132;
  const pad = 4;
  const base = H - 22;
  const top = 18;
  const max = Math.max(1, ...rows.map((r) => Math.max(r.completed, r.assigned)));
  const slot = rows.length ? (W - pad * 2) / rows.length : 0;
  const cx = (i: number) => pad + slot * i + slot / 2;
  const y = (v: number) => base - (v / max) * (base - top);
  const line = rows.map((r, i) => `${i ? "L" : "M"}${cx(i).toFixed(1)},${y(r.assigned).toFixed(1)}`).join(" ");
  const len = rows.reduce((acc, r, i) => (i ? acc + Math.hypot(slot, y(r.assigned) - y(rows[i - 1].assigned)) : 0), 0) + 2;
  const dash = useDraw(len);
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric" });
  return (
    <Svg width={W} height={H}>
      <Line x1={pad} x2={W - pad} y1={base} y2={base} stroke={S.ink} />
      <Line x1={pad} x2={W - pad} y1={top} y2={top} stroke={S.rule} strokeDasharray="2 5" />
      {rows.map((r, i) => {
        const h = base - y(r.completed);
        const w = Math.min(14, slot * 0.55);
        return <Rect key={r.date} x={cx(i) - w / 2} y={base - h} width={w} height={h} fill={S.blue} />;
      })}
      <AnimatedPath d={line} fill="none" stroke={S.ink} strokeWidth={1.5} strokeLinejoin="round" strokeDasharray={`${len} ${len}`} strokeDashoffset={dash} />
      {rows.map((r, i) => (i === 0 || i === rows.length - 1 || i === Math.floor(rows.length / 2) ? (
        <Line key={`t${r.date}`} x1={cx(i)} x2={cx(i)} y1={base} y2={base + 4} stroke={S.ink} />
      ) : null))}
      {/* Day numbers at the start, middle and end. */}
      {[0, Math.floor(rows.length / 2), rows.length - 1].filter((i, k, a) => rows[i] && a.indexOf(i) === k).map((i) => (
        <SvgLabel key={`l${i}`} x={cx(i)} y={base + 16} text={day(rows[i].date)} />
      ))}
    </Svg>
  );
}

function SvgLabel({ x, y, text }: { x: number; y: number; text: string }) {
  return <SvgText x={x} y={y} textAnchor="middle" fontFamily={fonts.heading.semibold} fontSize={9.5} fill={S.graphite}>{text}</SvgText>;
}

export default function DashboardScreen() {
  const rights = usePageRights("civilworkdpr-dashboard");
  const qcRights = usePageRights("civilworkdpr-quality-check");
  const { currentUser } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const q = useQuery({ queryKey: ["cwd-dashboard"], queryFn: getCwdDashboard, staleTime: 30_000, refetchInterval: 60_000, enabled: rights.canView });
  const readAt = q.dataUpdatedAt ? new Date(q.dataUpdatedAt) : new Date();

  const onRefresh = async () => {
    setRefreshing(true);
    await q.refetch();
    setRefreshing(false);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingBottom: 110 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={S.ink} />}
    >
      <SheetFrame>
        {/* Title block, with the drawing's corner box: date, when read, Re-read. */}
        <View>
          <View style={{ paddingHorizontal: 16, paddingTop: 20, paddingBottom: 18, gap: 8 }}>
            <Label>CivilierERP · Civil Work DPR{currentUser?.name ? ` · ${currentUser.name.split(" ")[0]}` : ""}</Label>
            <TitleText size={30}>Site progress</TitleText>
            <Body size={13} color={S.ink2}>What is overdue or stuck, how far the live work has come, and who is on site today.</Body>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", borderTopWidth: 1, borderTopColor: S.ink }}>
            <View style={{ width: "100%", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: S.ink, gap: 3 }}>
              <Label>Date</Label>
              <Body size={13}>{readAt.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</Body>
            </View>
            <View style={{ width: "50%", paddingHorizontal: 14, paddingVertical: 10, borderRightWidth: 1, borderRightColor: S.ink, gap: 3 }}>
              <Label>Read at</Label>
              <Body size={13}>{readAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</Body>
            </View>
            <Press onPress={() => void q.refetch()} disabled={q.isFetching || !rights.canView} style={(pressed) => ({ width: "50%", paddingHorizontal: 14, paddingVertical: 10, justifyContent: "flex-end", backgroundColor: pressed ? S.blueWash : "transparent" })}>
              <Label color={S.blue}>{q.isFetching ? "Reading…" : "Re-read"}</Label>
            </Press>
          </View>
        </View>

        {!rights.canView ? (
          <View style={{ borderTopWidth: 1, borderTopColor: S.rule, padding: 14 }}>
            <Notice tone="ink">You don't have permission to view the Civil Work DPR dashboard. Ask your administrator if you need access.</Notice>
          </View>
        ) : q.isLoading ? (
          <View style={{ borderTopWidth: 1, borderTopColor: S.rule, padding: 14 }}>
            <Skel h={110} />
            <Skel h={80} />
            <Skel h={60} />
          </View>
        ) : q.isError || !q.data ? (
          <View style={{ borderTopWidth: 1, borderTopColor: S.rule, padding: 14 }}>
            <Notice>{(q.error as Error)?.message || "Could not load the dashboard."} Use Re-read or pull down to try again.</Notice>
          </View>
        ) : null}

        {rights.canView && q.data ? <Content d={q.data} showQc={qcRights.canView} /> : null}
      </SheetFrame>
    </ScrollView>
  );
}

function Content({ d, showQc }: { d: CwdDashboard; showQc: boolean }) {
  const navigation = useNavigation<Nav>();
  const { width } = useWindowDimensions();
  const openList = (filter: string) => navigation.navigate("Activities", { filter });
  const by = d.current.byStatus;
  const n = (s: keyof typeof by) => by[s] ?? 0;
  const ins = d.insights;
  const progress = ins.avgProgress ?? 0;
  const delta = ins.doneThisWeek - ins.doneLastWeek;
  const allClear = ins.overdue + ins.dueSoon + n("REWORK") + n("HOLD") === 0;
  const pipeline = PIPELINE.map((s) => ({ key: s, count: n(s) })).filter((p) => p.count > 0);
  const pipelineTotal = pipeline.reduce((a, p) => a + p.count, 0);
  const engMax = Math.max(1, ...d.engineerLoad.map((x) => x.active));
  const done14 = d.assignmentTimeline.reduce((a, p) => a + p.completed, 0);
  const new14 = d.assignmentTimeline.reduce((a, p) => a + p.assigned, 0);
  // The sheet sits 5 + 3 + 1.5 in from each side and the detail 14 more: what is left for the chart.
  const chartW = width - 2 * (5 + 1 + 3 + 1.5 + 14);

  let tag = 0;
  const next = () => String.fromCharCode(65 + tag++);

  return (
    <>
      <Detail tag={next()} title="Needs attention" note={allClear ? "All clear" : "Tap to open"}>
        {allClear ? (
          <Body size={13} color={S.graphite}>Nothing is overdue, due soon, on hold or sent back for rework.</Body>
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", borderWidth: 1, borderColor: S.ink }}>
            <CountCell label="Overdue" value={ins.overdue} note="past their end date" alarm onPress={() => openList("OVERDUE")} />
            <CountCell label="Due soon" value={ins.dueSoon} note="finish within 2 days" right onPress={() => openList("DUE_SOON")} />
            <CountCell label="Rework" value={n("REWORK")} note="sent back by QC" alarm bottom onPress={() => openList("REWORK")} />
            <CountCell label="On hold" value={n("HOLD")} note="paused, clock running" right bottom onPress={() => openList("HOLD")} />
          </View>
        )}
      </Detail>

      <Detail tag={next()} title="Progress" note={`${fmtNum(d.current.active)} live`}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", columnGap: 30, rowGap: 14 }}>
          <BigFigure label="Live work" value={progress} suffix="%" note="average progress" />
          <BigFigure label="Completion" value={d.current.completionRate} suffix="%" note="of all work" size={30} />
        </View>
        <View style={{ marginTop: 18, height: 14, borderWidth: 1.5, borderColor: S.ink, backgroundColor: S.paper }}>
          <Grow style={{ height: "100%", width: `${share(d.current.completionRate, 100)}%`, backgroundColor: S.blue }} />
        </View>
        <Text style={{ fontFamily: fonts.body.regular, fontSize: 12, color: S.graphite, marginTop: 10 }}>
          <Text style={{ fontFamily: fonts.heading.semibold, color: S.ink }}>{fmtNum(ins.doneThisWeek)}</Text>
          {" finished this week · "}
          <Text style={{ fontFamily: fonts.heading.semibold, color: S.ink }}>{fmtNum(ins.doneLastWeek)}</Text>
          {" last week · "}
          <Text style={{ fontFamily: fonts.heading.semibold, color: delta < 0 ? S.red : S.ink }}>{delta > 0 ? `+${delta}` : delta}</Text>
        </Text>
      </Detail>

      {showQc && (
        <Detail tag={next()} title="Quality & approval">
          <View style={{ flexDirection: "row", flexWrap: "wrap", borderWidth: 1, borderColor: S.ink }}>
            <CountCell label="Awaiting QC" value={ins.awaitingQc} note="completed, not yet checked" onPress={() => navigation.navigate("QualityCheck")} />
            <CountCell label="To approve" value={ins.awaitingApproval} note="QC passed" right onPress={() => openList("COMPLETED")} />
          </View>
        </Detail>
      )}

      <Detail tag={next()} title="Work pipeline" note={pipelineTotal ? `${fmtNum(pipelineTotal)} activities` : undefined}>
        {pipelineTotal === 0 ? (
          <Body size={13} color={S.graphite}>No allocated work yet.</Body>
        ) : (
          <>
            <View style={{ height: 30, flexDirection: "row", borderWidth: 1.5, borderColor: S.ink, backgroundColor: S.paper, overflow: "hidden" }}>
              {pipeline.map((p, i) => (
                <Grow key={p.key} delay={i * 60} style={{ height: "100%", width: `${share(p.count, pipelineTotal)}%`, backgroundColor: STAGE_TONE[p.key] }} />
              ))}
            </View>
            <View style={{ marginTop: 12 }}>
              {pipeline.map((p, i) => (
                <Press
                  key={p.key}
                  onPress={() => openList(p.key)}
                  style={(pressed) => ({ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, borderTopWidth: i ? 1 : 0, borderTopColor: S.ruleSoft, backgroundColor: pressed ? S.blueWash : "transparent" })}
                >
                  <View style={{ width: 10, height: 10, backgroundColor: STAGE_TONE[p.key], borderWidth: 1, borderColor: S.ink }} />
                  <Body size={13} style={{ flex: 1 }}>{STATUS_LABEL[p.key]}</Body>
                  <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 13, color: S.ink, fontVariant: ["tabular-nums"] }}>{fmtNum(p.count)}</Text>
                  <ChevronRight size={12} color={S.graphite} />
                </Press>
              ))}
            </View>
          </>
        )}
        <Press onPress={() => openList("ALL")} style={(pressed) => ({ marginTop: 14, minHeight: 40, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: S.ink, backgroundColor: pressed ? S.blueWash : "transparent" })}>
          <Label color={S.ink}>Open all activities</Label>
        </Press>
      </Detail>

      {d.overdueList.length > 0 && (
        <Detail tag={next()} title="Most overdue" note={`${fmtNum(ins.overdue)} in all`}>
          <View style={{ flexDirection: "row", paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: S.ink }}>
            <Label style={{ flex: 1 }}>Activity · where · who</Label>
            <Label>Late</Label>
          </View>
          {d.overdueList.map((o) => (
            <Press
              key={o.rungId}
              onPress={() => navigation.navigate("ActivityDetail", { rungId: o.rungId })}
              style={(pressed) => ({ flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: S.ruleSoft, backgroundColor: pressed ? S.blueWash : "transparent" })}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontFamily: fonts.body.semibold, fontSize: 13, color: S.ink }}>{o.activityName ?? "Activity"}</Text>
                <Text numberOfLines={1} style={{ fontFamily: fonts.body.regular, fontSize: 11.5, color: S.graphite, marginTop: 1 }}>{[o.projectName, o.scopePath].filter(Boolean).join(" · ")}</Text>
                <Text numberOfLines={1} style={{ fontFamily: fonts.body.regular, fontSize: 11.5, color: S.ink2, marginTop: 2 }}>{o.engineerNames || "No engineer"} · {o.progressPercent}% done</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 16, color: S.red, fontVariant: ["tabular-nums"] }}>{o.daysOverdue}</Text>
                <Label color={S.red}>{o.daysOverdue === 1 ? "day" : "days"}</Label>
              </View>
            </Press>
          ))}
          <Press onPress={() => openList("OVERDUE")} style={(pressed) => ({ marginTop: 14, minHeight: 40, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: S.ink, backgroundColor: pressed ? S.blueWash : "transparent" })}>
            <Label color={S.ink}>See every overdue activity</Label>
          </Press>
        </Detail>
      )}

      {d.projects.length > 0 && (
        <Detail tag={next()} title="Projects" note="Average progress">
          <View style={{ gap: 16 }}>
            {d.projects.map((p) => (
              <BarRow
                key={p.name}
                name={p.name}
                value={p.avgProgress}
                max={100}
                label={`${p.avgProgress}%`}
                color={p.overdue > 0 ? S.red : S.ink}
                note={`${fmtNum(p.done)} of ${fmtNum(p.total)} done · ${fmtNum(p.inProgress)} in progress${p.overdue > 0 ? ` · ${fmtNum(p.overdue)} overdue` : ""}`}
              />
            ))}
          </View>
        </Detail>
      )}

      {d.engineerLoad.length > 0 && (
        <Detail tag={next()} title="Engineers" note="Live work">
          <View style={{ gap: 14 }}>
            {d.engineerLoad.map((e) => (
              <BarRow
                key={e.name}
                name={e.name}
                value={e.active}
                max={engMax}
                label={`${fmtNum(e.active)} live`}
                color={e.overdue > 0 ? S.red : S.ink}
                note={e.overdue > 0 ? `${fmtNum(e.overdue)} overdue` : undefined}
              />
            ))}
          </View>
        </Detail>
      )}

      <Detail tag={next()} title="On site today" note="Labour logged">
        <View style={{ flexDirection: "row" }}>
          {[
            { label: "Skilled", value: d.labour.skilledToday },
            { label: "Unskilled", value: d.labour.unskilledToday },
            { label: "Crews", value: d.labour.crewsToday },
          ].map((x, i) => (
            <View key={x.label} style={{ flex: 1, paddingLeft: i ? 12 : 0, borderLeftWidth: i ? 1 : 0, borderLeftColor: S.rule }}>
              <Label>{x.label}</Label>
              <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 26, letterSpacing: -0.6, color: x.value ? S.ink : S.graphite, marginTop: 8, fontVariant: ["tabular-nums"] }}>
                <Tick value={x.value} />
              </Text>
            </View>
          ))}
        </View>
      </Detail>

      <Detail tag={next()} title="Last 14 days" note={`${fmtNum(done14)} completed`}>
        <TwoWeeks rows={d.assignmentTimeline} width={chartW} />
        <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 16, rowGap: 4, marginTop: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={{ width: 9, height: 9, backgroundColor: S.blue }} />
            <Body size={12} color={S.graphite}>
              <Text style={{ fontFamily: fonts.heading.semibold, color: S.ink }}>{fmtNum(done14)}</Text> completed
            </Body>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={{ width: 14, height: 2, backgroundColor: S.ink }} />
            <Body size={12} color={S.graphite}>
              <Text style={{ fontFamily: fonts.heading.semibold, color: S.ink }}>{fmtNum(new14)}</Text> newly allocated
            </Body>
          </View>
        </View>
      </Detail>
    </>
  );
}
