import { View, Text } from "react-native";
import { Hammer } from "lucide-react-native";
import { colors, moduleAccents } from "@/theme/colors";
import { fonts } from "@/theme/fonts";

export function ComingSoon({ title }: { title: string }) {
  return (
    <View className="flex-1 items-center justify-center gap-3 px-10" style={{ backgroundColor: colors.background }}>
      <View className="w-14 h-14 rounded-2xl items-center justify-center" style={{ backgroundColor: `${moduleAccents.followup}1f` }}>
        <Hammer size={22} color={moduleAccents.followup} />
      </View>
      <Text style={{ color: colors.foreground, fontSize: 15, fontFamily: fonts.heading.semibold, textAlign: "center" }}>
        {title}
      </Text>
      <Text style={{ color: colors.mutedForeground, fontSize: 12.5, fontFamily: fonts.body.regular, textAlign: "center", lineHeight: 18 }}>
        This screen isn't built on mobile yet — use the web app for now. It's wired into navigation so it's ready to build out.
      </Text>
    </View>
  );
}
