// RN port of the web login's FloatingParticles — brick/bolt/triangle
// outline icons drifting upward on loop (src/pages/Login.tsx). Trimmed from
// 10 to 7 particles for mobile perf; same visual language.
import { useEffect, useRef } from "react";
import { Animated, Dimensions, Easing, View } from "react-native";
import Svg, { Circle, Line, Polygon, Rect } from "react-native-svg";

const { height: SCREEN_H } = Dimensions.get("window");

const PARTICLES = [
  { x: "8%", delay: 0, dur: 6000, type: "brick" },
  { x: "18%", delay: 1500, dur: 7000, type: "bolt" },
  { x: "78%", delay: 800, dur: 5500, type: "brick" },
  { x: "88%", delay: 2000, dur: 8000, type: "triangle" },
  { x: "50%", delay: 3000, dur: 6500, type: "bolt" },
  { x: "35%", delay: 1000, dur: 7500, type: "brick" },
  { x: "65%", delay: 2500, dur: 5000, type: "triangle" },
] as const;

function ParticleIcon({ type }: { type: string }) {
  if (type === "bolt") {
    return (
      <Svg width={12} height={12} viewBox="0 0 12 12">
        <Polygon points="6,1 10.2,3.5 10.2,8.5 6,11 1.8,8.5 1.8,3.5" fill="none" stroke="rgba(167,139,250,0.55)" strokeWidth={1} />
        <Circle cx={6} cy={6} r={2} fill="none" stroke="rgba(167,139,250,0.4)" strokeWidth={0.8} />
      </Svg>
    );
  }
  if (type === "triangle") {
    return (
      <Svg width={13} height={12} viewBox="0 0 13 12">
        <Polygon points="6.5,1 12,11 1,11" fill="none" stroke="rgba(167,139,250,0.5)" strokeWidth={1} />
        <Line x1={6.5} y1={6} x2={6.5} y2={11} stroke="rgba(167,139,250,0.35)" strokeWidth={0.7} />
      </Svg>
    );
  }
  return (
    <Svg width={14} height={10} viewBox="0 0 14 10">
      <Rect width={14} height={10} rx={1} fill="none" stroke="rgba(167,139,250,0.6)" strokeWidth={1.2} />
      <Line x1={7} y1={0} x2={7} y2={10} stroke="rgba(167,139,250,0.4)" strokeWidth={0.8} />
      <Line x1={0} y1={5} x2={14} y2={5} stroke="rgba(167,139,250,0.4)" strokeWidth={0.8} />
    </Svg>
  );
}

function Particle({ x, delay, dur, type }: (typeof PARTICLES)[number]) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, { toValue: 1, duration: dur, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [anim, delay, dur]);

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [0, -SCREEN_H * 0.55] });
  const opacity = anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0.5, 0] });

  return (
    <Animated.View style={{ position: "absolute", bottom: 0, left: x, opacity, transform: [{ translateY }] }}>
      <ParticleIcon type={type} />
    </Animated.View>
  );
}

export function FloatingParticles() {
  return (
    <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, overflow: "hidden" }}>
      {PARTICLES.map((p, i) => (
        <Particle key={i} {...p} />
      ))}
    </View>
  );
}
