// A voice call between a resident and the gate (doc phase 4), through LiveKit. Outgoing: rings the other side and
// joins the call's room straight away. Incoming: Answer / Decline. During the call: mute, speaker and end.
// LiveKit's native audio isn't inside Expo Go; there the screen says so and offers the phone dialler instead.
import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Linking, Animated, Easing, NativeModules } from "react-native";
import { isRunningInExpoGo } from "expo";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { Mic, MicOff, Phone, PhoneOff, Volume2, Ear } from "lucide-react-native";
import type { MainStackParamList } from "@/navigation/MainStack";
import { colors, sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { Body, Label, Notice, Press, motionOff } from "@/components/sheet/Sheet";
import { useSecurityView } from "@/navigation/securityRole";
import { callAction, getCall, type CallInfo } from "@/api/securityMoreApi";
import { useSocketEvent } from "@/visitors/useSecuritySocket";

const GREEN = "#1f9d55";

type LiveKit = { Room: any; RoomEvent: any; AudioSession: any };
/** LiveKit, loaded only when a call opens (its native module is missing in Expo Go: then null). */
function loadLiveKit(): LiveKit | null {
  // Expo Go has no WebRTC native module: LiveKit loads there but every call fails with "WebRTC native module not
  // found". Check first, so the person gets a clear message and the phone option instead.
  if (isRunningInExpoGo() || !NativeModules.WebRTCModule) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rn = require("@livekit/react-native");
    rn.registerGlobals();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const client = require("livekit-client");
    return { Room: client.Room, RoomEvent: client.RoomEvent, AudioSession: rn.AudioSession };
  } catch {
    return null;
  }
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function RoundKey({ onPress, bg, children, label, disabled }: { onPress: () => void; bg: string; children: React.ReactNode; label: string; disabled?: boolean }) {
  return (
    <View style={{ alignItems: "center", gap: 6 }}>
      <Press onPress={onPress} disabled={disabled} style={(p) => ({ width: 68, height: 68, borderRadius: 34, backgroundColor: bg, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.4 : p ? 0.8 : 1 })}>
        {children}
      </Press>
      <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 10, letterSpacing: 1, color: S.ink2, textTransform: "uppercase" }}>{label}</Text>
    </View>
  );
}

