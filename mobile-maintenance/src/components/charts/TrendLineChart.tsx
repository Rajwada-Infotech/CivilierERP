// RN port of web's MaintenanceDashboard.tsx TrendCard (recharts <LineChart>)
// — same 14-day billing-amount line, drawn directly with react-native-svg
// since recharts has no RN equivalent. Width is measured via onLayout (RN
// SVG isn't percentage-responsive the way recharts' ResponsiveContainer is).
import { useState } from "react";
import { View, Text, LayoutChangeEvent } from "react-native";
import Svg, { Polyline, Circle, Line as SvgLine, Text as SvgText } from "react-native-svg";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatCompactINR } from "@/utils/formatCurrency";

export interface TrendPoint { date: string; amount: number }

const HEIGHT = 160;
const PAD_LEFT = 34;
const PAD_RIGHT = 8;
const PAD_TOP = 12;
const PAD_BOTTOM = 20;

const fmtAxisDate = (d: string) =>
  new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

export function TrendLineChart({ data, color = "#65a30d" }: { data: TrendPoint[]; color?: string }) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const hasData = data.some((d) => d.amount > 0);
  const max = Math.max(1, ...data.map((d) => d.amount));

  const plotW = Math.max(0, width - PAD_LEFT - PAD_RIGHT);
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const stepX = data.length > 1 ? plotW / (data.length - 1) : 0;

  const points = data.map((d, i) => ({
    x: PAD_LEFT + i * stepX,
    y: PAD_TOP + plotH - (d.amount / max) * plotH,
    d,
  }));

  // Every ~4th x-axis label, same crowding-avoidance idea as web's
  // interval={Math.floor(data.length / 6) - 1}.
  const labelEvery = Math.max(1, Math.ceil(data.length / 4));

  return (
    <View onLayout={onLayout} style={{ height: HEIGHT }}>
      {width === 0 ? null : !hasData ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>
            No billing activity in the last 14 days
          </Text>
        </View>
      ) : (
        <Svg width={width} height={HEIGHT}>
          {/* Gridlines + Y-axis labels: 0, mid, max */}
          {[0, 0.5, 1].map((f) => {
            const y = PAD_TOP + plotH - f * plotH;
            return (
              <SvgLine
                key={f}
                x1={PAD_LEFT}
                x2={width - PAD_RIGHT}
                y1={y}
                y2={y}
                stroke={colors.border}
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            );
          })}
          <SvgText x={2} y={PAD_TOP + 4} fontSize={9} fill={colors.mutedForeground}>{formatCompactINR(max)}</SvgText>
          <SvgText x={2} y={PAD_TOP + plotH / 2 + 4} fontSize={9} fill={colors.mutedForeground}>{formatCompactINR(max / 2)}</SvgText>
          <SvgText x={2} y={PAD_TOP + plotH + 4} fontSize={9} fill={colors.mutedForeground}>0</SvgText>

          {/* Line */}
          <Polyline
            points={points.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {points.map((p, i) => (
            <Circle key={i} cx={p.x} cy={p.y} r={p.d.amount > 0 ? 2.5 : 0} fill={color} />
          ))}

          {/* X-axis date labels */}
          {points.map((p, i) => {
            if (i % labelEvery !== 0 && i !== points.length - 1) return null;
            return (
              <SvgText
                key={i}
                x={Math.min(Math.max(p.x, PAD_LEFT), width - PAD_RIGHT - 24)}
                y={HEIGHT - 4}
                fontSize={9}
                fill={colors.mutedForeground}
              >
                {fmtAxisDate(p.d.date)}
              </SvgText>
            );
          })}
        </Svg>
      )}
    </View>
  );
}
