// RN port of the donut half of web's MaintenanceDashboard.tsx DonutCard —
// recharts' <PieChart>/<Pie> has no RN equivalent, so this draws the ring
// directly with react-native-svg (already a dependency): one <Circle> per
// non-zero segment, offset around the ring via strokeDasharray/
// strokeDashoffset, rotated -90° so the first segment starts at 12 o'clock
// — the same technique recharts itself uses under the hood.
import { View, Text } from "react-native";
import Svg, { Circle, G } from "react-native-svg";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";

export interface DonutPoint { name: string; value: number; color: string }

export function DonutChart({
  data, size = 140, strokeWidth = 22, formatValue = (n) => `${n}`,
}: {
  data: DonutPoint[]; size?: number; strokeWidth?: number; formatValue?: (n: number) => string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const segments = data.filter((d) => d.value > 0);

  let cumulative = 0;

  return (
    <View className="flex-row items-center gap-4">
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          <G rotation={-90} originX={size / 2} originY={size / 2}>
            {total === 0 ? (
              <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.muted} strokeWidth={strokeWidth} fill="none" />
            ) : (
              segments.map((d, i) => {
                const len = (d.value / total) * c;
                const offset = -cumulative;
                cumulative += len;
                return (
                  <Circle
                    key={i}
                    cx={size / 2}
                    cy={size / 2}
                    r={r}
                    stroke={d.color}
                    strokeWidth={strokeWidth}
                    strokeDasharray={`${len} ${c - len}`}
                    strokeDashoffset={offset}
                    strokeLinecap={segments.length > 1 ? "butt" : "round"}
                    fill="none"
                  />
                );
              })
            )}
          </G>
        </Svg>
      </View>

      <View style={{ gap: 8, flex: 1, minWidth: 0 }}>
        {data.map((d) => (
          <View key={d.name} className="flex-row items-center gap-2">
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: d.color, flexShrink: 0 }} />
            <Text numberOfLines={1} style={{ fontSize: 11, fontFamily: fonts.body.regular, color: colors.foreground, flexShrink: 1 }}>
              {d.name}
            </Text>
            <Text style={{ fontSize: 11, fontFamily: fonts.body.medium, color: colors.mutedForeground, marginLeft: "auto" }}>
              {formatValue(d.value)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
