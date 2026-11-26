// Construction Updates — project-level progress detail and buyer note posting.
// Endpoints:
//   GET /api/crm/construction-updates/progress/:projectId  → DPR progress, towers, site feed
//   GET /api/crm/construction-updates?projectId=N          → buyer notes list
//   POST /api/crm/construction-updates                     → post a buyer note
import { useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { crmGet, crmSend, type Row } from "@/api/crmApi";
import { toast } from "@/components/Toast";
import { RemarksField } from "@/components/form/Form";
import { DateField } from "@/components/form/DateField";
import { fonts } from "@/theme/fonts";
import { useBrand } from "@/theme/ThemeContext";
import type { MainStackParamList } from "@/navigation/MainStack";
import { ActionKey, Kv, Section, fmtDate } from "./ui";

type ProgressRow = {
  projectId: number; hasDpr: boolean; pct: number | null;
  steps: number; done: number; moving: number; late: number;
  works: { groupId: number; name: string; pct: number }[];
  now: { name: string; pct: number }[];
  next: string | null; allDone: boolean;
  towers: { blockId: number; blockName: string; pct: number; steps: number; done: number; moving: number; late: number; now: { name: string; pct: number }[]; next: string | null }[];
  units: { unitId: number; unitName: string; pct: number; now: { name: string; pct: number }[]; next: string | null }[];
  feed: { at: string; work: string; activity: string; tower: string | null; unit: string | null; room: string | null; from: number | null; to: number | null; completed: boolean }[];
};

const pctColor = (pct: number | null, danger: string, warning: string, success: string) =>
  pct == null ? "#aaa" : pct >= 90 ? success : pct >= 50 ? warning : danger;

function ProgressBar({ pct, color, height = 6 }: { pct: number | null; color: string; height?: number }) {
  const b = useBrand();
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: b.border, overflow: "hidden" }}>
      <View style={{ width: `${Math.min(100, Math.max(0, pct ?? 0))}%`, height, backgroundColor: color }} />
    </View>
  );
}

function FeedItem({ item }: { item: ProgressRow["feed"][0] }) {
  const b = useBrand();
  const loc = [item.tower, item.unit, item.room].filter(Boolean).join(" › ");
  const change = item.from != null && item.to != null
    ? `${Math.round(item.from)}% → ${Math.round(item.to)}%`
    : item.to != null ? `→ ${Math.round(item.to)}%` : "";
  return (
    <View style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: b.border }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
        <Text style={{ flex: 1, fontSize: 13, fontFamily: fonts.body.medium, color: b.textPrimary }}>{item.work}</Text>
        <Text style={{ fontSize: 11.5, fontFamily: fonts.heading.semibold, color: item.completed ? b.success : b.accent, marginLeft: 8 }}>
          {item.completed ? "✓ Done" : change}
        </Text>
      </View>
      <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: b.textSecondary, marginTop: 2 }}>{item.activity}</Text>
      {loc ? <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: b.textFaint, marginTop: 1 }}>{loc}</Text> : null}
      <Text style={{ fontSize: 11, fontFamily: fonts.body.regular, color: b.textFaint, marginTop: 2 }}>{fmtDate(item.at)}</Text>
    </View>
  );
}

