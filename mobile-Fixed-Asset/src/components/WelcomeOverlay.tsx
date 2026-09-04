// RN port of SupplierLogin.tsx's WelcomeCard (web) — full-screen blur-in
// overlay with a checkmark badge, "Welcome back" copy, and a filling
// progress bar, shown for ~1.8s between a successful login and the
// navigator swapping over to MainStack (see AuthContext.tsx's
// onAuthenticated/navHoldMs — the delay this overlay fills is real, not
// decorative: it's giving the credential-verified-but-not-yet-navigated
// window something to show).
import { useEffect, useRef } from "react";
import { Animated, Text, View } from "react-native";
import { Check } from "lucide-react-native";
import { fonts } from "@/theme/fonts";

export function WelcomeOverlay({ name, durationMs }: { name?: string; durationMs: number }) {
  const firstName = name?.trim().split(/\s+/)[0] || "";
  const fade = useRef(new Animated.Value(0)).current;
  const cardScale = useRef(new Animated.Value(0.92)).current;
  const cardY = useRef(new Animated.Value(24)).current;
  const badgeScale = useRef(new Animated.Value(0)).current;
  const textFade = useRef(new Animated.Value(0)).current;
  const barWidth = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 250, useNativeDriver: true }).start();
    Animated.spring(cardScale, { toValue: 1, friction: 9, tension: 90, useNativeDriver: true }).start();
    Animated.spring(cardY, { toValue: 0, friction: 9, tension: 90, useNativeDriver: true }).start();
    Animated.sequence([
      Animated.delay(100),
      Animated.spring(badgeScale, { toValue: 1, friction: 8, tension: 140, useNativeDriver: true }),
    ]).start();
    Animated.sequence([
      Animated.delay(300),
      Animated.timing(textFade, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();
    Animated.sequence([
      Animated.delay(300),
      Animated.timing(barWidth, { toValue: 1, duration: Math.max(400, durationMs - 500), useNativeDriver: false }),
    ]).start();
  }, [fade, cardScale, cardY, badgeScale, textFade, barWidth, durationMs]);

  return (
    <Animated.View
      style={{
        position: "absolute",
        inset: 0,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.88)",
        opacity: fade,
      }}
    >
      <Animated.View
        style={{
          alignItems: "center",
          gap: 16,
          paddingHorizontal: 40,
          paddingVertical: 32,
          borderRadius: 24,
          backgroundColor: "#fff",
          borderWidth: 1,
          borderColor: "rgba(5,150,105,0.15)",
          shadowColor: "#ca8a04",
          shadowOpacity: 0.18,
          shadowRadius: 32,
          shadowOffset: { width: 0, height: 12 },
          elevation: 10,
          transform: [{ scale: cardScale }, { translateY: cardY }],
        }}
      >
        <Animated.View
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#ca8a04",
            transform: [{ scale: badgeScale }],
          }}
        >
          <Check size={22} color="#fff" strokeWidth={3} />
        </Animated.View>
        <Animated.View style={{ alignItems: "center", opacity: textFade }}>
          <Text style={{ fontSize: 20, fontFamily: fonts.heading.bold, color: "#1e293b" }}>
            Welcome back{firstName ? `, ${firstName}` : ""}!
          </Text>
          <Text style={{ fontSize: 13, fontFamily: fonts.body.regular, color: "#94a3b8", marginTop: 4 }}>
            Taking you to your supplier portal…
          </Text>
        </Animated.View>
        <View style={{ width: 190, height: 4, borderRadius: 2, backgroundColor: "#f1f5f9", overflow: "hidden" }}>
          <Animated.View
            style={{
              height: "100%",
              borderRadius: 2,
              backgroundColor: "#eab308",
              width: barWidth.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }),
            }}
          />
        </View>
      </Animated.View>
    </Animated.View>
  );
}
