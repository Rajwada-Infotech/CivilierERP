// Face registration: the employee takes 3 front-camera photos with consent. The server checks each photo, builds an
// encrypted face template and sends it to HR; once HR approves it in Employee Master, punches verify the face.
import { useState } from "react";
import { ActivityIndicator, Image, Pressable, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, ScanFace, X } from "lucide-react-native";
import { api } from "@/api/employeeApi";
import { CameraCapture } from "@/components/CameraCapture";
import { Screen } from "@/components/Screen";
import { Chip } from "@/components/Chip";
import { Body, Key, Label, Notice, Panel, Skel } from "@/components/sheet/Sheet";
import { sheet as S } from "@/theme/colors";
import { fmtDate } from "@/utils/format";

const NEED = 3;

export default function FaceRegistrationScreen() {
  const qc = useQueryClient();
  const st = useQuery({ queryKey: ["face"], queryFn: api.face });
  const [consent, setConsent] = useState(false);
  const [shots, setShots] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: () => api.faceEnroll(shots),
    onSuccess: (r) => { setOk(r.message); setShots([]); setConsent(false); qc.invalidateQueries({ queryKey: ["face"] }); },
    onError: (e: Error) => setErr(e.message),
  });
  const [camOpen, setCamOpen] = useState(false);
  const take = () => { setErr(null); setCamOpen(true); };
  const d = st.data;
  const tone = d?.state === "Active" ? "ok" : d?.state === "Pending" ? "warn" : d?.state === "Rejected" ? "bad" : "info";
  const label = { None: "Not registered", Pending: "Waiting for HR approval", Active: "Active", Rejected: "Rejected by HR", Revoked: "Removed by HR" } as const;

  return (
    <Screen refreshing={st.isRefetching} onRefresh={() => st.refetch()}>
      <Panel title="Face registration" icon={<ScanFace size={14} color={S.ink} />}>
        {st.isLoading ? <Skel h={40} /> : st.isError ? <Notice>{(st.error as Error).message}</Notice> : d && (
          <>
            <View style={{ flexDirection: "row" }}><Chip text={d.exempt ? "Face check exempted by HR" : label[d.state]} tone={d.exempt ? "info" : tone} /></View>
            {d.state === "Active" && d.activeSince && <Body size={12} color={S.graphite}>Registered on {fmtDate(d.activeSince)}. Your punches are verified with this face.</Body>}
            {d.state === "Pending" && d.pendingSince && <Body size={12} color={S.graphite}>Sent on {fmtDate(d.pendingSince)}. You can punch with your face once HR approves it.</Body>}
            {d.state === "Rejected" && d.rejectReason && <Notice>HR: {d.rejectReason}</Notice>}
            {!d.configured && <Notice>Face verification isn't set up on the server yet. Contact HR.</Notice>}
          </>
        )}
      </Panel>

      {ok && <Notice tone="ink">{ok}</Notice>}

      {d && d.configured && !d.exempt && (
        <Panel title={d.state === "Active" ? "Register again" : d.state === "Pending" ? "Send new photos" : "Register your face"}>
          <Body size={12.5}>Your face is used <Body size={12.5} weight="semibold">only to check your own attendance punches</Body>. The photos are not kept — only an encrypted face template. HR approves it, and can remove it any time.</Body>
          <Body size={12} color={S.graphite}>Good light · look straight at the camera · nobody else in the picture · no mask or dark glasses. Take {NEED} photos.</Body>
          <Key label={consent ? "✓ I agree to face registration" : "I agree to face registration"} tone={consent ? "ink" : undefined} onPress={() => setConsent((c) => !c)} />
          {consent && (
            <>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                {shots.map((p, i) => (
                  <View key={i}>
                    <Image source={{ uri: p }} style={{ width: 72, height: 72, borderWidth: 1, borderColor: S.rule }} />
                    <Pressable onPress={() => setShots((s) => s.filter((_, j) => j !== i))} hitSlop={8} accessibilityLabel={`Remove photo ${i + 1}`}
                      style={{ position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: S.paper, borderWidth: 1, borderColor: S.ink, alignItems: "center", justifyContent: "center" }}>
                      <X size={12} color={S.ink} />
                    </Pressable>
                  </View>
                ))}
              </View>
              {err && <Notice>{err}</Notice>}
              {send.isPending ? (
                <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}><ActivityIndicator color={S.ink} /><Body>Checking your photos…</Body></View>
              ) : shots.length < NEED ? (
                <Key tone="ink" label={`Take photo ${shots.length + 1} of ${NEED}`} icon={<Camera size={16} color={S.paper} />} onPress={take} />
              ) : (
                <Key tone="ink" label="Send to HR for approval" icon={<ScanFace size={16} color={S.paper} />} onPress={() => { setErr(null); send.mutate(); }} />
              )}
              <Label>{shots.length}/{NEED} photos</Label>
            </>
          )}
        </Panel>
      )}
      <CameraCapture open={camOpen} title={`Photo ${Math.min(shots.length + 1, NEED)} of ${NEED}`}
        hint="Face inside the oval, look straight, good light, nobody else in the picture."
        onClose={() => setCamOpen(false)}
        onPhoto={(p) => { setShots((s) => { const next = [...s, p]; if (next.length >= NEED) setCamOpen(false); return next; }); }} />
    </Screen>
  );
}
