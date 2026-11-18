// Direct port of the web login's PasswordStrength meter (src/pages/Login.tsx)
// — identical scoring, RN View bars instead of framer-motion divs.
import { View, Text } from "react-native";
import { fonts } from "@/theme/fonts";
import { sheet as S } from "@/theme/colors";

export function PasswordStrength({ password }: { password: string }) {
  if (!password) return null;

  const strength = password.length < 4 ? 1 : password.length < 7 ? 2 : /[A-Z]/.test(password) && /[0-9]/.test(password) ? 4 : 3;
  const colors = ["", S.red, S.ink, S.ink, S.blue];
  const labels = ["", "Weak", "Fair", "Good", "Strong"];

  return (
    <View className="px-1 pt-1.5">
      <View className="flex-row gap-1 mb-1">
        {[1, 2, 3, 4].map((i) => (
          <View
            key={i}
            className="h-1 flex-1"
            style={{ backgroundColor: i <= strength ? colors[strength] : S.ruleSoft }}
          />
        ))}
      </View>
      <Text className="text-right" style={{ color: colors[strength], fontFamily: fonts.heading.semibold, fontSize: 9, letterSpacing: 1, textTransform: "uppercase" }}>
        {labels[strength]}
      </Text>
    </View>
  );
}
