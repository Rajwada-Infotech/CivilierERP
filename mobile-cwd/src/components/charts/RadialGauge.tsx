// A single progress ring — the "how full is this" gauge the Security
// Attendance Overview's hero tile is built around. Same SVG technique as
// DonutChart (a stroked Circle offset via strokeDasharray/
// strokeDashoffset, rotated -90° so it starts at 12 o'clock), just one
// segment instead of several, with the value lettered directly in the
// centre.
import { View, Text } from "react-native";
import Svg, { Circle, G } from "react-native-svg";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";

export function RadialGauge({
  progress, size = 108, strokeWidth = 12, color, trackColor,
  centerValue, centerLabel,
}: {
  progress: number; // 0..1
  size?: number;
  strokeWidth?: number;
  color: string;
  trackColor?: string;
  centerValue: string;
  centerLabel?: string;
}) {
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, progress));
  const len = pct * c;

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <G rotation={-90} originX={size / 2} originY={size / 2}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={trackColor ?? colors.muted} strokeWidth={strokeWidth} fill="none" />
          {pct > 0 && (
            <Circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              stroke={color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${len} ${c - len}`}
              strokeLinecap="round"
              fill="none"
            />
          )}
        </G>
      </Svg>
      <Text style={{ color: colors.foreground, fontSize: size * 0.24, fontFamily: fonts.heading.bold }}>{centerValue}</Text>
      {!!centerLabel && (
        <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.heading.semibold, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 1 }}>
          {centerLabel}
        </Text>
      )}
    </View>
  );
}
