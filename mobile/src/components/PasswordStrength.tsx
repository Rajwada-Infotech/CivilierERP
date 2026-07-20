// Direct port of the web login's PasswordStrength meter (src/pages/Login.tsx)
// — identical scoring, RN View bars instead of framer-motion divs.
import { View, Text } from "react-native";
import { fonts } from "@/theme/fonts";

export function PasswordStrength({ password }: { password: string }) {
  if (!password) return null;

  const strength = password.length < 4 ? 1 : password.length < 7 ? 2 : /[A-Z]/.test(password) && /[0-9]/.test(password) ? 4 : 3;
  const colors = ["", "#ef4444", "#f97316", "#eab308", "#22c55e"];
  const labels = ["", "Weak", "Fair", "Good", "Strong"];

  return (
    <View className="px-1 pt-1.5">
      <View className="flex-row gap-1 mb-1">
        {[1, 2, 3, 4].map((i) => (
          <View
            key={i}
            className="h-1 flex-1 rounded-full"
            style={{ backgroundColor: i <= strength ? colors[strength] : "rgba(255,255,255,0.12)" }}
          />
        ))}
      </View>
      <Text className="text-[10px] text-right" style={{ color: colors[strength], fontFamily: fonts.body.medium }}>
        {labels[strength]}
      </Text>
    </View>
  );
}
