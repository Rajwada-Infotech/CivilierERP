// Menu → Complaints (security admin): residents' complaints about guards, open first. Move one on — looking into it,
// resolved or closed — with a note the resident sees in their app.
import { useState } from "react";
import { View, Text, ScrollView, RefreshControl, Linking } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { colors, sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { Body, Input, Key, Label, LinkLabel, Notice, Seg, SheetFrame, SheetMark, Skel, TitleBlock } from "@/components/sheet/Sheet";
import { allComplaints, reviewComplaint, type Complaint, type ComplaintStatus } from "@/api/securityMoreApi";
import { COMPLAINT_STATUS } from "./ComplaintsScreen";
import { useSocketEvent } from "@/visitors/useSecuritySocket";

const flatOf = (b: string | null, f: string) => (b ? `${b}-${f}` : f);
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

function ComplaintCard({ c, onDone }: { c: Complaint; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(c.adminNote ?? "");
  const [busy, setBusy] = useState<ComplaintStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = async (status: ComplaintStatus) => {
    setBusy(status);
    setError(null);
    try {
      await reviewComplaint(c.id, status, note.trim());
      setOpen(false);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const closed = c.status === "RESOLVED" || c.status === "DISMISSED";
  return (
    <View style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: S.ruleSoft, gap: 4 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
        <Text style={{ flex: 1, fontFamily: fonts.body.semibold, fontSize: 14, color: closed ? S.ink2 : S.red }}>{c.categoryLabel}</Text>
        <SheetMark text={COMPLAINT_STATUS[c.status].text} tone={COMPLAINT_STATUS[c.status].tone} />
      </View>
      <Body size={12.5} color={S.ink}>Guard: {c.guardName ?? "not named"}{c.gateName ? ` · ${c.gateName}` : ""}</Body>
      <Body size={12} color={S.graphite}>
        {[c.residentName, `flat ${flatOf(c.block, c.flat)}`, c.projectName, when(c.createdAt)].filter(Boolean).join(" · ")}
      </Body>
      <Body size={13} color={S.ink2}>{c.description}</Body>
      {!!c.adminNote && !open && (
        <View style={{ marginTop: 4, borderLeftWidth: 2, borderLeftColor: S.blue, paddingLeft: 10 }}>
          <Label>Note{c.handledBy ? ` · ${c.handledBy}` : ""}</Label>
          <Body size={13}>{c.adminNote}</Body>
        </View>
      )}
      <View style={{ flexDirection: "row", gap: 16, marginTop: 4 }}>
        <LinkLabel onPress={() => setOpen(!open)} color={S.blue}>{open ? "Cancel" : closed ? "Reopen / edit" : "Review"}</LinkLabel>
        {!!c.residentMobile && <LinkLabel onPress={() => void Linking.openURL(`tel:${c.residentMobile}`)} color={S.blue}>Call resident</LinkLabel>}
      </View>
      {open && (
        <View style={{ gap: 8, marginTop: 6 }}>
          <Input value={note} onChangeText={setNote} placeholder="Note for the resident (what was done)" multiline style={{ minHeight: 72, textAlignVertical: "top", paddingTop: 10 }} maxLength={1000} />
          {error && <Notice>{error}</Notice>}
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {c.status !== "IN_REVIEW" && <Key label={busy === "IN_REVIEW" ? "…" : "Looking into it"} onPress={() => void set("IN_REVIEW")} disabled={!!busy} />}
            <Key tone="ink" label={busy === "RESOLVED" ? "…" : "Resolved"} onPress={() => void set("RESOLVED")} disabled={!!busy} />
            <Key label={busy === "DISMISSED" ? "…" : "Close without action"} onPress={() => void set("DISMISSED")} disabled={!!busy} />
          </View>
        </View>
      )}
    </View>
  );
}

export default function AdminComplaintsScreen() {
  const qc = useQueryClient();
  const [which, setWhich] = useState<"open" | "all">("open");
  const [refreshing, setRefreshing] = useState(false);
  const { data = [], isLoading, error, refetch } = useQuery({ queryKey: ["security-complaints-admin"], queryFn: () => allComplaints(), refetchInterval: 60000 });
  useSocketEvent("security:complaint", true, () => void refetch());
  const rows = which === "open" ? data.filter((c) => c.status === "OPEN" || c.status === "IN_REVIEW") : data;
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingBottom: 96 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={S.ink} onRefresh={async () => { setRefreshing(true); await refetch(); setRefreshing(false); }} />}
    >
      <SheetFrame>
        <TitleBlock eyebrow="Civilier Security · Admin" title="Complaints" subtitle="Residents' complaints about guards" />
        <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
          <Seg options={[{ value: "open", label: "Open" }, { value: "all", label: "All" }]} value={which} onChange={setWhich} />
        </View>
        {error && (
          <View style={{ padding: 16 }}>
            <Notice>{(error as Error).message}</Notice>
          </View>
        )}
        <View style={{ borderTopWidth: 1, borderTopColor: S.ink, paddingHorizontal: 16 }}>
          {isLoading ? (
            <View style={{ paddingVertical: 14 }}><Skel h={60} /></View>
          ) : rows.length === 0 ? (
            <Body color={S.ink2} style={{ paddingVertical: 18 }}>{which === "open" ? "No open complaints." : "No complaints yet."}</Body>
          ) : (
            rows.map((c) => <ComplaintCard key={c.id} c={c} onDone={() => { void refetch(); void qc.invalidateQueries({ queryKey: ["security-open-complaints"] }); }} />)
          )}
        </View>
      </SheetFrame>
    </ScrollView>
  );
}
