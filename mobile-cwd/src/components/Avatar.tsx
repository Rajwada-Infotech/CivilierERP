// User avatar — the person's photo when there is one, otherwise a coloured
// initials circle. Mirrors the web app's <UserAvatar>. Relative avatar_url
// values are resolved against the API base; full URLs and data URIs are used
// as-is.
import { useState } from "react";
import { Image, Text, View } from "react-native";
import { API_BASE_URL } from "@/utils/apiBase";
import { fonts } from "@/theme/fonts";

const COLORS = ["#6467f2", "#8249df", "#0891b2", "#0d9488", "#f59e0b", "#ef4444", "#ec4899", "#10b981"];

function initials(name: string): string {
  return (name || "?")
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "?";
}

function resolve(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^(https?:|data:)/i.test(url)) return url;
  return `${API_BASE_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

export function Avatar({
  name, url, id = 0, size = 34,
}: { name: string | null | undefined; url?: string | null; id?: number; size?: number }) {
  const [failed, setFailed] = useState(false);
  const src = failed ? null : resolve(url);
  const color = COLORS[Math.abs(id) % COLORS.length];

  if (src) {
    return (
      <Image
        source={{ uri: src }}
        onError={() => setFailed(true)}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: `${color}33` }}
      />
    );
  }
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: "#fff", fontSize: size * 0.38, fontFamily: fonts.heading.bold }}>{initials(name || "?")}</Text>
    </View>
  );
}