export default function CallScreen() {
  const { params } = useRoute<RouteProp<MainStackParamList, "Call">>();
  const navigation = useNavigation();
  const { view } = useSecurityView();
  const [call, setCall] = useState<CallInfo | null>(params.call ?? null);
  const [joined, setJoined] = useState(false);
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const room = useRef<any>(null);
  const lk = useRef<LiveKit | null | undefined>(undefined);
  const closing = useRef(false);
  const pulse = useRef(new Animated.Value(0)).current;

  const status = call?.status ?? "RINGING";
  const over = ["MISSED", "DECLINED", "ENDED", "FAILED"].includes(status);
  const incoming = params.incoming && !joined;

  const leave = useCallback(async () => {
    try {
      await room.current?.disconnect();
    } catch {
      /* already gone */
    }
    room.current = null;
    try {
      await lk.current?.AudioSession?.stopAudioSession();
    } catch {
      /* not started */
    }
  }, []);

  const join = useCallback(async (url?: string, token?: string) => {
    if (!url || !token) return;
    if (lk.current === undefined) lk.current = loadLiveKit();
    if (!lk.current) {
      setError("In-app calls need the installed Civilier Security app — they can't run inside Expo Go. Use the phone for now.");
      return;
    }
    try {
      await lk.current.AudioSession?.startAudioSession();
      const r = new lk.current.Room({ adaptiveStream: false, dynacast: false });
      r.on(lk.current.RoomEvent.Disconnected, () => setJoined(false));
      await r.connect(url, token, { autoSubscribe: true });
      await r.localParticipant.setMicrophoneEnabled(true);
      room.current = r;
      setJoined(true);
    } catch (e) {
      setError(`Couldn't connect the call: ${(e as Error).message}`);
    }
  }, []);

  // Outgoing: join the room at once (the other side joins when they answer).
  useEffect(() => {
    if (!params.incoming && params.call?.token) void join(params.call.url, params.call.token);
    return () => {
      void leave();
    };
  }, [join, leave, params.incoming, params.call]);

  // Follow the call: the socket, and every 2 s in case it's down.
  const refresh = useCallback(async () => {
    try {
      setCall((c) => c ?? null);
      const latest = await getCall(view, params.callId);
      setCall((c) => ({ ...(c ?? {}), ...latest }));
    } catch {
      /* next tick */
    }
  }, [view, params.callId]);
  useSocketEvent<{ callId: number }>("security:call", !!view, (e) => e.callId === params.callId && void refresh());
  useEffect(() => {
    void refresh();
    const t = setInterval(() => {
      setNow(Date.now());
      if (!over) void refresh();
    }, 2000);
    return () => clearInterval(t);
  }, [refresh, over]);

  // The call ended (either side, or nobody answered): leave and close.
  useEffect(() => {
    if (!over || closing.current) return;
    closing.current = true;
    void leave();
    const t = setTimeout(() => navigation.canGoBack() && navigation.goBack(), 1800);
    return () => clearTimeout(t);
  }, [over, leave, navigation]);

  useEffect(() => {
    if (motionOff() || status !== "RINGING") return;
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [pulse, status]);

  const answer = async () => {
    try {
      const c = await callAction(view, params.callId, "answer");
      setCall(c);
      await join(c.url, c.token);
    } catch (e) {
      setError((e as Error).message);
      void refresh();
    }
  };
  const hangUp = async (decline = false) => {
    try {
      const c = await callAction(view, params.callId, decline ? "decline" : "end");
      setCall((x) => ({ ...(x ?? {}), ...c }));
    } catch {
      void refresh();
    }
    await leave();
  };
  const toggleMute = async () => {
    try {
      await room.current?.localParticipant.setMicrophoneEnabled(muted);
      setMuted(!muted);
    } catch {
      /* not connected */
    }
  };
  const toggleSpeaker = async () => {
    try {
      await lk.current?.AudioSession?.selectAudioOutput?.(speaker ? "earpiece" : "speaker");
      setSpeaker(!speaker);
    } catch {
      /* the phone picks */
    }
  };

  const who = call?.otherName || call?.calleeName || (params.incoming ? "Caller" : "Calling…");
  const talking = status === "ANSWERED" && call?.answeredAt ? Math.max(0, Math.floor((now - new Date(call.answeredAt).getTime()) / 1000)) : 0;
  const line =
    status === "ANSWERED"
      ? joined
        ? mmss(talking)
        : "Connecting…"
      : status === "RINGING"
        ? incoming
          ? "Incoming call"
          : "Ringing…"
        : status === "MISSED"
          ? "No answer"
          : status === "DECLINED"
            ? "Declined"
            : "Call ended";

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "space-between", paddingVertical: 56, paddingHorizontal: 24 }}>
      <View style={{ alignItems: "center", gap: 10, marginTop: 24 }}>
        <Label>{params.incoming ? "Civilier Security · incoming" : "Civilier Security · call"}</Label>
        <View style={{ width: 140, height: 140, alignItems: "center", justifyContent: "center" }}>
          {status === "RINGING" && (
            <Animated.View
              style={{
                position: "absolute",
                width: 140,
                height: 140,
                borderRadius: 70,
                borderWidth: 2,
                borderColor: S.blue,
                opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.8, 0] }),
                transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.25] }) }],
              }}
            />
          )}
          <View style={{ width: 100, height: 100, borderRadius: 50, borderWidth: 2, borderColor: S.ink, alignItems: "center", justifyContent: "center" }}>
            <Phone size={38} color={S.ink} />
          </View>
        </View>
        <Text style={{ fontFamily: fonts.heading.bold, fontSize: 26, color: S.ink, textAlign: "center" }}>{who}</Text>
        <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 15, color: over ? S.red : S.ink2, fontVariant: ["tabular-nums"] }}>{line}</Text>
        {error && (
          <View style={{ gap: 8, alignSelf: "stretch" }}>
            <Notice>{error}</Notice>
            {params.dialNumber ? (
              <Press onPress={() => void Linking.openURL(`tel:${params.dialNumber}`)} style={(p) => ({ padding: 12, borderWidth: 1, borderColor: S.ink, alignItems: "center", backgroundColor: p ? S.blueWash : "transparent" })}>
                <Body weight="semibold">Call {params.dialNumber} by phone instead</Body>
              </Press>
            ) : null}
          </View>
        )}
      </View>

      {!over && (
        <View style={{ flexDirection: "row", gap: 28, alignItems: "flex-end" }}>
          {incoming ? (
            <>
              <RoundKey onPress={() => void hangUp(true)} bg={S.red} label="Decline">
                <PhoneOff size={28} color="#ffffff" />
              </RoundKey>
              <RoundKey onPress={() => void answer()} bg={GREEN} label="Answer">
                <Phone size={28} color="#ffffff" />
              </RoundKey>
            </>
          ) : (
            <>
              <RoundKey onPress={() => void toggleMute()} bg={muted ? S.ink : S.grid} label={muted ? "Muted" : "Mute"} disabled={!joined}>
                {muted ? <MicOff size={24} color={S.paper} /> : <Mic size={24} color={S.ink} />}
              </RoundKey>
              <RoundKey onPress={() => void hangUp()} bg={S.red} label="End">
                <PhoneOff size={28} color="#ffffff" />
              </RoundKey>
              <RoundKey onPress={() => void toggleSpeaker()} bg={speaker ? S.ink : S.grid} label={speaker ? "Speaker" : "Earpiece"} disabled={!joined}>
                {speaker ? <Volume2 size={24} color={S.paper} /> : <Ear size={24} color={S.ink} />}
              </RoundKey>
            </>
          )}
        </View>
      )}
    </View>
  );
}
