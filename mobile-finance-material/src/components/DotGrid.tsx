// RN port of the web login's dot-grid background
// (backgroundImage: radial-gradient(circle, rgba(167,139,250,0.07) 1px, transparent 1px))
// — CSS repeating-radial-gradient has no RN equivalent, so this tiles a
// small SVG pattern instead.
import Svg, { Circle, Pattern, Rect } from "react-native-svg";

export function DotGrid({ width, height }: { width: number; height: number }) {
  return (
    <Svg width={width} height={height} style={{ position: "absolute", top: 0, left: 0 }}>
      <Pattern id="dotgrid" width={28} height={28} patternUnits="userSpaceOnUse">
        <Circle cx={1} cy={1} r={1} fill="rgba(167,139,250,0.16)" />
      </Pattern>
      <Rect width={width} height={height} fill="url(#dotgrid)" />
    </Svg>
  );
}
