// RN port of SupplierLogin.tsx's ShimmerButton (web) — emerald gradient
// button with a diagonal shimmer sweep. The web version only mounts the
// shimmer stripe while actively hovered; RN has no hover, so it mounts it
// only while actively animating after a press-in instead (never sits
// around at rest, which is what left a faded band visible on the button
// permanently before this fix), plus a small press-scale for feedback.
import { useRef, useState } from "react";
import { Animated, Pressable, Text, Easing, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { fonts } from "@/theme/fonts";

export function ShimmerButton({
  children,
  disabled,
  onPress,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onPress?: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const shimmer = useRef(new Animated.Value(0)).current;
  const [shimmering, setShimmering] = useState(false);
  const [buttonWidth, setButtonWidth] = useState(0);

  const runShimmer = () => {
    setShimmering(true);
    shimmer.setValue(0);
    Animated.timing(shimmer, { toValue: 1, duration: 550, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(
      ({ finished }) => finished && setShimmering(false),
    );
  };

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => {
        if (disabled) return;
        Animated.spring(scale, { toValue: 0.97, useNativeDriver: true }).start();
        runShimmer();
      }}
      onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: true }).start()}
    >
      <Animated.View
        onLayout={(e) => setButtonWidth(e.nativeEvent.layout.width)}
        style={{
          transform: [{ scale }],
          borderRadius: 12,
          overflow: "hidden",
          opacity: disabled ? 0.6 : 1,
          shadowColor: "#059669",
          shadowOpacity: 0.35,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 6 },
          elevation: 6,
        }}
      >
        <LinearGradient
          colors={["#059669", "#047857"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ paddingVertical: 14, alignItems: "center", justifyContent: "center" }}
        >
          {shimmering && buttonWidth > 0 && (
            <Animated.View
              pointerEvents="none"
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                width: 60,
                backgroundColor: "rgba(255,255,255,0.22)",
                transform: [
                  {
                    translateX: shimmer.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-80, buttonWidth + 80],
                    }),
                  },
                  { skewX: "-20deg" },
                ],
              }}
            />
          )}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {typeof children === "string" ? (
              <Text style={{ color: "#fff", fontSize: 14, fontFamily: fonts.body.semibold }}>{children}</Text>
            ) : (
              children
            )}
          </View>
        </LinearGradient>
      </Animated.View>
    </Pressable>
  );
}
