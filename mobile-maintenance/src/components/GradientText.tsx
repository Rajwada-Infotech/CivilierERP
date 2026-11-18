// RN equivalent of the web login's WebkitBackgroundClip gradient-text trick
// (src/pages/Login.tsx: "linear-gradient(135deg,#4c1d95,#7c3aed,#a78bfa)"
// clipped to text). CSS background-clip:text has no RN equivalent, so this
// masks a LinearGradient with the text shape via @react-native-masked-view.
import { Text, type TextStyle } from "react-native";
import RawMaskedView, { type MaskedViewProps } from "@react-native-masked-view/masked-view";
import type { ComponentType } from "react";

// The library's class component is typed for older React; this is the same component, typed for React 19.3
// (Expo SDK 58). The app's one import of it — AnimatedLogo uses it from here too.
export const MaskedView = RawMaskedView as unknown as ComponentType<MaskedViewProps>;
import { LinearGradient } from "expo-linear-gradient";

export function GradientText({
  children,
  style,
  colors = ["#4c1d95", "#7c3aed", "#a78bfa"],
}: {
  children: string;
  style?: TextStyle;
  colors?: [string, string, ...string[]];
}) {
  return (
    <MaskedView maskElement={<Text style={[style, { backgroundColor: "transparent" }]}>{children}</Text>}>
      <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
        <Text style={[style, { opacity: 0 }]}>{children}</Text>
      </LinearGradient>
    </MaskedView>
  );
}
