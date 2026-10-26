// Depreciation Run — post a month's depreciation for every depreciation-tagged asset of a project, or switch on
// "Custom month range" to run several months at once (oldest first). Same endpoints and rules as the web menu:
// anything already posted is skipped, never posted twice.
import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, Switch, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import { toast } from "@/components/Toast";
import { PickerField } from "@/components/form";
import { usePageRights } from "@/hooks/usePageRights";
import { getProjects } from "@/api/mastersApi";
import {
  generateMonth, generateRange, getRunPreview, type RangeResult, type RunAssetRow,
} from "@/api/depreciationRunApi";

const ACCENT = "#eab308";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const label = (y: number, m: number) => `${MONTHS[m - 1]} ${y}`;
const MAX_RANGE = 36;

// The last 48 months up to and including this one — newest first.
function monthOptions() {
  const now = new Date();
  const out: { key: string; label: string }[] = [];
  for (let i = 0; i < 48; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: label(d.getFullYear(), d.getMonth() + 1) });
  }
  return out;
}
const lastClosed = () => monthOptions()[1].key;
const parse = (k: string) => { const [y, m] = k.split("-").map(Number); return { year: y, month: m }; };

const STATE_META = {
  posted: { text: "Posted", color: "#10b981" },
  pending: { text: "Due", color: ACCENT },
  notEligible: { text: "Not due", color: "#64748b" },
} as const;

