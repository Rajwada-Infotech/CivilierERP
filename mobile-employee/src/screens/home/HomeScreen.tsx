// Home: today's punch card. In / Out need a live photo and the device location (the backend refuses them otherwise);
// every time is the server's clock. Break start asks for a reason from the break rules HR set.
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, Modal, Pressable, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import { Coffee, LogIn, LogOut, MapPin, Play } from "lucide-react-native";
import { api, type BreakType, type TodayState } from "@/api/employeeApi";
import { currentPosition, EvidenceError } from "@/services/evidence";
import { CameraCapture } from "@/components/CameraCapture";
import { Screen } from "@/components/Screen";
import { Chip } from "@/components/Chip";
import { Body, Field, Input, Key, Label, Notice, Panel, SheetFrame, Skel, StatGrid, TitleText } from "@/components/sheet/Sheet";
import { sheet as S } from "@/theme/colors";
import HomeDashboard from "./HomeDashboard";
import NoticesPanel from "./NoticesPanel";
import { fonts } from "@/theme/fonts";
import { clock, fmtDate, fmtDur, fmtTime } from "@/utils/format";

const STATE_LABEL = { NOT_STARTED: "Not punched in", WORKING: "Working", ON_BREAK: "On break", COMPLETED: "Day complete" } as const;

