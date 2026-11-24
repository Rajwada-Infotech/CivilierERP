// Guard (and security admin, read-only): one visitor request and its answer. While the flat hasn't answered it waits,
// updated over the socket the moment a resident decides (and re-read every few seconds in case the socket is down).
// Approved fills the screen green, denied red, no response grey. After a minute with no answer the guard gets the
// residents' numbers to call, and can close the request as "no response". A request queued offline shows as queued
// until it goes through, then follows like any other.
import { useEffect, useRef, useState } from "react";
import { View, Text, ScrollView, Animated, Easing, Linking, Alert } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X, Phone, CloudOff, Clock, Plus } from "lucide-react-native";
import type { MainStackParamList } from "@/navigation/MainStack";
import { colors, sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { Body, Key, Label, Notice, Press, SheetFrame, Skel, motionOff } from "@/components/sheet/Sheet";
import { AuthImage } from "@/components/AuthImage";
import { getVisitor, getVisitorContacts, markNoResponse, staffPhotoUrl, type VisitorDetail } from "@/api/visitorsApi";
import { callResident, callsAvailable } from "@/api/securityMoreApi";
import { nativeCallsAvailable } from "@/screens/calls/callSupport";
import { onQueuedSent } from "@/visitors/offlineQueue";
import { useVisitorEvents } from "@/visitors/useSecuritySocket";
import { useSecurityView } from "@/navigation/securityRole";

// Approval is the one place the app uses green: the guard reads it from across the gate.
const GREEN = "#1f9d55";
const flatOf = (block: string | null, flat: string) => (block ? `${block}-${flat}` : flat);

function useElapsed(fromIso?: string | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return fromIso ? Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000)) : 0;
}
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** The answer, full width: a mark that springs in on a field of its colour. */
function Verdict({ tone, title, line }: { tone: "ok" | "no" | "none"; title: string; line: string }) {
  const t = useRef(new Animated.Value(motionOff() ? 1 : 0)).current;
  useEffect(() => {
    if (motionOff()) return;
    Animated.spring(t, { toValue: 1, useNativeDriver: true, stiffness: 180, damping: 12 }).start();
  }, [t]);
  const bg = tone === "ok" ? GREEN : tone === "no" ? S.red : colors.muted;
  const Icon = tone === "ok" ? Check : tone === "no" ? X : Clock;
  return (
    <View style={{ backgroundColor: bg, paddingVertical: 36, alignItems: "center", gap: 14 }}>
      <Animated.View style={{ width: 112, height: 112, borderRadius: 56, borderWidth: 4, borderColor: "#ffffff", alignItems: "center", justifyContent: "center", transform: [{ scale: t }], opacity: t }}>
        <Icon size={64} color="#ffffff" strokeWidth={3} />
      </Animated.View>
      <Text style={{ fontFamily: fonts.heading.bold, fontSize: 30, color: "#ffffff", letterSpacing: -0.5 }}>{title}</Text>
      <Text style={{ fontFamily: fonts.body.medium, fontSize: 14, color: "#ffffff", textAlign: "center", paddingHorizontal: 20 }}>{line}</Text>
    </View>
  );
}

/** Waiting: a ring that keeps pulsing out. */
function Waiting({ flat, elapsed }: { flat: string; elapsed: number }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (motionOff()) return;
    const loop = Animated.loop(Animated.timing(t, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [t]);
  return (
    <View style={{ paddingVertical: 32, alignItems: "center", gap: 12 }}>
      <View style={{ width: 120, height: 120, alignItems: "center", justifyContent: "center" }}>
        <Animated.View
          style={{
            position: "absolute",
            width: 120,
            height: 120,
            borderRadius: 60,
            borderWidth: 2,
            borderColor: S.blue,
            opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0.8, 0] }),
            transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.2] }) }],
          }}
        />
        <View style={{ width: 84, height: 84, borderRadius: 42, borderWidth: 2, borderColor: S.ink, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 18, color: S.ink, fontVariant: ["tabular-nums"] }}>{mmss(elapsed)}</Text>
        </View>
      </View>
      <Text style={{ fontFamily: fonts.heading.bold, fontSize: 22, color: S.ink }}>Asking flat {flat}…</Text>
      <Body size={13} color={S.graphite}>The answer shows here the moment a resident taps it.</Body>
    </View>
  );
}

