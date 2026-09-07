// Port of Home.tsx's FeedItem — icon dot + connecting timeline line + label/sub/time.
import { View, Text } from "react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";

export interface FeedItemData {
  label: string;
  sub: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
  color: string;
  time?: string;
}

export function FeedItem({ item, isLast }: { item: FeedItemData; isLast: boolean }) {
  return (
    <View
      className="flex-row items-start gap-3 py-3"
      style={!isLast ? { borderBottomWidth: 1, borderBottomColor: `${colors.border}60` } : undefined}
    >
      <View className="items-center mt-0.5">
        <View
          style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: `${item.color}2e` }}
          className="items-center justify-center"
        >
          <item.icon size={11} color={item.color} />
        </View>
        {!isLast && <View style={{ width: 1, flex: 1, minHeight: 10, backgroundColor: `${colors.border}60`, marginTop: 4 }} />}
      </View>
      <View className="flex-1 min-w-0">
        <Text numberOfLines={1} style={{ color: colors.foreground, fontFamily: fonts.body.semibold, fontSize: 12 }}>
          {item.label}
        </Text>
        <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 10, marginTop: 2, fontFamily: fonts.body.regular }}>
          {item.sub}
        </Text>
      </View>
      {item.time && (
        <Text style={{ color: `${colors.mutedForeground}80`, fontSize: 10, fontFamily: fonts.body.regular, marginTop: 2 }}>
          {item.time}
        </Text>
      )}
    </View>
  );
}
