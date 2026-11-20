// Keeps on-duty movement tracking in step with the punch state, and asks for the reason after a trip outside the
// employee's own work location (one that was not a break and not a visit to another office).
import { useEffect, useRef, useState } from "react";
import { Alert, AppState, Modal, Pressable, ScrollView, View } from "react-native";
import * as Location from "expo-location";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin, MapPinOff } from "lucide-react-native";
import { api } from "@/api/employeeApi";
import { Body, Input, Key, Label, TitleText } from "@/components/sheet/Sheet";
import { sheet as S } from "@/theme/colors";
import { startMovementTracking, stopMovementTracking } from "@/services/movementTracker";

const OFF_PRESETS = ["Phone battery saver", "GPS turned off by mistake", "Phone restarted", "Network / GPS problem"];
const PRESETS = ["Site visit", "Client / vendor meeting", "Bank / government office work", "Material purchase", "Personal work", "Lunch / tea outside"];
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
const mins = (a: string, b: string) => Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000));

export default function MovementWatcher() {
  const qc = useQueryClient();
  const today = useQuery({ queryKey: ["today"], queryFn: api.today, staleTime: 30_000 });
  const pending = useQuery({ queryKey: ["movement-pending"], queryFn: api.movementPending, staleTime: 30_000, refetchInterval: 120_000, retry: false });
  const [denied, setDenied] = useState(false);
  const [reason, setReason] = useState("");
  const asked = useRef(false);

  // Punched in → track; punched out / not started → stop.
  const state = today.data?.state;
  useEffect(() => {
    if (!state) return;
    if (state === "WORKING" || state === "ON_BREAK") {
      if (asked.current) return;
      asked.current = true;
      startMovementTracking().then((ok) => setDenied(!ok));
    } else {
      asked.current = false;
      stopMovementTracking();
    }
  }, [state]);

  // Location switched off while on duty: checked every 20 s and whenever the app comes to the front; each change is
  // sent once (off → opens a "location off" spell the employee must explain; on → closes it).
  const lastSent = useRef<boolean | null>(null);
  const onDuty = state === "WORKING" || state === "ON_BREAK";
  useEffect(() => {
    if (!onDuty) { lastSent.current = null; return; }
    let alive = true;
    const check = async () => {
      let on = false;
      try {
        const [svc, perm] = await Promise.all([Location.hasServicesEnabledAsync(), Location.getForegroundPermissionsAsync()]);
        on = svc && perm.status === "granted";
      } catch { on = false; }
      if (!alive || on === lastSent.current) return;
      try {
        const r = await api.locationStatus(on);
        lastSent.current = on;
        qc.setQueryData(["movement-pending"], { pending: r.pending });
      } catch { /* offline — try on the next check */ }
    };
    check();
    const t = setInterval(check, 20_000);
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") check(); });
    return () => { alive = false; clearInterval(t); sub.remove(); };
  }, [onDuty, qc]);

  // Back in the app → check for a trip that needs its reason.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") qc.invalidateQueries({ queryKey: ["movement-pending"] }); });
    return () => sub.remove();
  }, [qc]);

  const send = useMutation({
    mutationFn: (v: { id: number; reason: string }) => api.movementReason(v.id, v.reason),
    onSuccess: (r) => { qc.setQueryData(["movement-pending"], r); setReason(""); },
  });
  const skip = useMutation({
    mutationFn: (id: number) => api.movementSkip(id),
    onSuccess: (r) => { qc.setQueryData(["movement-pending"], r); setReason(""); },
  });
  const askSkip = (id: number) => Alert.alert(
    "Skip the reason?",
    "Without a reason this record is marked and highlighted for HR and Super Admin. It may be treated as unexplained absence from work.",
    [{ text: "Give reason", style: "cancel" }, { text: "Skip anyway", style: "destructive", onPress: () => skip.mutate(id) }],
  );

  const trip = pending.data?.pending?.[0];
  if (trip) {
    const off = trip.kind === "LocationOff";
    const stillOff = off && !trip.returnedAt;
    return (
      <Modal visible transparent animationType="fade" onRequestClose={() => {}}>
        <View style={{ flex: 1, backgroundColor: "#000000aa", justifyContent: "center", padding: 20 }}>
          <View style={{ backgroundColor: S.paper, borderWidth: 1, borderColor: S.ink, borderTopWidth: 5, borderTopColor: S.red, maxHeight: "85%" }}>
            <View style={{ padding: 18, gap: 8, borderBottomWidth: 1, borderBottomColor: S.ruleSoft }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                {off ? <MapPinOff size={16} color={S.red} /> : <MapPin size={16} color={S.red} />}
                <Label color={S.red}>{off ? "Location turned off" : "You were outside your office"}</Label>
              </View>
              <TitleText size={20}>{off ? "Why is your location off?" : "Why did you go out?"}</TitleText>
              <Body size={12.5} color={S.graphite}>
                {off
                  ? stillOff
                    ? `Your location is off since ${time(trip.leftAt)} while you are on duty. Turn it back on and give the reason. HR sees this.`
                    : `Location was off from ${time(trip.leftAt)} to ${time(trip.returnedAt!)} (${mins(trip.leftAt, trip.returnedAt!)} min) while on duty. HR sees this reason.`
                  : `Left at ${time(trip.leftAt)}, back at ${time(trip.returnedAt!)} (${mins(trip.leftAt, trip.returnedAt!)} min) without taking a break. HR sees this reason.`}
              </Body>
              {stillOff && <Key label="Turn on location" onPress={() => Location.enableNetworkProviderAsync().catch(() => {})} />}
            </View>
            <ScrollView contentContainerStyle={{ padding: 18, gap: 12 }} keyboardShouldPersistTaps="handled">
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {(off ? OFF_PRESETS : PRESETS).map((p) => (
                  <Pressable key={p} onPress={() => setReason(p)} style={{ paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: reason === p ? S.ink : S.ruleSoft, backgroundColor: reason === p ? S.ink : "transparent" }}>
                    <Body size={12} color={reason === p ? S.paper : S.ink}>{p}</Body>
                  </Pressable>
                ))}
              </View>
              <Input value={reason} onChangeText={setReason} placeholder="Or write the reason" maxLength={500} multiline />
              {send.isError && <Body size={12} color={S.red}>{(send.error as Error).message}</Body>}
            </ScrollView>
            <View style={{ flexDirection: "row", gap: 10, padding: 14, borderTopWidth: 1, borderTopColor: S.ruleSoft }}>
              <Key label="Skip" onPress={() => askSkip(trip.movementId)} disabled={skip.isPending} style={{ flex: 1 }} />
              <Key tone="ink" label={send.isPending ? "Saving…" : "Submit reason"} disabled={reason.trim().length < 3 || send.isPending}
                onPress={() => send.mutate({ id: trip.movementId, reason: reason.trim() })} style={{ flex: 2 }} />
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  if (denied) {
    return (
      <Modal visible transparent animationType="fade" onRequestClose={() => setDenied(false)}>
        <View style={{ flex: 1, backgroundColor: "#000000aa", justifyContent: "center", padding: 20 }}>
          <View style={{ backgroundColor: S.paper, borderWidth: 1, borderColor: S.ink, padding: 18, gap: 12 }}>
            <Label color={S.red}>Location access needed</Label>
            <Body size={13}>While you are on duty the app records when you leave and return to your office. Allow location "All the time" for Employee Portal App in phone Settings → Apps → Permissions.</Body>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Key label="Later" onPress={() => setDenied(false)} style={{ flex: 1 }} />
              <Key tone="ink" label="Try again" onPress={() => startMovementTracking().then((ok) => setDenied(!ok))} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>
    );
  }
  return null;
}