export default function VisitorStatusScreen() {
  const { params } = useRoute<RouteProp<MainStackParamList, "VisitorStatus">>();
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const qc = useQueryClient();
  const { view } = useSecurityView();
  const isGuard = view === "guard";
  const [id, setId] = useState<number | null>(params.id ?? null);
  const [closing, setClosing] = useState(false);

  // A queued request: follow it once it goes through.
  useEffect(() => {
    if (id || !params.queuedId) return;
    return onQueuedSent((cid, sent) => cid === params.queuedId && setId(sent.id));
  }, [id, params.queuedId]);

  const { data: v, isLoading, error, refetch } = useQuery<VisitorDetail>({
    queryKey: ["security-visitor", id],
    queryFn: () => getVisitor(id!),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data?.status === "PENDING" ? 4000 : false),
  });
  useVisitorEvents(!!id && view !== "customer", (e) => {
    if (e.requestId === id) void refetch();
    void qc.invalidateQueries({ queryKey: ["security-dashboard"] });
  });

  const elapsed = useElapsed(v?.requestedAt);
  const pending = v?.status === "PENDING";

  // The guard was waiting (or the request was queued) and the answer came: show it, then go back to the dashboard.
  // A request opened later from a list (already answered) stays on screen.
  const waited = useRef(!!params.queuedId);
  const [backIn, setBackIn] = useState<number | null>(null);
  useEffect(() => {
    if (pending) waited.current = true;
    else if (v && waited.current && isGuard && backIn === null) setBackIn(4);
  }, [pending, v, isGuard, backIn]);
  useEffect(() => {
    if (backIn === null) return;
    if (backIn <= 0) {
      navigation.navigate("Dashboard");
      return;
    }
    const t = setTimeout(() => setBackIn(backIn - 1), 1000);
    return () => clearTimeout(t);
  }, [backIn, navigation]);
  const canCall = isGuard && !!v && (v.status === "NO_RESPONSE" || (pending && (!!v.escalatedAt || elapsed >= (v.escalateAfterS ?? 60))));
  const { data: contacts } = useQuery({ queryKey: ["security-visitor-contacts", id], queryFn: () => getVisitorContacts(id!), enabled: !!id && canCall });
  const { data: availServer } = useQuery({ queryKey: ["security-calls-available", "staff"], queryFn: () => callsAvailable("guard"), enabled: canCall });
  // In-app only when the server has calling switched on AND this phone can run it (not Expo Go); else the dialler.
  const avail = availServer ? { inApp: availServer.inApp && nativeCallsAvailable() } : undefined;
  const [calling, setCalling] = useState<number | null>(null);
  const callInApp = async (customerId: number, mobile: string | null) => {
    setCalling(customerId);
    try {
      const c = await callResident(id!, customerId);
      navigation.navigate("Call", { callId: c.callId, call: c, dialNumber: mobile ?? undefined });
    } catch (e) {
      Alert.alert("Call", (e as Error).message);
    } finally {
      setCalling(null);
    }
  };
  const POLICY: Record<string, string> = {
    HOLD: "Gate rule: don't let the visitor in without a resident's approval.",
    ALLOW: "Gate rule: you may let the visitor in after trying to call the flat.",
    CALL_OFFICE: "Gate rule: call the security office before deciding.",
  };

  const closeNoResponse = () =>
    Alert.alert("No response", "Close this request as unanswered? The flat can no longer approve it.", [
      { text: "Keep waiting", style: "cancel" },
      {
        text: "Close it",
        style: "destructive",
        onPress: async () => {
          setClosing(true);
          try {
            await markNoResponse(id!);
            await refetch();
            void qc.invalidateQueries({ queryKey: ["security-dashboard"] });
          } catch (e) {
            Alert.alert("No response", (e as Error).message);
          } finally {
            setClosing(false);
          }
        },
      },
    ]);

  const flat = v ? flatOf(v.block, v.flat) : params.flat ?? "";

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 40 }}>
      <SheetFrame>
        {!id ? (
          <View style={{ paddingVertical: 36, alignItems: "center", gap: 12, paddingHorizontal: 16 }}>
            <CloudOff size={48} color={S.ink} />
            <Text style={{ fontFamily: fonts.heading.bold, fontSize: 22, color: S.ink }}>Queued for flat {flat}</Text>
            <Body size={13} color={S.graphite} style={{ textAlign: "center" }}>
              No network. The request is saved on this phone and goes to the flat once the server can be reached. It's sent only once.
            </Body>
          </View>
        ) : isLoading ? (
          <View style={{ padding: 16, gap: 10 }}>
            <Skel h={180} />
            <Skel h={40} />
          </View>
        ) : error || !v ? (
          <View style={{ padding: 16 }}>
            <Notice>{(error as Error)?.message || "The request could not be read."}</Notice>
          </View>
        ) : v.status === "APPROVED" ? (
          <Verdict tone="ok" title="Approved" line={`Let the visitor in. ${v.decidedBy ? `${v.decidedBy}, flat ${flat}` : `Flat ${flat}`}`} />
        ) : v.status === "DENIED" ? (
          <Verdict tone="no" title="Denied" line={`Don't let the visitor in. ${v.decidedBy ? `${v.decidedBy}, flat ${flat}` : `Flat ${flat}`}`} />
        ) : v.status === "NO_RESPONSE" ? (
          <Verdict tone="none" title="No response" line={`Nobody at flat ${flat} answered${v.noResponseBy === "GUARD" ? " (closed at the gate)" : ""}. ${POLICY[v.noResponsePolicy ?? "HOLD"]}`} />
        ) : (
          <Waiting flat={flat} elapsed={elapsed} />
        )}

        {v && (
          <View style={{ borderTopWidth: 1, borderTopColor: S.ink, flexDirection: "row" }}>
            <View style={{ width: 110, borderRightWidth: 1, borderRightColor: S.rule }}>
              {v.hasPhoto ? <AuthImage url={staffPhotoUrl(v.id)} style={{ width: 110, height: 146 }} /> : <View style={{ width: 110, height: 146, backgroundColor: S.grid }} />}
            </View>
            <View style={{ flex: 1, padding: 12, gap: 6 }}>
              <Label>Flat {flat} · {v.gateName}</Label>
              <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 16, color: S.ink }}>{v.visitorName || "Visitor"}</Text>
              <Body size={13} color={S.ink2}>{v.reason}</Body>
              {!!v.vehicleNo && <Body size={12.5} color={S.ink2}>Vehicle {v.vehicleNo}</Body>}
              {!!v.visitorPhone && <Body size={12.5} color={S.ink2}>Phone {v.visitorPhone}</Body>}
              <Body size={11.5} color={S.graphite}>
                Asked at {new Date(v.requestedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                {v.guardName ? ` by ${v.guardName}` : ""}
              </Body>
            </View>
          </View>
        )}

        {canCall && (
          <View style={{ borderTopWidth: 1, borderTopColor: S.rule, padding: 16, gap: 10 }}>
            <Label>{pending ? "No answer yet — call the flat" : "Call the flat"}</Label>
            {(contacts ?? []).filter((c) => c.mobile).length === 0 ? (
              <Body size={12.5} color={S.graphite}>{contacts ? "No phone number is recorded for this flat's residents." : "Reading…"}</Body>
            ) : (
              contacts!
                .filter((c) => c.mobile)
                .map((c) => (
                  <Press
                    key={`${c.name}-${c.mobile}`}
                    onPress={() => (avail?.inApp && c.customerId ? void callInApp(c.customerId, c.mobile) : void Linking.openURL(`tel:${c.mobile}`))}
                    style={(p) => ({ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48, paddingHorizontal: 12, borderWidth: 1, borderColor: S.ink, backgroundColor: p ? S.blueWash : "transparent" })}
                  >
                    <Phone size={16} color={S.ink} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: fonts.body.semibold, fontSize: 14, color: S.ink }}>{c.name || "Resident"}</Text>
                      <Text style={{ fontFamily: fonts.body.regular, fontSize: 12, color: S.graphite }}>
                        {c.isPrimary ? "Primary" : "Member"} · {c.mobile} · {calling === c.customerId ? "calling…" : avail?.inApp ? "in-app call" : "phone call"}
                      </Text>
                    </View>
                  </Press>
                ))
            )}
            {pending && <Key tone="red" label={closing ? "Closing…" : "Close as no response"} onPress={closeNoResponse} disabled={closing} />}
          </View>
        )}

        {isGuard && (!v || !pending) && (
          <View style={{ borderTopWidth: 1, borderTopColor: S.rule, padding: 16, gap: 8 }}>
            {backIn !== null && <Body size={12.5} color={S.graphite} style={{ textAlign: "center" }}>Back to the dashboard in {backIn} s</Body>}
            <Key tone="ink" label="Next visitor" icon={<Plus size={14} color={S.paper} />} onPress={() => navigation.replace("NewVisitor")} />
            {backIn !== null && <Key label="Dashboard now" onPress={() => navigation.navigate("Dashboard")} />}
          </View>
        )}
      </SheetFrame>
    </ScrollView>
  );
}
