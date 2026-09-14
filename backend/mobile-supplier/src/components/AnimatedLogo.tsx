// RN port of src/components/Logo.tsx's LogoFull (web) — same three
// animations: the icon spring-entrances in on mount (rotate -180°→0°,
// scale 0→1, opacity 0→1), the wordmark is a purple→blue gradient (web's
// .gradient-text, hsl(263 70% 58%) → hsl(217 91% 60%) in the dark theme —
// approximated here as violet-500 → blue-500), and the version line
// "matrix-scrambles" between "app. vX" and "db. vX" every 5s, each
// character resolving left-to-right through random glyphs before landing.
import { useEffect, useRef, useState } from "react";
import { Animated, Image, Text, View } from "react-native";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { fonts } from "@/theme/fonts";
import { useAppVersion } from "@/hooks/useAppVersion";

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%&";
const rand = () => CHARS[Math.floor(Math.random() * CHARS.length)];

function useMatrixCycle(targets: string[]) {
  const [display, setDisplay] = useState(targets[0] ?? "");
  const frameRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cycleRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const allReady = targets.every((t) => t && t !== "…");
    if (!allReady) return;

    const scrambleTo = (target: string) => {
      const steps = 8;
      let step = 0;
      const tick = () => {
        step++;
        setDisplay(
          target
            .split("")
            .map((char, i) => {
              if (i < Math.floor((step / steps) * target.length)) return char;
              if (char === "." || char === " " || char === "/") return char;
              return rand();
            })
            .join(""),
        );
        if (step < steps + target.length) {
          frameRef.current = setTimeout(tick, 45);
        } else {
          setDisplay(target);
        }
      };
      tick();
    };

    setDisplay(targets[0]);
    const init = setTimeout(() => scrambleTo(targets[0]), 800);

    let currentIdx = 0;
    cycleRef.current = setInterval(() => {
      currentIdx = (currentIdx + 1) % targets.length;
      scrambleTo(targets[currentIdx]);
    }, 5000);

    return () => {
      clearTimeout(init);
      if (frameRef.current) clearTimeout(frameRef.current);
      if (cycleRef.current) clearInterval(cycleRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targets.join("|")]);

  return display;
}

function AnimatedLogoIcon({ size = 32 }: { size?: number }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(t, { toValue: 1, useNativeDriver: true, stiffness: 320, damping: 22 }).start();
  }, [t]);

  const rotate = t.interpolate({ inputRange: [0, 1], outputRange: ["-180deg", "0deg"] });

  return (
    <Animated.Image
      source={require("../../assets/branding/Civilier.png")}
      style={{ width: size, height: size, borderRadius: size * 0.22, opacity: t, transform: [{ rotate }, { scale: t }] }}
    />
  );
}

export function AnimatedLogo({ iconSize = 32 }: { iconSize?: number }) {
  const { appVersion, dbVersion, isLoading } = useAppVersion();

  const normalise = (v: string) => (v === "…" || v === "—" ? v : v.startsWith("v") ? v : `v${v}`);
  const appLabel = normalise(appVersion ?? "…");
  const dbLabel = normalise(dbVersion ?? "…");
  const targets = [
    appLabel === "…" || dbLabel === "…" ? "…" : `app. ${appLabel}`,
    appLabel === "…" || dbLabel === "…" ? "…" : `db. ${dbLabel}`,
  ];
  const display = useMatrixCycle(targets);

  return (
    <View className="flex-row items-center gap-2">
      <AnimatedLogoIcon size={iconSize} />
      <View>
        <MaskedView maskElement={<Text style={{ fontSize: 15, fontFamily: fonts.heading.bold, letterSpacing: -0.3 }}>CivilierERP</Text>}>
          <LinearGradient colors={["#8b5cf6", "#3b82f6"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
            <Text style={{ fontSize: 15, fontFamily: fonts.heading.bold, letterSpacing: -0.3, opacity: 0 }}>CivilierERP</Text>
          </LinearGradient>
        </MaskedView>
        <Text style={{ color: "rgba(16,185,129,0.8)", fontSize: 10, fontFamily: fonts.body.medium, letterSpacing: 0.4 }}>
          {isLoading ? "…" : display}
        </Text>
      </View>
    </View>
  );
}
