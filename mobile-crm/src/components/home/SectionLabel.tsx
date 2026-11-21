// Port of Home.tsx's SectionLabel — a small eyebrow bar + uppercase label.
// The traveling-dot accent line is decorative-only on web (hidden below
// sm: breakpoint there too), so it's dropped here rather than reproduced.
import { View, Text } from "react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";

export function SectionLabel({ children }: { children: string }) {
  return (
    <View className="flex-row items-center gap-2.5 mb-4">
      <View className="w-1 h-3.5 rounded-full" style={{ backgroundColor: colors.primary, opacity: 0.7 }} />
      <Text
        className="text-[10px] uppercase"
        style={{ color: colors.mutedForeground, fontFamily: fonts.heading.bold, letterSpacing: 2 }}
      >
        {children}
      </Text>
    </View>
  );
}
