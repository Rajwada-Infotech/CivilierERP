import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Application from "expo-application";
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import { apiUrl } from "@/utils/apiBase";

// In-app updater. On launch and whenever the app returns to the foreground it
// asks the server for the newest published build of THIS app
// (GET /api/app-releases/latest?app=<appKey>, a public endpoint, so it works
// before login). If that build's version code is higher than the installed
// one, it offers to download the APK inside the app and hand it to Android's
// installer, instead of the user fetching the file from the website by hand.
//
// Android only installs an update signed with the same key as the installed
// app and with a higher version code; both hold for EAS production builds.

type Latest = {
  available: boolean;
  versionCode?: number;
  versionName?: string | null;
  sizeBytes?: number;
  md5?: string;
  releaseNotes?: string | null;
  mandatory?: boolean;
  downloadPath?: string;
};

const CHECK_TIMEOUT_MS = 10_000;
const mb = (b?: number) => (b ? `${(b / (1024 * 1024)).toFixed(1)} MB` : "");

export function UpdateGate({ appKey }: { appKey: string }) {
  const [latest, setLatest] = useState<Latest | null>(null);
  const [visible, setVisible] = useState(false);
  const [phase, setPhase] = useState<"idle" | "downloading" | "installing" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // "Later" only hides the prompt for this session, so it comes back next launch.
  const dismissedFor = useRef<number | null>(null);
  const checking = useRef(false);

  const check = useCallback(async () => {
    if (Platform.OS !== "android" || checking.current) return;
    checking.current = true;
    try {
      const installed = parseInt(Application.nativeBuildVersion ?? "0", 10) || 0;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), CHECK_TIMEOUT_MS);
      const res = await fetch(apiUrl(`/api/app-releases/latest?app=${encodeURIComponent(appKey)}`), { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) return;
      const data: Latest = await res.json();
      if (!data.available || !data.versionCode || data.versionCode <= installed) return;
      if (!data.mandatory && dismissedFor.current === data.versionCode) return;
      setLatest(data);
      setVisible(true);
    } catch {
      // Offline or server unreachable: never block the app over an update check.
    } finally {
      checking.current = false;
    }
  }, [appKey]);

  useEffect(() => {
    check();
    const sub = AppState.addEventListener("change", (s) => s === "active" && phase === "idle" && check());
    return () => sub.remove();
  }, [check, phase]);

  const install = async () => {
    if (!latest?.downloadPath) return;
    setError(null);
    setProgress(0);
    setPhase("downloading");
    const target = `${FileSystem.cacheDirectory}${appKey}-update.apk`;
    try {
      await FileSystem.deleteAsync(target, { idempotent: true });
      const task = FileSystem.createDownloadResumable(apiUrl(latest.downloadPath), target, {}, (p) => {
        if (p.totalBytesExpectedToWrite > 0) setProgress(p.totalBytesWritten / p.totalBytesExpectedToWrite);
      });
      const result = await task.downloadAsync();
      if (!result || result.status !== 200) throw new Error("The download didn't complete. Check your connection and try again.");

      // Integrity check against the checksum the server recorded at upload.
      if (latest.md5) {
        const info = await FileSystem.getInfoAsync(target, { md5: true });
        if (info.exists && "md5" in info && info.md5 && info.md5.toLowerCase() !== latest.md5.toLowerCase()) {
          await FileSystem.deleteAsync(target, { idempotent: true });
          throw new Error("The downloaded file was damaged. Please try again.");
        }
      }

      setPhase("installing");
      const contentUri = await FileSystem.getContentUriAsync(target);
      await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
        data: contentUri,
        flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
        type: "application/vnd.android.package-archive",
      });
      // Android's installer takes over from here. If the user backs out, let them retry.
      setPhase("idle");
    } catch (e: any) {
      setPhase("error");
      setError(e?.message || "Couldn't install the update.");
    }
  };

  const later = () => {
    dismissedFor.current = latest?.versionCode ?? null;
    setVisible(false);
  };

  if (!visible || !latest) return null;
  const mandatory = !!latest.mandatory;
  const busy = phase === "downloading" || phase === "installing";

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => !mandatory && !busy && later()}>
      <View style={s.backdrop}>
        <View style={s.card}>
          <Text style={s.title}>{mandatory ? "Update required" : "Update available"}</Text>
          <Text style={s.sub}>
            Version {latest.versionName ?? latest.versionCode}
            {latest.sizeBytes ? `  ·  ${mb(latest.sizeBytes)}` : ""}
          </Text>

          {!!latest.releaseNotes && (
            <ScrollView style={s.notes}>
              <Text style={s.notesText}>{latest.releaseNotes}</Text>
            </ScrollView>
          )}
          {mandatory && <Text style={s.warn}>This version is no longer supported. Please update to continue.</Text>}

          {phase === "downloading" && (
            <View style={s.progressWrap}>
              <View style={s.progressTrack}>
                <View style={[s.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
              </View>
              <Text style={s.progressText}>Downloading… {Math.round(progress * 100)}%</Text>
            </View>
          )}
          {phase === "installing" && (
            <View style={s.row}>
              <ActivityIndicator color="#a78bfa" />
              <Text style={s.progressText}>Opening the installer…</Text>
            </View>
          )}
          {phase === "error" && <Text style={s.error}>{error}</Text>}

          <View style={s.buttons}>
            {!mandatory && !busy && (
              <Pressable onPress={later} style={[s.btn, s.btnGhost]}>
                <Text style={s.btnGhostText}>Later</Text>
              </Pressable>
            )}
            <Pressable onPress={install} disabled={busy} style={[s.btn, s.btnPrimary, busy && { opacity: 0.6 }]}>
              <Text style={s.btnPrimaryText}>{phase === "error" ? "Try again" : "Update now"}</Text>
            </Pressable>
          </View>

          {phase === "error" && !!latest.downloadPath && (
            <Pressable onPress={() => Linking.openURL(apiUrl(latest.downloadPath!))} style={{ marginTop: 10 }}>
              <Text style={s.link}>Download in browser instead</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", alignItems: "center", justifyContent: "center", padding: 24 },
  card: { width: "100%", maxWidth: 420, borderRadius: 20, padding: 22, backgroundColor: "#15112b", borderWidth: 1, borderColor: "#2a2352" },
  title: { color: "#fff", fontSize: 19, fontWeight: "700" },
  sub: { color: "#a1a1c2", fontSize: 13, marginTop: 4 },
  notes: { maxHeight: 160, marginTop: 14, padding: 12, borderRadius: 12, backgroundColor: "#1d1840" },
  notesText: { color: "#d4d4ee", fontSize: 13, lineHeight: 19 },
  warn: { color: "#fbbf24", fontSize: 12, marginTop: 12 },
  progressWrap: { marginTop: 16 },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: "#2a2352", overflow: "hidden" },
  progressFill: { height: 8, backgroundColor: "#7c3aed" },
  progressText: { color: "#a1a1c2", fontSize: 12, marginTop: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 16 },
  error: { color: "#f87171", fontSize: 12, marginTop: 12 },
  buttons: { flexDirection: "row", gap: 10, marginTop: 18 },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: "center" },
  btnPrimary: { backgroundColor: "#7c3aed" },
  btnPrimaryText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  btnGhost: { borderWidth: 1, borderColor: "#3b3470" },
  btnGhostText: { color: "#c4c4e6", fontWeight: "600", fontSize: 14 },
  link: { color: "#a78bfa", fontSize: 12, textAlign: "center", textDecorationLine: "underline" },
});
