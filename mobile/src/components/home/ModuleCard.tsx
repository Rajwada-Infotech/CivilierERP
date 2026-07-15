// Compact version of Home.tsx's ModuleCard — icon + title + badge, and
// just the single most important stat instead of the web version's full
// 2x2 grid. The web card is information-dense because desktop has room;
// on a phone that reads as noisy, so this keeps only stats[0] (each caller
// already orders its stats array by importance) and drops the rest.
import { View, Text, Pressable } from "react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";

export interface StatRow {
  label: string;
  value: string | number;
  accent?: string;
  icon?: React.ComponentType<{ size?: number; color?: string }>;
}

export function ModuleCard({
  title,
  icon: Icon,
  accent,
  stats,
  badge,
  loading,
  onPress,
}: {
  title: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
  accent: string;
  stats: StatRow[];
  badge?: number;
  loading?: boolean;
  onPress: () => void;
}) {
  const primary = stats[0];

  return (
    <Pressable onPress={onPress} style={{ width: "48%" }} className="rounded-lg overflow-hidden mb-2.5">
      <View
        className="flex-row items-center"
        style={{ backgroundColor: `${colors.card}b3`, borderWidth: 1, borderColor: `${colors.border}80` }}
      >
        <View style={{ width: 3, alignSelf: "stretch", backgroundColor: accent }} />
        <View className="flex-1 flex-row items-center gap-2 pl-2.5 pr-2.5 py-2.5">
          <View
            className="w-7 h-7 rounded-lg items-center justify-center shrink-0"
            style={{ backgroundColor: `${accent}30`, borderWidth: 1, borderColor: `${accent}4d` }}
          >
            <Icon size={13} color={accent} />
          </View>
          <View className="flex-1 min-w-0">
            <View className="flex-row items-center gap-1.5">
              <Text
                numberOfLines={1}
                className="flex-shrink"
                style={{ color: colors.foreground, fontFamily: fonts.heading.bold, fontSize: 12, letterSpacing: -0.2 }}
              >
                {title}
              </Text>
              {badge != null && badge > 0 && (
                <View className="px-1.5 rounded-full" style={{ backgroundColor: `${accent}38` }}>
                  <Text style={{ color: accent, fontSize: 8.5, fontFamily: fonts.heading.bold }}>{badge}</Text>
                </View>
              )}
            </View>
            {loading ? (
              <View className="h-3 w-16 rounded mt-1" style={{ backgroundColor: colors.muted }} />
            ) : primary ? (
              <View className="flex-row items-baseline gap-1 mt-0.5">
                <Text style={{ color: primary.accent ?? colors.foreground, fontFamily: fonts.heading.bold, fontSize: 13 }}>
                  {primary.value}
                </Text>
                <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 9.5, fontFamily: fonts.body.regular, flexShrink: 1 }}>
                  {primary.label}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>
    </Pressable>
  );
}
