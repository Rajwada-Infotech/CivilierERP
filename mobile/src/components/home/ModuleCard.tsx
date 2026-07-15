// Port of Home.tsx's ModuleCard — icon + title + optional badge, 2x2 stat
// grid, left accent bar. Hover glow/lift dropped (no mouse on a phone);
// tap still navigates like the web version's onClick.
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
  return (
    <Pressable
      onPress={onPress}
      style={{ width: "48%" }}
      className="rounded-xl overflow-hidden mb-3"
    >
      <View
        className="flex-row"
        style={{ backgroundColor: `${colors.card}b3`, borderWidth: 1, borderColor: `${colors.border}80` }}
      >
        <View style={{ width: 3, backgroundColor: accent }} />
        <View className="flex-1 pl-3 pr-2.5 pt-3 pb-3">
          <View className="flex-row items-center justify-between mb-3">
            <View className="flex-row items-center gap-2 flex-1 min-w-0">
              <View
                className="w-7 h-7 rounded-lg items-center justify-center"
                style={{ backgroundColor: `${accent}30`, borderWidth: 1, borderColor: `${accent}4d` }}
              >
                <Icon size={13} color={accent} />
              </View>
              <Text
                className="text-xs flex-shrink"
                numberOfLines={1}
                style={{ color: colors.foreground, fontFamily: fonts.heading.bold, letterSpacing: -0.2 }}
              >
                {title}
              </Text>
              {badge != null && badge > 0 && (
                <View className="px-1.5 py-px rounded-full" style={{ backgroundColor: `${accent}38` }}>
                  <Text style={{ color: accent, fontSize: 9, fontFamily: fonts.heading.bold }}>{badge}</Text>
                </View>
              )}
            </View>
          </View>

          <View className="flex-row flex-wrap" style={{ gap: 8 }}>
            {(loading ? Array.from({ length: 4 }) : stats).map((s: any, i) => (
              <View key={i} style={{ width: "46%" }}>
                {loading ? (
                  <>
                    <View className="h-4 w-10 rounded mb-1" style={{ backgroundColor: colors.muted }} />
                    <View className="h-2 w-14 rounded" style={{ backgroundColor: colors.muted }} />
                  </>
                ) : (
                  <>
                    <Text
                      numberOfLines={1}
                      style={{
                        color: s.accent ?? colors.foreground,
                        fontFamily: fonts.heading.bold,
                        fontSize: 15,
                        letterSpacing: -0.3,
                      }}
                    >
                      {s.value}
                    </Text>
                    <View className="flex-row items-center gap-1 mt-0.5">
                      {s.icon && <s.icon size={8} color={colors.mutedForeground} />}
                      <Text
                        numberOfLines={1}
                        style={{ color: colors.mutedForeground, fontSize: 9.5, fontFamily: fonts.body.medium, flexShrink: 1 }}
                      >
                        {s.label}
                      </Text>
                    </View>
                  </>
                )}
              </View>
            ))}
          </View>
        </View>
      </View>
    </Pressable>
  );
}
