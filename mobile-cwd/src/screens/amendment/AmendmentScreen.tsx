// Amendment — every activity ever sent back for rework (via Quality Check or an Approval rejection), and
// what became of it. Read-only; the mobile take on the web's src/pages/civilworkdpr/Amendment.tsx, same
// GET /api/dependency-activity-assignment/amendments endpoint. A table becomes one card per rework.
import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import { ArrowRight } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { Body, Label, Notice, Press, RegisterHead, SearchBox, SheetMark, SheetShell, Skel } from "@/components/sheet/Sheet";
import { NoAccess, SheetPage } from "@/components/sheet/Register";
import { fonts } from "@/theme/fonts";
import { usePageRights } from "@/hooks/usePageRights";
import { STATUS_LABEL, STATUS_TONE } from "@/components/StatusPill";
import { getAmendments, type AmendmentRecord } from "@/api/cwdApi";
import { dependencyAutoName, matchesAutoNameSearch } from "@/utils/dependencyAutoName";

const autoNameOf = (r: AmendmentRecord) =>
  dependencyAutoName({ flatName: r.flatName, alias: r.alias, roomName: r.roomName, storey: r.storey, activityName: r.activityName });

const SOURCE = {
  QC: { label: "Quality Check" },
  APPROVAL: { label: "Approval" },
} as const;

type Filter = "ALL" | "QC" | "APPROVAL";

const fmtDate = (s: string) => new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

/** One rework as a ruled row: the activity and how it was sent back, where, the reason in its own box, who and when,
 * then "Attempt N → where it is now". */
function AmendmentRow({ r, onOpen }: { r: AmendmentRecord; onOpen: () => void }) {
  const src = r.reworkSource ? SOURCE[r.reworkSource] : null;
  const now = r.currentStatus;
  return (
    <Press onPress={onOpen} style={(pressed) => ({ paddingVertical: 13, gap: 9, borderBottomWidth: 1, borderBottomColor: S.ruleSoft, backgroundColor: pressed ? S.blueWash : "transparent" })}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text numberOfLines={2} style={{ fontSize: 13.5, fontFamily: fonts.body.semibold, color: S.ink }}>{r.sequenceNo}. {r.activityName}</Text>
          <Text numberOfLines={2} style={{ fontSize: 11.5, fontFamily: fonts.body.medium, color: S.blue }}>{autoNameOf(r)}</Text>
        </View>
        {src && <Label color={S.red}>{src.label}</Label>}
      </View>
      <Body size={11.5} color={S.graphite}>{r.projectName ? `${r.projectName} › ` : ""}{r.scopePath}</Body>
      {/* The reason is the point of this page — it gets its own box. */}
      <View style={{ borderWidth: 1, borderColor: S.rule, padding: 10, gap: 4 }}>
        <Label>Reason</Label>
        <Text style={{ fontSize: 13, fontFamily: fonts.body.regular, fontStyle: r.reworkReason ? "normal" : "italic", color: r.reworkReason ? S.ink : S.graphite }}>
          {r.reworkReason || "No reason recorded"}
        </Text>
      </View>
      <Body size={11.5} color={S.ink2}>{r.engineerNames || "—"} · {fmtDate(r.updatedAt)}</Body>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: S.ruleSoft }}>
        <SheetMark text={`Attempt ${r.attemptNo}`} tone="stopped" />
        <ArrowRight size={12} color={S.graphite} />
        <Label>Now</Label>
        {now ? (
          <SheetMark text={`${STATUS_LABEL[now] ?? now}${r.currentAttemptNo ? ` · #${r.currentAttemptNo}` : ""}`} tone={STATUS_TONE[now] ?? "draft"} />
        ) : (
          <Text style={{ fontSize: 12, color: S.graphite }}>—</Text>
        )}
      </View>
    </Press>
  );
}

export default function AmendmentScreen() {
  const rights = usePageRights("civilworkdpr-amendment");
  const navigation = useNavigation<any>();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");
  const q = useQuery({ queryKey: ["cwd-amendments"], queryFn: getAmendments, enabled: rights.canView });
  const rows = q.data ?? [];

  const counts = useMemo(() => ({
    ALL: rows.length,
    QC: rows.filter((r) => r.reworkSource === "QC").length,
    APPROVAL: rows.filter((r) => r.reworkSource === "APPROVAL").length,
  }), [rows]);

  const shown = useMemo(() => {
    // Auto Name wise: every word typed must appear somewhere in the record (words in any order).
    return rows.filter((r) =>
      (filter === "ALL" || r.reworkSource === filter) &&
      matchesAutoNameSearch(search, [autoNameOf(r), r.activityName, r.alias, r.scopePath, r.projectName, r.engineerNames, r.reworkReason]),
    );
  }, [rows, search, filter]);

  if (!rights.canView) return <NoAccess eyebrow="Civil Work DPR" title="Amendment" what="Amendment" />;

  return (
    <SheetPage refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <SheetShell eyebrow="Civil Work DPR" title="Amendment" subtitle="Every activity sent back for rework, why, and where it is now.">
        <SearchBox value={search} onChange={setSearch} placeholder="Search Auto Name, location, engineer, reason" />

        {/* Counts and filter in one: tap a cell to show only that kind of rework. */}
        <View style={{ flexDirection: "row", borderWidth: 1, borderColor: S.ink }}>
          {([
            { key: "ALL", label: "All reworks" },
            { key: "QC", label: "Quality Check" },
            { key: "APPROVAL", label: "Approval" },
          ] as const).map((t, i) => {
            const on = filter === t.key;
            return (
              <Press
                key={t.key}
                onPress={() => setFilter(t.key)}
                style={(pressed) => ({ flex: 1, padding: 10, gap: 6, borderLeftWidth: i ? 1 : 0, borderLeftColor: S.ink, backgroundColor: on ? S.ink : pressed ? S.blueWash : "transparent" })}
              >
                <Label color={on ? S.paper : S.graphite}>{t.label}</Label>
                <Text style={{ fontSize: 22, fontFamily: fonts.heading.semibold, letterSpacing: -0.5, color: on ? S.paper : S.ink, fontVariant: ["tabular-nums"] }}>{counts[t.key]}</Text>
              </Press>
            );
          })}
        </View>

        <View>
          <RegisterHead title="Reworks" count={shown.length} unit={["rework", "reworks"]} />
          {q.isLoading ? (
            <View style={{ paddingTop: 12 }}><Skel h={110} /><Skel h={110} /></View>
          ) : q.error ? (
            <View style={{ paddingTop: 12 }}><Notice>{(q.error as Error).message}</Notice></View>
          ) : shown.length === 0 ? (
            <Body size={13} color={S.graphite} style={{ paddingVertical: 20 }}>{rows.length === 0 ? "No activity has ever been sent back for rework." : "No amendments match your search."}</Body>
          ) : (
            shown.map((r) => <AmendmentRow key={r.assignmentId} r={r} onOpen={() => navigation.navigate("ActivityDetail", { rungId: r.rungId })} />)
          )}
        </View>
      </SheetShell>
    </SheetPage>
  );
}
