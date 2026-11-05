// RN equivalent of the web login's WebkitBackgroundClip gradient-text trick
// (src/pages/Login.tsx: "linear-gradient(135deg,#164e63,#0891b2,#67e8f9)"
// clipped to text). CSS background-clip:text has no RN equivalent, so this
// masks a LinearGradient with the text shape via @react-native-masked-view.
import { Text, type TextStyle } from "react-native";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";

export function GradientText({
  children,
  style,
  colors = ["#164e63", "#0891b2", "#67e8f9"],
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
