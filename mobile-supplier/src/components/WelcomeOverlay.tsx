// RN port of SupplierLogin.tsx's WelcomeCard (web), on the drawing sheet: a small sheet over the page with a tick,
// "Welcome back" and a ruled bar that fills for the ~1.8s between a successful login and the navigator swapping over to
// MainStack (see AuthContext.tsx's onAuthenticated/navHoldMs — the delay this fills is real, not decorative: it's
// giving the credential-verified-but-not-yet-navigated window something to show).
import { useEffect, useRef } from "react";
import { Animated, Text, View } from "react-native";
import { Check } from "lucide-react-native";
import { Body, Label, SheetFrame } from "@/components/sheet/Sheet";
import { colors, sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";

export function WelcomeOverlay({ name, durationMs }: { name?: string; durationMs: number }) {
  const firstName = name?.trim().split(/\s+/)[0] || "";
  const fade = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(14)).current;
  const bar = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 250, useNativeDriver: true }).start();
    Animated.timing(rise, { toValue: 0, duration: 350, useNativeDriver: true }).start();
    Animated.sequence([
      Animated.delay(250),
      Animated.timing(bar, { toValue: 1, duration: Math.max(400, durationMs - 450), useNativeDriver: false }),
    ]).start();
  }, [fade, rise, bar, durationMs]);

  return (
    <Animated.View
      style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: `${colors.background}ee`, opacity: fade, padding: 24 }}
    >
      <Animated.View style={{ width: "100%", maxWidth: 340, transform: [{ translateY: rise }] }}>
        <SheetFrame>
          <View style={{ padding: 20, gap: 14, alignItems: "flex-start" }}>
            <View style={{ width: 34, height: 34, borderWidth: 1.5, borderColor: S.ink, backgroundColor: S.blue, alignItems: "center", justifyContent: "center" }}>
              <Check size={18} color="#ffffff" strokeWidth={3} />
            </View>
            <View style={{ gap: 6 }}>
              <Label>Signed in</Label>
              <Text style={{ fontFamily: fonts.heading.bold, fontSize: 22, letterSpacing: -0.6, color: S.ink }}>
                Welcome back{firstName ? `, ${firstName}` : ""}
              </Text>
              <Body size={13} color={S.ink2}>Taking you to your supplier portal…</Body>
            </View>
            <View style={{ width: "100%", height: 5, borderWidth: 1, borderColor: S.ink }}>
              <Animated.View style={{ height: "100%", backgroundColor: S.ink, width: bar.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) }} />
            </View>
          </View>
        </SheetFrame>
      </Animated.View>
    </Animated.View>
  );
}
