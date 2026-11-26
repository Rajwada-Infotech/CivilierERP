// Resident: a visitor at the gate for their flat — the guard's photo, the reason, the gate, the visitor's name and
// vehicle — with Approve and Deny. The first resident to answer settles it; anyone after sees who already did.
import { useState } from "react";
import { View, Text, ScrollView, Platform } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Application from "expo-application";
import { Check, X } from "lucide-react-native";
import type { MainStackParamList } from "@/navigation/MainStack";
import { colors, sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { Body, Key, Label, Notice, SheetFrame, SheetMark, Skel } from "@/components/sheet/Sheet";
import { AuthImage } from "@/components/AuthImage";
import { decideVisitor, getVisitorForMe, residentPhotoUrl, type VisitorDetail } from "@/api/visitorsApi";
import { useVisitorEvents } from "@/visitors/useSecuritySocket";

const GREEN = "#1f9d55";
const flatOf = (block: string | null, flat: string) => (block ? `${block}-${flat}` : flat);
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "");

/** Something stable that names this phone in the decision record (Android id / iOS vendor id where available). */
async function deviceId(): Promise<string | undefined> {
  try {
    if (Platform.OS === "android") return Application.getAndroidId?.() ?? undefined;
    if (Platform.OS === "ios") return (await Application.getIosIdForVendorAsync?.()) ?? undefined;
  } catch {
    /* recorded without it */
  }
  return undefined;
}

export default function VisitorDecisionScreen() {
  const { params } = useRoute<RouteProp<MainStackParamList, "VisitorDecision">>();
  const qc = useQueryClient();
  const navigation = useNavigation();
  const [done, setDone] = useState<{ text: string; tone: "ok" | "no" | "info" } | null>(null);
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const { data: v, isLoading, error, refetch } = useQuery<VisitorDetail>({
    queryKey: ["security-visitor-mine", params.id],
    queryFn: () => getVisitorForMe(params.id),
    refetchInterval: (q) => (q.state.data?.status === "PENDING" ? 15000 : false),
  });

  // Another resident answered (or it timed out): show it at once.
  useVisitorEvents(true, (e) => e.requestId === params.id && void refetch());

  const decide = async (d: "approve" | "deny") => {
    setBusy(d);
    setFailed(null);
    try {
      const out = await decideVisitor(params.id, d, { deviceId: await deviceId(), platform: Platform.OS });
      void qc.invalidateQueries({ queryKey: ["security-dashboard"] });
      void qc.invalidateQueries({ queryKey: ["security-pending-mine"] });
      // Say what happened, then back to the dashboard.
      setDone(
        out.settled === false
          ? { text: `Already handled${out.decidedBy ? ` by ${out.decidedBy}` : ""}.`, tone: "info" }
          : d === "approve"
            ? { text: "Approved. The guard will let the visitor in.", tone: "ok" }
            : { text: "Denied. The guard won't let the visitor in.", tone: "no" },
      );
      setTimeout(() => (navigation as { navigate: (r: string) => void }).navigate("Dashboard"), 2200);
    } catch (e) {
      setFailed((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, padding: 16, gap: 10 }}>
        <Skel h={320} />
        <Skel h={44} />
      </View>
    );
  }
  if (error || !v) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, padding: 16 }}>
        <Notice>{(error as Error)?.message || "The visitor request could not be read."}</Notice>
      </View>
    );
  }

  const flat = flatOf(v.block, v.flat);
  const pending = v.status === "PENDING";

  if (done) {
    const bg = done.tone === "ok" ? GREEN : done.tone === "no" ? S.red : colors.muted;
    return (
      <View style={{ flex: 1, backgroundColor: bg, alignItems: "center", justifyContent: "center", padding: 24, gap: 14 }}>
        {done.tone === "no" ? <X size={72} color="#ffffff" strokeWidth={3} /> : <Check size={72} color="#ffffff" strokeWidth={3} />}
        <Text style={{ fontFamily: fonts.heading.bold, fontSize: 24, color: "#ffffff", textAlign: "center" }}>{done.text}</Text>
        <Text style={{ fontFamily: fonts.body.medium, fontSize: 13, color: "#ffffff" }}>Flat {flat} · back to the dashboard…</Text>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 96 }}>
      <SheetFrame>
        <View style={{ paddingHorizontal: 16, paddingTop: 18, paddingBottom: 14, gap: 6 }}>
          <Label>Flat {flat} · {v.gateName}</Label>
          <Text style={{ fontFamily: fonts.heading.bold, fontSize: 26, color: S.ink, letterSpacing: -0.6 }}>{pending ? "Visitor at the gate" : "Visitor request"}</Text>
          <Body size={12.5} color={S.graphite}>Asked at {time(v.requestedAt)}{v.guardName ? ` by ${v.guardName}` : ""}</Body>
        </View>

        {v.hasPhoto && <AuthImage url={residentPhotoUrl(v.id)} style={{ width: "100%", aspectRatio: 3 / 4, borderTopWidth: 1, borderTopColor: S.ink }} />}

        <View style={{ borderTopWidth: 1, borderTopColor: S.ink, padding: 16, gap: 6 }}>
          <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 18, color: S.ink }}>{v.visitorName || "Visitor"}</Text>
          <Body size={14} color={S.ink2}>{v.reason}</Body>
          {!!v.vehicleNo && <Body size={13} color={S.ink2}>Vehicle {v.vehicleNo}</Body>}
        </View>

        <View style={{ borderTopWidth: 1, borderTopColor: S.rule, padding: 16, gap: 10 }}>
          {failed && <Notice>{failed}</Notice>}
          {note && <Notice tone="ink">{note}</Notice>}
          {pending ? (
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Key
                tone="red"
                label={busy === "deny" ? "Denying…" : "Deny"}
                icon={<X size={16} color="#ffffff" />}
                onPress={() => decide("deny")}
                disabled={!!busy}
                style={{ flex: 1, minHeight: 56 }}
              />
              <Key
                tone="ink"
                onPress={() => decide("approve")}
                disabled={!!busy}
                style={{ flex: 1, minHeight: 56, backgroundColor: GREEN, borderColor: GREEN }}
                icon={<Check size={16} color="#ffffff" />}
              >
                <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 12, letterSpacing: 1.1, textTransform: "uppercase", color: "#ffffff" }}>{busy === "approve" ? "Approving…" : "Approve"}</Text>
              </Key>
            </View>
          ) : (
            <View style={{ gap: 6 }}>
              <SheetMark
                text={v.status === "APPROVED" ? "Approved" : v.status === "DENIED" ? "Denied" : "No response"}
                tone={v.status === "APPROVED" ? "done" : v.status === "DENIED" ? "stopped" : "draft"}
              />
              <Body size={13} color={S.ink2}>
                {v.status === "NO_RESPONSE"
                  ? "Nobody answered in time, so the guard handled it at the gate."
                  : `${v.decidedBy || "A resident"} answered at ${time(v.decidedAt)}.`}
              </Body>
            </View>
          )}
        </View>

        {(v.decisions ?? []).length > 1 && (
          <View style={{ borderTopWidth: 1, borderTopColor: S.rule, padding: 16, gap: 6 }}>
            <Label>Answers</Label>
            {v.decisions!.map((d, i) => (
              <Body key={i} size={12.5} color={d.settled ? S.ink : S.graphite}>
                {time(d.at)} · {d.name || "Resident"} · {d.decision === "APPROVE" ? "Approve" : "Deny"}{d.settled ? "" : " (after it was handled)"}
              </Body>
            ))}
          </View>
        )}
      </SheetFrame>
    </ScrollView>
  );
}
