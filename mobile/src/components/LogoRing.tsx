// RN port of the web login's LogoRing (src/pages/Login.tsx) — a slow
// rotating dashed ring behind the app icon. Framer Motion's per-ring pulse
// is simplified to one continuous rotation, which reads just as well at
// mobile scale without three overlapping infinite-loop animations.
import { useEffect, useRef } from "react";
import { Animated, Easing, Image, View } from "react-native";

export function LogoRing({ size = 84 }: { size?: number }) {
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 20000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    ).start();
  }, [spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  return (
    <View style={{ width: size, height: size }} className="items-center justify-center">
      <Animated.View
        style={{
          position: "absolute",
          width: size + 12,
          height: size + 12,
          borderRadius: (size + 12) / 2,
          borderWidth: 1.5,
          borderColor: "rgba(124,58,237,0.35)",
          borderStyle: "dashed",
          transform: [{ rotate }],
        }}
      />
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          overflow: "hidden",
          borderWidth: 2,
          borderColor: "rgba(167,139,250,0.4)",
          shadowColor: "#7c3aed",
          shadowOpacity: 0.4,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
        }}
      >
        <Image source={require("../../assets/icon.png")} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
      </View>
    </View>
  );
}
