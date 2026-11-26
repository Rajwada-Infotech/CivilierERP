// Menu → Complain about a guard (resident). Say what happened — which guard (or "not sure"), which gate, optionally
// which visitor request it was about — and the security admins review it. Your complaints and their answers are below.
import { useMemo, useState } from "react";
import { View, Text, ScrollView, RefreshControl, Alert } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { colors, sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { Body, Detail, Field, Input, Key, Label, Notice, Press, Seg, SheetFrame, SheetMark, Skel, TitleBlock, type MarkTone } from "@/components/sheet/Sheet";
import { complaintOptions, myComplaints, raiseComplaint, type ComplaintStatus } from "@/api/securityMoreApi";
import { useSocketEvent } from "@/visitors/useSecuritySocket";

const flatOf = (b: string | null, f: string) => (b ? `${b}-${f}` : f);
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
export const COMPLAINT_STATUS: Record<ComplaintStatus, { text: string; tone: MarkTone }> = {
  OPEN: { text: "Received", tone: "waiting" },
  IN_REVIEW: { text: "Being looked into", tone: "moving" },
  RESOLVED: { text: "Resolved", tone: "done" },
  DISMISSED: { text: "Closed", tone: "draft" },
};

/** A row of tappable choices (one can be picked; tap again to clear). */
function Choices<T extends string | number>({ items, value, onChange, allowNone }: { items: { value: T; label: string }[]; value: T | null; onChange: (v: T | null) => void; allowNone?: boolean }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {items.map((it) => {
        const on = value === it.value;
        return (
          <Press
            key={String(it.value)}
            onPress={() => onChange(on && allowNone ? null : it.value)}
            style={(p) => ({ paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderColor: S.ink, backgroundColor: on ? S.ink : p ? S.blueWash : "transparent" })}
          >
            <Text style={{ fontFamily: fonts.body.semibold, fontSize: 13, color: on ? S.paper : S.ink }}>{it.label}</Text>
          </Press>
        );
      })}
    </View>
  );
}

export default function ComplaintsScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const { data: opts, isLoading: loadingOpts } = useQuery({ queryKey: ["security-complaint-options"], queryFn: complaintOptions });
  const { data: mine = [], isLoading, refetch } = useQuery({ queryKey: ["security-my-complaints"], queryFn: myComplaints });
  useSocketEvent<{ complaintId: number }>("security:complaint", true, () => void refetch());

  const [residentId, setResidentId] = useState<number | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [guardId, setGuardId] = useState<number | null>(null);
  const [gateId, setGateId] = useState<number | null>(null);
  const [visitId, setVisitId] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const flats = opts?.flats ?? [];
  const flat = residentId ?? flats[0]?.residentId ?? null;
  const categories = useMemo(() => Object.entries(opts?.categories ?? {}).map(([value, label]) => ({ value, label })), [opts]);

  const submit = async () => {
    if (!flat) return setError("You have no flat registered for the Security app.");
    if (!category) return setError("Choose what the complaint is about.");
    if (text.trim().length < 10) return setError("Describe what happened (at least a sentence).");
    setError(null);
    setBusy(true);
    try {
      await raiseComplaint({ residentId: flat, category, description: text.trim(), guardUserId: guardId, gateId, requestId: visitId });
      setCategory(null);
      setGuardId(null);
      setGateId(null);
      setVisitId(null);
      setText("");
      await refetch();
      Alert.alert("Complaint sent", "The security team will look into it. You'll see their answer here.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingBottom: 96 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={S.ink} onRefresh={async () => { setRefreshing(true); await refetch(); setRefreshing(false); }} />}
    >
      <SheetFrame>
        <TitleBlock eyebrow="Civilier Security" title="Complain about a guard" subtitle="The security team reviews every complaint" />
        <Detail tag="A" title="New complaint">
          {loadingOpts ? (
            <Skel h={60} />
          ) : !flats.length ? (
            <Body color={S.graphite}>You have no flat registered for the Security app yet.</Body>
          ) : (
            <View style={{ gap: 14 }}>
              {flats.length > 1 && (
                <Field label="Flat">
                  <Seg options={flats.map((f) => ({ value: String(f.residentId), label: flatOf(f.block, f.flat) }))} value={String(flat ?? "")} onChange={(v) => setResidentId(Number(v))} />
                </Field>
              )}
              <Field label="What happened" required>
                <Choices items={categories} value={category} onChange={setCategory} />
              </Field>
              <Field label="Which guard">
                <Choices items={[...(opts?.guards ?? []).map((g) => ({ value: g.id, label: g.name })), { value: 0, label: "Not sure" }]} value={guardId ?? 0} onChange={(v) => setGuardId(v ? Number(v) : null)} />
              </Field>
              {(opts?.gates.length ?? 0) > 1 && (
                <Field label="Which gate">
                  <Choices items={(opts?.gates ?? []).map((g) => ({ value: g.id, label: g.name }))} value={gateId} onChange={setGateId} allowNone />
                </Field>
              )}
              {(opts?.visits.length ?? 0) > 0 && (
                <Field label="About a visitor (optional)">
                  <Choices
                    items={(opts?.visits ?? []).slice(0, 6).map((v) => ({ value: v.id, label: `${v.visitorName || "Visitor"} · ${new Date(v.requestedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}` }))}
                    value={visitId}
                    onChange={setVisitId}
                    allowNone
                  />
                </Field>
              )}
              <Field label="Describe it" required>
                <Input value={text} onChangeText={setText} placeholder="What happened, and when" multiline style={{ minHeight: 96, textAlignVertical: "top", paddingTop: 10 }} maxLength={1000} />
              </Field>
              {error && <Notice>{error}</Notice>}
              <Key tone="ink" label={busy ? "Sending…" : "Send complaint"} onPress={submit} disabled={busy} />
            </View>
          )}
        </Detail>

        <Detail tag="B" title="Your complaints" note={mine.length ? `${mine.length}` : undefined}>
          {isLoading ? (
            <Skel h={44} />
          ) : mine.length === 0 ? (
            <Body color={S.graphite}>You haven't raised any complaint.</Body>
          ) : (
            mine.map((c, i) => (
              <View key={c.id} style={{ paddingVertical: 12, borderBottomWidth: i === mine.length - 1 ? 0 : 1, borderBottomColor: S.ruleSoft, gap: 4 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                  <Text style={{ flex: 1, fontFamily: fonts.body.semibold, fontSize: 14, color: S.ink }}>{c.categoryLabel}</Text>
                  <SheetMark text={COMPLAINT_STATUS[c.status].text} tone={COMPLAINT_STATUS[c.status].tone} />
                </View>
                <Body size={12} color={S.graphite}>{[c.guardName ?? "Guard not named", c.gateName, `flat ${flatOf(c.block, c.flat)}`, when(c.createdAt)].filter(Boolean).join(" · ")}</Body>
                <Body size={13} color={S.ink2}>{c.description}</Body>
                {!!c.adminNote && (
                  <View style={{ marginTop: 4, borderLeftWidth: 2, borderLeftColor: S.blue, paddingLeft: 10 }}>
                    <Label>Security team{c.handledBy ? ` · ${c.handledBy}` : ""}</Label>
                    <Body size={13}>{c.adminNote}</Body>
                  </View>
                )}
              </View>
            ))
          )}
        </Detail>
      </SheetFrame>
    </ScrollView>
  );
}
