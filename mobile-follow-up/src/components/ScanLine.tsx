// RN port of the web login's ScanLine — a faint horizontal line that
// sweeps top-to-bottom on a slow loop (src/pages/Login.tsx).
import { useEffect, useRef } from "react";
import { Animated, Easing } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

export function ScanLine({ height }: { height: number }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 14000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    ).start();
  }, [progress]);

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [0, height] });

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        height: 1,
        transform: [{ translateY }],
      }}
    >
      <LinearGradient
        colors={["transparent", "rgba(124,58,237,0.25)", "rgba(167,139,250,0.5)", "rgba(124,58,237,0.25)", "transparent"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ flex: 1 }}
      />
    </Animated.View>
  );
}
