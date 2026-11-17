import { Text, View } from "react-native";
import { fonts } from "@/theme/fonts";
import { toneOf } from "./Screen";

const TONES = { ok: "#1f8a4c", warn: "#b7791f", bad: "#d64545", info: "#6b7280" };

export function Chip({ text, tone }: { text: string; tone?: keyof typeof TONES }) {
  const c = TONES[tone ?? toneOf(text)];
  return (
    <View style={{ borderWidth: 1, borderColor: c, paddingHorizontal: 8, paddingVertical: 3, alignSelf: "flex-start" }}>
      <Text style={{ color: c, fontFamily: fonts.heading.semibold, fontSize: 10, letterSpacing: 0.8, textTransform: "uppercase" }}>{text}</Text>
    </View>
  );
}
