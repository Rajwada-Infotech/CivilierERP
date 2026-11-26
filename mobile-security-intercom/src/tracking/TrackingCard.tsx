// The guard's "location on shift" panel on the home page. The first time, it explains what is shared and asks the guard
// to agree; after that, tracking starts by itself whenever the shift is on and stops when it ends. Shows whether it is
// running and how many points are waiting to upload, and walks the guard through the phone settings that cheap phones
// need so they don't stop it in the background.
import { useCallback, useEffect, useState } from "react";
import { View, Text, Linking, Platform, AppState } from "react-native";
import * as IntentLauncher from "expo-intent-launcher";
import { MapPin, MapPinOff } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { Body, Key, Label, Notice } from "@/components/sheet/Sheet";
import { hasConsent, isTracking, lastTrackingError, queuedPings, setConsent, startTracking, stopTracking, uploadPings, type StartResult } from "./guardTracking";

const PROBLEM: Record<Exclude<StartResult, "started" | "background" | "failed">, string> = {
  "no-permission": "Location isn't allowed. Allow it for Civilier Security in the phone's settings.",
  "no-background-permission": "Choose \"Allow all the time\" for location, so your shift is tracked with the screen off.",
  unavailable: "Shift tracking needs the installed Civilier Security app. It doesn't run inside Expo Go.",
};

/** What to tell the guard for a start result; null when there's nothing wrong (started, or waiting for the app to be open). */
function problemOf(r: StartResult): string | null {
  if (r === "started" || r === "background") return null;
  if (r === "failed") return `Couldn't start shift tracking: ${lastTrackingError() ?? "unknown error"}. Check that location is on and allowed "all the time".`;
  return PROBLEM[r];
}

export function TrackingCard({ onDuty, shiftEnd }: { onDuty: boolean; shiftEnd: string | null }) {
  const [consent, setConsentState] = useState<boolean | null>(null);
  const [running, setRunning] = useState(false);
  const [queued, setQueued] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Bumped when the app comes back to the front, so a start that had to wait for it is tried again.
  const [appActiveAt, setAppActiveAt] = useState(0);

  const refresh = useCallback(async () => {
    setConsentState(await hasConsent());
    setRunning(await isTracking());
    setQueued(await queuedPings());
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 15000);
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active") return;
      void refresh();
      setAppActiveAt(Date.now());
    });
    return () => {
      clearInterval(t);
      sub.remove();
    };
  }, [refresh]);

  // On shift and agreed: make sure it runs. Off shift: make sure it doesn't.
  useEffect(() => {
    if (consent == null) return;
    void (async () => {
      if (onDuty && consent && !(await isTracking())) {
        const r = await startTracking();
        setProblem(problemOf(r));
      } else if (!onDuty && (await isTracking())) {
        await stopTracking();
      }
      await refresh();
    })();
  }, [onDuty, consent, refresh, appActiveAt]);

  const agree = async () => {
    setBusy(true);
    await setConsent(true);
    setConsentState(true);
    if (onDuty) {
      const r = await startTracking();
      setProblem(problemOf(r));
    }
    await refresh();
    setBusy(false);
  };

  const pause = async () => {
    setBusy(true);
    await setConsent(false);
    await stopTracking();
    await refresh();
    setBusy(false);
  };

  return (
    <View style={{ borderTopWidth: 1, borderTopColor: S.rule, padding: 16, gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        {running ? <MapPin size={18} color={S.blue} /> : <MapPinOff size={18} color={onDuty ? S.red : S.graphite} />}
        <View style={{ flex: 1 }}>
          <Label>Location on shift</Label>
          <Text style={{ fontFamily: fonts.body.semibold, fontSize: 14, color: running ? S.ink : onDuty ? S.red : S.ink2, marginTop: 2 }}>
            {running
              ? `Shared until ${shiftEnd ? new Date(shiftEnd).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "your shift ends"}`
              : onDuty
                ? "Not shared — your supervisor sees your phone as offline"
                : "Off shift — nothing is shared"}
          </Text>
        </View>
      </View>

      {consent === false && (
        <View style={{ gap: 10 }}>
          <Body size={12.5} color={S.ink2}>
            During your shift, and only then, the app shares your phone's location every few seconds with the security supervisor, so they can
            see you are at your gate. It stops when your shift ends. Nothing is shared off shift.
          </Body>
          <Key tone="ink" label={busy ? "Starting…" : "I agree — share during my shift"} onPress={agree} disabled={busy} />
        </View>
      )}

      {problem && (
        <View style={{ gap: 8 }}>
          <Notice>{problem}</Notice>
          <Key label="Open phone settings" onPress={() => void Linking.openSettings()} />
        </View>
      )}

      {running && Platform.OS === "android" && (
        <View style={{ gap: 8 }}>
          <Body size={11.5} color={S.graphite}>
            Keep the "On shift" notification. On Xiaomi, Oppo, Vivo, Realme and similar phones, set Civilier Security's battery use to "No
            restrictions" so the phone doesn't stop it.
          </Body>
          <Key
            label="Open battery settings"
            onPress={() =>
              void IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS).catch(() => Linking.openSettings())
            }
          />
        </View>
      )}

      {queued > 0 && (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <Body size={12} color={S.graphite}>{queued} location point{queued === 1 ? "" : "s"} waiting to upload</Body>
          <Key label="Send now" onPress={() => void uploadPings(true).then(refresh)} />
        </View>
      )}

      {consent && running && <Key label={busy ? "Stopping…" : "Stop sharing"} onPress={pause} disabled={busy} />}
    </View>
  );
}