export default function DepreciationRunScreen() {
  const rights = usePageRights("fixed-asset-depreciation-generate");
  const qc = useQueryClient();
  const options = useMemo(monthOptions, []);

  const [projectId, setProjectId] = useState("");
  const [rangeMode, setRangeMode] = useState(false);
  const [monthKey, setMonthKey] = useState(lastClosed());
  const [fromKey, setFromKey] = useState(lastClosed());
  const [toKey, setToKey] = useState(lastClosed());
  const [rangeResult, setRangeResult] = useState<RangeResult | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const projectsQ = useQuery({ queryKey: ["m-projects"], queryFn: getProjects });
  const projectOpts = useMemo(() => (projectsQ.data ?? []).map((p) => ({ key: String(p.id), label: p.label })), [projectsQ.data]);

  const pid = Number(projectId) || 0;
  const shownKey = rangeMode ? toKey : monthKey;
  const { year, month } = parse(shownKey);
  const from = parse(fromKey);
  const rangeMonths = (year * 12 + month) - (from.year * 12 + from.month) + 1;
  const rangeError = !rangeMode ? null : rangeMonths < 1 ? "The 'To' month can't be before the 'From' month." : rangeMonths > MAX_RANGE ? `A range can cover at most ${MAX_RANGE} months.` : null;

  const previewQ = useQuery({
    queryKey: ["fa-dep-run", pid, year, month],
    queryFn: () => getRunPreview(pid, year, month),
    enabled: pid > 0,
  });
  const preview = previewQ.data;
  const due = preview?.counts.pending ?? 0;
  const dueAmount = (preview?.rows ?? []).filter((r) => r.state === "pending").reduce((t, r) => t + (Number(r.amount) || 0), 0);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["fa-dep-run"] });
    qc.invalidateQueries({ queryKey: ["fa-asset-dep"] });
    qc.invalidateQueries({ queryKey: ["fa-assets"] });
    qc.invalidateQueries({ queryKey: ["fa-dashboard"] });
  };

  const single = useMutation({
    mutationFn: () => generateMonth(pid, year, month),
    onSuccess: (r) => {
      const c = r.counts;
      if (c.generated > 0) toast.success(`${c.generated} asset${c.generated === 1 ? "" : "s"} generated for ${label(year, month)} — ${formatINR(r.totalAmount, { decimals: 2 })}`);
      else if (c.failed > 0) toast.error(`Nothing was generated — ${c.failed} asset(s) failed`);
      else toast.info(`Nothing new to generate — ${c.alreadyPosted} already posted`);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const range = useMutation({
    mutationFn: () => generateRange(pid, from, { year, month }),
    onSuccess: (r) => {
      setRangeResult(r);
      if (r.stoppedAt) toast.error(`Stopped at ${label(r.stoppedAt.year, r.stoppedAt.month)}: ${r.stoppedAt.message}`);
      if (r.counts.generated > 0) toast.success(`${r.counts.generated} posting${r.counts.generated === 1 ? "" : "s"} generated across ${r.months.length} month${r.months.length === 1 ? "" : "s"} — ${formatINR(r.totalAmount, { decimals: 2 })}`);
      else if (!r.stoppedAt) toast.info(`Nothing new to generate — ${r.counts.alreadyPosted} already posted`);
      if (r.counts.failed > 0) toast.error(`${r.counts.failed} posting(s) failed — see the month list`);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const working = single.isPending || range.isPending;
  const canRun = rights.canCreate && pid > 0 && !working && (rangeMode ? !rangeError : !!preview && due > 0);

  const confirmRun = () => {
    if (rangeMode) {
      const rangeText = rangeMonths > 1 ? `${label(from.year, from.month)} – ${label(year, month)}` : label(year, month);
      Alert.alert(
        `Run depreciation for ${rangeText}?`,
        "Every month in the range is posted in order, oldest first, for each asset still due. Months and assets already posted are skipped — nothing is posted twice.",
        [{ text: "Cancel", style: "cancel" }, { text: "Run", onPress: () => range.mutate() }],
      );
    } else {
      Alert.alert(
        `Generate ${label(year, month)} depreciation?`,
        `${due} asset${due === 1 ? "" : "s"} will be posted — ${formatINR(dueAmount, { decimals: 2 })} in total.${preview?.counts.posted ? ` ${preview.counts.posted} already posted will be skipped.` : ""}`,
        [{ text: "Cancel", style: "cancel" }, { text: "Generate", onPress: () => single.mutate() }],
      );
    }
  };

  if (!rights.canView) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", padding: 32 }}>
        <Text style={{ color: colors.mutedForeground, fontFamily: fonts.body.regular, fontSize: 12 }}>You don't have access to the Depreciation Run.</Text>
      </View>
    );
  }

  const renderRow = ({ item }: { item: RunAssetRow }) => {
    const meta = STATE_META[item.state];
    return (
      <View style={{ backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <Text numberOfLines={1} style={{ flex: 1, color: colors.foreground, fontSize: 12.5, fontFamily: fonts.heading.semibold }}>{item.faItemCode}</Text>
          <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: `${meta.color}22` }}>
            <Text style={{ fontSize: 9.5, fontFamily: fonts.heading.bold, color: meta.color, textTransform: "uppercase" }}>{meta.text}</Text>
          </View>
        </View>
        <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular, marginTop: 2 }}>{item.assetName || "—"}</Text>
        {item.state === "notEligible" ? (
          <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.body.regular, marginTop: 4 }}>{item.reason}</Text>
        ) : (
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.body.regular }}>{item.voucherNo ? item.voucherNo : "Depreciation"}</Text>
            <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.heading.bold }}>{formatINR(item.amount ?? 0, { decimals: 2 })}</Text>
          </View>
        )}
      </View>
    );
  };

  const header = (
    <View style={{ gap: 12, paddingBottom: 8 }}>
      <PickerField label="Project" value={projectId} options={projectOpts} onSelect={setProjectId} required loading={projectsQ.isLoading} placeholder="Select project" />

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 2 }}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.heading.semibold }}>Custom month range</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.body.regular }}>Run several months at once</Text>
        </View>
        <Switch value={rangeMode} onValueChange={(v) => { setRangeMode(v); setRangeResult(null); }} trackColor={{ true: ACCENT }} />
      </View>

      {rangeMode ? (
        <>
          <PickerField label="From month" value={fromKey} options={options} onSelect={(k) => { setFromKey(k); setRangeResult(null); }} required searchable={false} />
          <PickerField label="To month" value={toKey} options={options} onSelect={(k) => { setToKey(k); setRangeResult(null); }} required searchable={false} />
          {!!rangeError && <Text style={{ color: colors.destructive, fontSize: 11, fontFamily: fonts.body.regular }}>{rangeError}</Text>}
        </>
      ) : (
        <PickerField label="Month" value={monthKey} options={options} onSelect={setMonthKey} required searchable={false} />
      )}

      {rights.canCreate && (
        <Pressable
          onPress={confirmRun}
          disabled={!canRun}
          style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 46, borderRadius: 12, backgroundColor: ACCENT, opacity: canRun ? 1 : 0.4 }}
        >
          {working ? <ActivityIndicator color="#1a1400" /> : <Play size={15} color="#1a1400" />}
          <Text style={{ color: "#1a1400", fontSize: 13.5, fontFamily: fonts.heading.bold }}>
            {rangeMode ? `Run${rangeMonths > 1 ? ` (${rangeMonths} months)` : ""}` : `Generate${due > 0 ? ` (${due})` : ""}`}
          </Text>
        </Pressable>
      )}

      {rangeResult && (
        <View style={{ backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12 }}>
          <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.heading.bold }}>
            Range result · {rangeResult.counts.generated} generated · {rangeResult.counts.alreadyPosted} already posted · {formatINR(rangeResult.totalAmount, { decimals: 2 })}
          </Text>
          {rangeResult.months.map((m) => (
            <View key={`${m.year}-${m.month}`} style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6, gap: 8 }}>
              <Text style={{ color: colors.foreground, fontSize: 11.5, fontFamily: fonts.heading.semibold }}>{label(m.year, m.month)}</Text>
              {m.error ? (
                <Text style={{ flex: 1, textAlign: "right", color: colors.destructive, fontSize: 11, fontFamily: fonts.body.regular }}>{m.error}</Text>
              ) : (
                <Text style={{ color: m.counts?.failed ? colors.destructive : colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular }}>
                  {m.counts?.generated} new · {m.counts?.alreadyPosted} posted · {m.counts?.skipped} not due{m.counts?.failed ? ` · ${m.counts.failed} failed` : ""} · {formatINR(m.totalAmount ?? 0, { decimals: 2 })}
                </Text>
              )}
            </View>
          ))}
        </View>
      )}

      {pid > 0 && preview && (
        <View style={{ flexDirection: "row", gap: 8 }}>
          {[
            { k: "Tagged", v: preview.counts.total },
            { k: "Posted", v: preview.counts.posted },
            { k: "Due", v: preview.counts.pending },
          ].map((s) => (
            <View key={s.k} style={{ flex: 1, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 10 }}>
              <Text style={{ color: colors.foreground, fontSize: 17, fontFamily: fonts.heading.bold }}>{s.v}</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.regular }}>{s.k} · {label(year, month)}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <FlatList
        data={pid > 0 ? preview?.rows ?? [] : []}
        keyExtractor={(r) => String(r.assetId)}
        renderItem={renderRow}
        ListHeaderComponent={header}
        ListEmptyComponent={
          pid > 0 ? (
            previewQ.isLoading ? <ActivityIndicator color={colors.mutedForeground} style={{ marginTop: 24 }} /> : (
              <Text style={{ textAlign: "center", color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, paddingVertical: 24 }}>
                {previewQ.error ? (previewQ.error as Error).message : "This project has no assets tagged for depreciation yet."}
              </Text>
            )
          ) : (
            <Text style={{ textAlign: "center", color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, paddingVertical: 24 }}>Pick a project and a month.</Text>
          )
        }
        contentContainerStyle={{ padding: 16, paddingBottom: 112 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={ACCENT} onRefresh={async () => { setRefreshing(true); await previewQ.refetch(); setRefreshing(false); }} />}
      />
    </View>
  );
}
