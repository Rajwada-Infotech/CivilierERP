// RN port of SupplierLogin.tsx's logo header (web) — two expanding/fading
// pulse rings plus one dashed ring rotating, around a white circle holding
// the real CivilierERP logo. Built with RN's Animated API since there's no
// framer-motion here.
import { useEffect, useRef } from "react";
import { Animated, Easing, Image, View } from "react-native";

function PulseRing({ size, delay, scaleTo }: { size: number; delay: number; scaleTo: number }) {
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

  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [1, scaleTo] });
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
        borderColor: "rgba(5,150,105,0.25)",
        opacity,
        transform: [{ scale }],
      }}
    />
  );
}

function DashedRing({ size, duration }: { size: number; duration: number }) {
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(spin, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true }),
    ).start();
  }, [spin, duration]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 1.5,
        borderColor: "rgba(5,150,105,0.25)",
        borderStyle: "dashed",
        transform: [{ rotate }],
      }}
    />
  );
}

export function SupplierLogoRing({ size = 64 }: { size?: number }) {
  return (
    <View style={{ width: size + 24, height: size + 24 }} className="items-center justify-center">
      <PulseRing size={size} delay={0} scaleTo={1.6} />
      <PulseRing size={size} delay={700} scaleTo={1.8} />
      <DashedRing size={size + 6} duration={20000} />
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: "#fff",
          borderWidth: 1,
          borderColor: "#f1f5f9",
          overflow: "hidden",
          alignItems: "center",
          justifyContent: "center",
          shadowColor: "#000",
          shadowOpacity: 0.12,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 4 },
          elevation: 4,
        }}
      >
        <Image
          source={require("../../assets/branding/Civilier.png")}
          style={{ width: size * 0.75, height: size * 0.75 }}
          resizeMode="contain"
        />
      </View>
    </View>
  );
}
