// Small pieces shared by the activity detail tabs.
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Text, TouchableOpacity, View, type ImageStyle, type StyleProp } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { apiUrl } from "@/utils/apiBase";
import { getToken } from "@/services/authStorage";
import { toast } from "@/components/Toast";

// The sheet has no module colour: its accent is the primary blue, its boxes square and ruled on paper.
export const ACCENT = S.blue;
export const card = { backgroundColor: S.paper, borderRadius: 0, borderWidth: 1, borderColor: S.rule, padding: 14 } as const;

/** Local calendar date as YYYY-MM-DD (never via toISOString — that shifts the day in IST). */
export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const todayYmd = () => ymd(new Date());
export const fromYmd = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
};
export const fmtDay = (s: string) => fromYmd(s).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
export const fmtClock = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

export function Loading() {
  return <ActivityIndicator color={S.graphite} style={{ paddingVertical: 36 }} />;
}

export function Empty({ text }: { text: string }) {
  return (
    <Text style={{ textAlign: "center", color: S.graphite, fontSize: 13, fontFamily: fonts.body.regular, paddingVertical: 32 }}>{text}</Text>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  return (
    <View style={{ borderWidth: 1, borderColor: S.red, backgroundColor: S.redWash, paddingHorizontal: 12, paddingVertical: 9, marginVertical: 8 }}>
      <Text style={{ color: S.red, fontSize: 13, fontFamily: fonts.body.medium }}>{(error as Error)?.message || "Something went wrong."}</Text>
    </View>
  );
}

/** A key on the sheet: "accent" is filled ink, "outline" an ink outline, "danger" red. Square, capital Sora label. */
export function Btn({
  label, onPress, icon, tone = "accent", disabled, busy,
}: { label: string; onPress: () => void; icon?: React.ReactNode; tone?: "accent" | "outline" | "danger"; disabled?: boolean; busy?: boolean }) {
  const bg = tone === "accent" ? S.ink : tone === "danger" ? S.red : "transparent";
  const border = tone === "danger" ? S.red : S.ink;
  const fg = tone === "accent" ? S.paper : tone === "danger" ? "#ffffff" : S.ink;
  return (
    <TouchableOpacity
      activeOpacity={0.75}
      disabled={disabled || busy}
      onPress={onPress}
      style={{
        flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 44, paddingHorizontal: 16,
        backgroundColor: bg, borderWidth: 1, borderColor: border, opacity: disabled || busy ? 0.4 : 1,
      }}
    >
      {busy ? <ActivityIndicator size="small" color={fg} /> : icon}
      <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 11, letterSpacing: 1.1, textTransform: "uppercase", color: fg }}>{label}</Text>
    </TouchableOpacity>
  );
}

/** Open the camera and return the captured image's uri (null if cancelled or refused). Downscaled — photos are
 *  stored as base64 in the database, so size decides how slow a day of uploads gets. */
export async function takePhoto(): Promise<string | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    toast.error("Camera permission denied");
    return null;
  }
  const res = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.5, allowsEditing: false });
  return res.canceled || !res.assets?.[0]?.uri ? null : res.assets[0].uri;
}

/** An image served behind the API's bearer token (a plain URI can't carry the header, this can). */
export function AuthImage({ path, style }: { path: string; style: StyleProp<ImageStyle> }) {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => { getToken().then(setToken); }, []);
  if (!token) return <View style={[{ backgroundColor: S.line15 }, style as object]} />;
  return <Image source={{ uri: apiUrl(path), headers: { Authorization: `Bearer ${token}` } }} style={style} />;
}
