// RN port of the web login's LogoRing (src/pages/Login.tsx) — three
// expanding/fading pulse rings, a dashed ring rotating one way, a dotted
// ring rotating the other, around the real CivilierERP logo. Built with
// RN's Animated API since there's no framer-motion here.
import { useEffect, useRef } from "react";
import { Animated, Easing, Image, View } from "react-native";

function PulseRing({ size, delay }: { size: number; delay: number }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, { toValue: 1, duration: 2500, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [anim, delay]);

  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] });
  const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] });

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 1,
        borderColor: "rgba(124,58,237,0.3)",
        opacity,
        transform: [{ scale }],
      }}
    />
  );
}

function RotatingRing({ size, duration, dashed, reverse }: { size: number; duration: number; dashed?: boolean; reverse?: boolean }) {
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(spin, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true }),
    ).start();
  }, [spin, duration]);

  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: reverse ? ["360deg", "0deg"] : ["0deg", "360deg"],
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 1.2,
        borderColor: dashed ? "rgba(124,58,237,0.35)" : "rgba(167,139,250,0.45)",
        borderStyle: dashed ? "dashed" : "dotted",
        transform: [{ rotate }],
      }}
    />
  );
}

export function LogoRing({ size = 84 }: { size?: number }) {
  return (
    <View style={{ width: size + 16, height: size + 16 }} className="items-center justify-center">
      <PulseRing size={size} delay={0} />
      <PulseRing size={size} delay={800} />
      <PulseRing size={size} delay={1600} />
      <RotatingRing size={size + 6} duration={20000} dashed />
      <RotatingRing size={size + 16} duration={15000} reverse />
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          overflow: "hidden",
          shadowColor: "#7c3aed",
          shadowOpacity: 0.4,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 8 },
        }}
      >
        <Image
          source={require("../../assets/branding/Civilier.png")}
          style={{ width: "100%", height: "100%" }}
          resizeMode="cover"
        />
      </View>
    </View>
  );
}
