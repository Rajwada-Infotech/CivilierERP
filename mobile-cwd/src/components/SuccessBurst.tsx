// Full-screen "something just happened" moment — a colored ring + check
// scale-pops and fades over whatever list is underneath. First built for
// Security Attendance's check-in/out (see AttendanceScreen.tsx), pulled
// out here so any module's own accent color can reuse the same beat:
// pair it with a LayoutAnimation.configureNext() call right before the
// state change that reshuffles the list, so the burst masks the reflow
// instead of racing it.
import { useEffect, useRef } from "react";
import { View, Text, Animated } from "react-native";
import { CheckCircle2 } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";

export function SuccessBurst({ visible, label, color, ink = "#0a1120" }: {
  visible: boolean; label: string; color: string; ink?: string;
}) {
  const scale = useRef(new Animated.Value(0)).current;
  const ringScale = useRef(new Animated.Value(0.6)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    scale.setValue(0);
    ringScale.setValue(0.6);
    opacity.setValue(0);
    Animated.sequence([
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 120, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, stiffness: 280, damping: 14 }),
        Animated.timing(ringScale, { toValue: 1.9, duration: 700, useNativeDriver: true }),
      ]),
      Animated.timing(opacity, { toValue: 0, duration: 260, delay: 350, useNativeDriver: true }),
    ]).start();
  }, [visible]);

  if (!visible) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", zIndex: 50, opacity }}
    >
      <View style={{ width: 96, height: 96, alignItems: "center", justifyContent: "center" }}>
        <Animated.View
          style={{
            position: "absolute", width: 96, height: 96, borderRadius: 48,
            borderWidth: 2, borderColor: color, opacity: 0.5,
            transform: [{ scale: ringScale }],
          }}
        />
        <Animated.View
          style={{
            width: 68, height: 68, borderRadius: 34, backgroundColor: ink,
            borderWidth: 2, borderColor: color, alignItems: "center", justifyContent: "center",
            transform: [{ scale }],
            shadowColor: color, shadowOpacity: 0.6, shadowRadius: 16, shadowOffset: { width: 0, height: 0 },
            elevation: 8,
          }}
        >
          <CheckCircle2 size={30} color={color} />
        </Animated.View>
      </View>
      <Text style={{ marginTop: 12, color: colors.foreground, fontSize: 12.5, fontFamily: fonts.heading.semibold, textAlign: "center", paddingHorizontal: 24 }}>
        {label}
      </Text>
    </Animated.View>
  );
}