export default function CrmConstructionUpdatesScreen() {
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmConstructionUpdates">>();
  const { projectId, projectName } = params;
  const b = useBrand();
  const qc = useQueryClient();

  const progQ = useQuery<ProgressRow>({
    queryKey: ["crm-cu-progress", projectId],
    queryFn: () => crmGet(`/api/crm/construction-updates/progress/${projectId}`),
  });
  const notesQ = useQuery<Row[]>({
    queryKey: ["crm-cu-notes", projectId],
    queryFn: () => crmGet(`/api/crm/construction-updates?projectId=${projectId}`),
  });

  const [summary, setSummary] = useState("");
  const [updateDate, setUpdateDate] = useState("");
  const [busy, setBusy] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["crm-cu-notes", projectId] });
    qc.invalidateQueries({ queryKey: ["crm-cu-progress", projectId] });
    qc.invalidateQueries({ queryKey: ["crm-construction-updates"] });
  };

  const postUpdate = async () => {
    if (!summary.trim()) return toast.error("Write the update for buyers");
    setBusy(true);
    try {
      await crmSend("/api/crm/construction-updates", "POST", {
        ProjectId: projectId,
        Summary: summary.trim(),
        UpdateDate: updateDate || undefined,
      });
      toast.success("Update posted");
      setSummary("");
      setUpdateDate("");
      invalidate();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  if (progQ.isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: b.surface }}>
        <ActivityIndicator color={b.accent} />
      </View>
    );
  }
  if (progQ.error) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: b.surface, padding: 24 }}>
        <Text style={{ color: b.danger, fontFamily: fonts.body.medium, textAlign: "center" }}>
          {(progQ.error as Error).message}
        </Text>
      </View>
    );
  }

  const g = progQ.data;
  const overallPct = g?.pct != null ? Math.round(Number(g.pct)) : null;
  const color = pctColor(overallPct, b.danger, b.warning, b.success);
  const notes = notesQ.data ?? [];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: b.surface }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 56 }}>
      {/* Overall progress header */}
      <Section title={projectName ?? "Project"}>
        <View style={{ gap: 10 }}>
          {g?.hasDpr ? (
            <>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={{ fontSize: 28, fontFamily: fonts.heading.bold, color }}>
                  {overallPct != null ? `${overallPct}%` : "—"}
                </Text>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textSecondary }}>
                    {g.done}/{g.steps} steps
                  </Text>
                  {g.moving > 0 ? (
                    <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: b.warning }}>{g.moving} in progress</Text>
                  ) : null}
                  {g.late > 0 ? (
                    <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: b.danger }}>{g.late} running late</Text>
                  ) : null}
                </View>
              </View>
              <ProgressBar pct={overallPct} color={color} height={8} />
              {g.now.length > 0 ? (
                <Kv label="Now" value={g.now.map((w) => `${w.name} (${Math.round(w.pct)}%)`).join(", ")} />
              ) : null}
              {g.next ? <Kv label="Next" value={g.next} /> : null}
            </>
          ) : (
            <Text style={{ fontSize: 13, fontFamily: fonts.body.regular, color: b.textSecondary }}>
              No DPR data recorded yet for this project.
            </Text>
          )}
        </View>
      </Section>

      {/* DPR works breakdown */}
      {g?.hasDpr && g.works.length > 0 ? (
        <Section title="Work breakdown">
          <View style={{ gap: 10 }}>
            {g.works.map((w) => (
              <View key={w.groupId} style={{ gap: 4 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: b.textPrimary, flex: 1 }}>{w.name}</Text>
                  <Text style={{ fontSize: 12.5, fontFamily: fonts.heading.semibold, color: pctColor(w.pct, b.danger, b.warning, b.success), marginLeft: 8 }}>
                    {Math.round(w.pct)}%
                  </Text>
                </View>
                <ProgressBar pct={w.pct} color={pctColor(w.pct, b.danger, b.warning, b.success)} />
              </View>
            ))}
          </View>
        </Section>
      ) : null}

      {/* Tower breakdown */}
      {g?.towers && g.towers.length > 0 ? (
        <Section title="By block / tower">
          <View style={{ gap: 10 }}>
            {g.towers.map((t) => (
              <View key={t.blockId} style={{ gap: 4 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: b.textPrimary, flex: 1 }}>
                    {t.blockName || `Block ${t.blockId}`}
                    {t.late > 0 ? <Text style={{ color: b.danger }}>{`  ${t.late} late`}</Text> : null}
                  </Text>
                  <Text style={{ fontSize: 12.5, fontFamily: fonts.heading.semibold, color: pctColor(t.pct, b.danger, b.warning, b.success), marginLeft: 8 }}>
                    {Math.round(t.pct ?? 0)}%
                  </Text>
                </View>
                <ProgressBar pct={t.pct} color={pctColor(t.pct, b.danger, b.warning, b.success)} />
                {t.now.length > 0 ? (
                  <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: b.textSecondary }}>
                    Now: {t.now.map((w) => w.name).join(", ")}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        </Section>
      ) : null}

      {/* Recent site feed */}
      {g?.feed && g.feed.length > 0 ? (
        <Section title="Recent site activity">
          <View>
            {g.feed.slice(0, 20).map((item, i) => (
              <FeedItem key={i} item={item} />
            ))}
          </View>
        </Section>
      ) : null}

      {/* Buyer notes */}
      {notes.length > 0 ? (
        <Section title="Posted updates">
          <View style={{ gap: 10 }}>
            {notes.map((n) => (
              <View key={n.Id} style={{ backgroundColor: b.surfaceCard, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: b.border, gap: 4 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: b.textFaint }}>{fmtDate(n.UpdateDate)}</Text>
                  {n.PercentComplete != null ? (
                    <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: b.accent }}>{Math.round(Number(n.PercentComplete))}%</Text>
                  ) : null}
                </View>
                {n.Stage ? <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: b.textSecondary }}>{n.Stage}</Text> : null}
                <Text style={{ fontSize: 13, fontFamily: fonts.body.regular, color: b.textPrimary }}>{n.Summary as string}</Text>
                {n.CreatedByName ? <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: b.textFaint }}>By {n.CreatedByName as string}</Text> : null}
              </View>
            ))}
          </View>
        </Section>
      ) : null}

      {/* Post update */}
      <Section title="Post buyer update">
        <View style={{ gap: 12 }}>
          <RemarksField label="Update for buyers (required)" value={summary} onChangeText={setSummary} placeholder="e.g. Plastering work completed on floors 3–5. Flooring work starting next week." />
          <DateField label="Date (optional, defaults to today)" value={updateDate} onChange={setUpdateDate} />
          <ActionKey label={busy ? "Posting…" : "Post update"} onPress={postUpdate} />
        </View>
      </Section>
    </ScrollView>
  );
}