/** Seconds since the server's reading, ticking every second. */
function useTicker(base: number | null | undefined, serverNow: string | undefined, running: boolean) {
  const [, setT] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setT((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [running]);
  if (base == null || !serverNow) return null;
  return running ? base + (Date.now() - new Date(serverNow).getTime()) / 1000 : base;
}

function BreakPicker({ open, types, onClose, onPick }: { open: boolean; types: BreakType[]; onClose: () => void; onPick: (t: string, note: string) => void }) {
  const [type, setType] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const rule = types.find((t) => t.type === type);
  useEffect(() => { if (open) { setType(types[0]?.type ?? null); setNote(""); } }, [open, types]);
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "#00000088", justifyContent: "flex-end" }}>
        <Pressable onPress={() => {}} style={{ backgroundColor: S.paper, padding: 16, gap: 14, borderTopWidth: 1, borderColor: S.ink }}>
          <Label color={S.ink}>Start a break</Label>
          {types.map((t) => (
            <Pressable key={t.type} onPress={() => setType(t.type)}
              style={{ borderWidth: 1, borderColor: type === t.type ? S.ink : S.rule, backgroundColor: type === t.type ? S.blueWash : "transparent", padding: 12, gap: 2 }}>
              <Body weight="semibold">{t.type}</Body>
              <Body size={11.5} color={S.graphite}>
                {t.allowedMinutes != null ? `${t.allowedMinutes} min allowed` : "No time limit"} · {t.deduct ? "taken off working time" : "counts as work"}
              </Body>
            </Pressable>
          ))}
          {rule?.requiresNote && (
            <Field label="Reason" required>
              <Input value={note} onChangeText={setNote} placeholder="Why are you taking this break?" maxLength={300} />
            </Field>
          )}
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Key label="Cancel" onPress={onClose} style={{ flex: 1 }} />
            <Key tone="ink" label="Start break" disabled={!type || (!!rule?.requiresNote && note.trim().length < 3)} onPress={() => type && onPick(type, note.trim())} style={{ flex: 1 }} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function HomeScreen() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, staleTime: 10 * 60_000 });
  const today = useQuery({ queryKey: ["today"], queryFn: api.today, refetchInterval: 60_000 });
  const types = useQuery({ queryKey: ["break-types"], queryFn: api.breakTypes, staleTime: 10 * 60_000 });
  const face = useQuery({ queryKey: ["face"], queryFn: api.face, staleTime: 60_000 });
  const nav = useNavigation<{ navigate: (name: string) => void }>();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);

  const done = (s: TodayState) => { qc.setQueryData(["today"], s); qc.invalidateQueries({ queryKey: ["month"] }); setError(null); };
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : "Something went wrong");

  // Punch: location first (a GPS problem shows before the camera), then the in-app camera, then send.
  const [camFor, setCamFor] = useState<"in" | "out" | null>(null);
  const [pos, setPos] = useState<Awaited<ReturnType<typeof currentPosition>> | null>(null);
  const punch = async (kind: "in" | "out") => {
    setError(null);
    setBusy("Getting your location…");
    try {
      setPos(await currentPosition());
      setCamFor(kind);
    } catch (e) {
      fail(e instanceof EvidenceError ? e : e);
    } finally {
      setBusy(null);
    }
  };
  const sendPunch = async (photo: string) => {
    const kind = camFor;
    setCamFor(null);
    if (!kind || !pos) return;
    setBusy(kind === "in" ? "Verifying face and location…" : "Verifying face and location…");
    try {
      const ev = { photo, ...pos };
      done(kind === "in" ? await api.punchIn(ev) : await api.punchOut(ev));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  const breakStart = useMutation({ mutationFn: (v: { t: string; n: string }) => api.breakStart(v.t, v.n), onSuccess: done, onError: fail });
  const breakStop = useMutation({ mutationFn: api.breakStop, onSuccess: done, onError: fail });

  const d = today.data;
  const cur = d?.current ?? null;
  const running = d?.state === "WORKING" || d?.state === "ON_BREAK";
  const net = useTicker(cur?.live?.netSeconds ?? cur?.netSeconds, d?.serverNow, d?.state === "WORKING");
  const openBreak = cur?.breaks.find((b) => b.open);
  const breakNow = useTicker(openBreak ? (new Date(d!.serverNow).getTime() - new Date(openBreak.start).getTime()) / 1000 : null, d?.serverNow, d?.state === "ON_BREAK");

  const confirmOut = () =>
    Alert.alert("Punch out?", "Your day ends now. Out can be recorded only once.", [
      { text: "Cancel", style: "cancel" },
      { text: "Punch out", style: "destructive", onPress: () => punch("out") },
    ]);

  return (
    <Screen refreshing={today.isRefetching} onRefresh={() => { today.refetch(); me.refetch(); }}>
      <SheetFrame>
        <View style={{ padding: 16, flexDirection: "row", alignItems: "center", gap: 12 }}>
          {me.data?.Photo ? (
            <Image source={{ uri: me.data.Photo.startsWith("data:") ? me.data.Photo : `data:image/jpeg;base64,${me.data.Photo}` }} style={{ width: 48, height: 48, borderRadius: 24 }} />
          ) : (
            <View style={{ width: 48, height: 48, borderRadius: 24, borderWidth: 1, borderColor: S.ink, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: S.ink, fontFamily: fonts.heading.semibold }}>{(me.data?.EmployeeName ?? "?").slice(0, 1)}</Text>
            </View>
          )}
          <View style={{ flex: 1, gap: 2 }}>
            <Label>{d ? fmtDate(d.today) : "Today"}</Label>
            <TitleText size={20}>{me.data?.EmployeeName ?? d?.employee.name ?? "…"}</TitleText>
            <Body size={12} color={S.graphite}>{[me.data?.Designation, me.data?.Department].filter(Boolean).join(" · ") || me.data?.EmployeeCode || ""}</Body>
          </View>
        </View>
      </SheetFrame>

      {face.data && face.data.required && !face.data.exempt && face.data.state !== "Active" && (
        <Pressable onPress={() => nav.navigate("FaceRegistration")}>
          <Notice tone={face.data.state === "Pending" ? "ink" : "red"}>
            {face.data.state === "Pending" ? "Your face registration is waiting for HR approval. Punches need it approved." : "Register your face to punch In / Out — tap here."}
          </Notice>
        </Pressable>
      )}

      <NoticesPanel />

      <Panel title="Today's attendance" icon={<MapPin size={14} color={S.ink} />}>
        {today.isLoading ? (
          <><Skel h={40} /><Skel h={44} /></>
        ) : today.isError ? (
          <Notice>{(today.error as Error).message}</Notice>
        ) : d ? (
          <>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Chip text={STATE_LABEL[d.state]} tone={d.state === "COMPLETED" ? "ok" : d.state === "NOT_STARTED" ? "info" : "warn"} />
              {cur?.flags?.length ? <Chip text="Incomplete" tone="bad" /> : null}
            </View>
            <View style={{ alignItems: "center", paddingVertical: 6 }}>
              <Label>{d.state === "ON_BREAK" ? `On ${openBreak?.type ?? "break"}` : "Net working time"}</Label>
              <Text style={{ color: d.state === "ON_BREAK" ? S.red : S.ink, fontFamily: fonts.heading.semibold, fontSize: 40, fontVariant: ["tabular-nums"], marginTop: 6 }}>
                {d.state === "ON_BREAK" ? clock(breakNow ?? 0) : net != null ? clock(net) : "00:00:00"}
              </Text>
              {d.state === "ON_BREAK" && openBreak?.type && (
                <Body size={11.5} color={S.graphite}>
                  {openBreak.allowedSeconds != null ? `${fmtDur(openBreak.allowedSeconds)} allowed · ` : "No limit · "}Working time paused at {fmtDur(cur?.live?.netSeconds)}
                </Body>
              )}
              {d.state === "ON_BREAK" && openBreak?.allowedSeconds != null && (breakNow ?? 0) > openBreak.allowedSeconds && (
                <Chip text={`Break over time +${fmtDur((breakNow ?? 0) - openBreak.allowedSeconds)}`} tone="bad" />
              )}
            </View>
            <StatGrid cols={3} size={15} items={[
              { label: "In", value: fmtTime(cur?.inTime) },
              { label: "Out", value: fmtTime(cur?.outTime) },
              { label: "Breaks", value: fmtDur(cur?.live?.breakSeconds ?? cur?.breakSeconds ?? 0) },
            ]} />
            {cur && (
              <Body size={11.5} color={S.graphite}>
                Official out {fmtDur(cur.officialSeconds)} · Extra <Body size={11.5} color={cur.extraSeconds > 0 ? S.red : S.graphite}>{fmtDur(cur.extraSeconds)}</Body>
              </Body>
            )}
            {cur?.inLocation && (
              <Body size={11} color={S.graphite}>
                In location recorded ({cur.inLocation.lat.toFixed(5)}, {cur.inLocation.lng.toFixed(5)}{cur.inLocation.accuracyM != null ? ` · ±${cur.inLocation.accuracyM} m` : ""})
              </Body>
            )}
            {error && <Notice>{error}</Notice>}
            {busy ? (
              <View style={{ flexDirection: "row", gap: 10, alignItems: "center", justifyContent: "center", minHeight: 44 }}>
                <ActivityIndicator color={S.ink} /><Body>{busy}</Body>
              </View>
            ) : (
              <View style={{ gap: 10 }}>
                {d.allowed.in && <Key tone="ink" label="Punch In" icon={<LogIn size={16} color={S.paper} />} onPress={() => punch("in")} />}
                {d.allowed.breakStart && <Key label="Start break" icon={<Coffee size={16} color={S.ink} />} onPress={() => setPicker(true)} disabled={breakStart.isPending} />}
                {d.allowed.breakStop && <Key tone="ink" label="End break" icon={<Play size={16} color={S.paper} />} onPress={() => breakStop.mutate()} disabled={breakStop.isPending} />}
                {d.allowed.out && <Key tone="red" label="Punch Out" icon={<LogOut size={16} color="#ffffff" />} onPress={confirmOut} />}
                {d.state === "ON_BREAK" && <Body size={11.5} color={S.graphite}>End the break before punching out.</Body>}
                {d.state === "COMPLETED" && <Body size={12} color={S.graphite}>Today's attendance is complete. Worked {fmtDur(cur?.netSeconds)}.</Body>}
              </View>
            )}
            {!running && d.state === "NOT_STARTED" && (
              <Body size={11} color={S.graphite}>Punch In takes a live photo and your current location.</Body>
            )}
          </>
        ) : null}
      </Panel>

      {!!cur?.breaks.length && (
        <Panel title={`Breaks today · ${cur.breaks.length}`} icon={<Coffee size={14} color={S.ink} />}>
          {cur.breaks.map((b) => (
            <View key={b.breakId} style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Body weight="semibold">{b.type}{b.note ? ` · ${b.note}` : ""}</Body>
                <Body size={11.5} color={S.graphite}>{fmtTime(b.start)} – {b.open ? "running" : fmtTime(b.end)}</Body>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Body>{b.open ? "…" : fmtDur(b.seconds)}</Body>
                {b.overSeconds > 0 && <Body size={11} color={S.red}>+{fmtDur(b.overSeconds)} extra</Body>}
              </View>
            </View>
          ))}
        </Panel>
      )}

      <HomeDashboard />

      <CameraCapture open={!!camFor} title={camFor === "in" ? "Punch In" : "Punch Out"} hint="Look straight at the camera — your face is checked against your registered face."
        onClose={() => setCamFor(null)} onPhoto={sendPunch} />

      <BreakPicker open={picker} types={types.data ?? []} onClose={() => setPicker(false)}
        onPick={(t, n) => { setPicker(false); breakStart.mutate({ t, n }); }} />
    </Screen>
  );
}
