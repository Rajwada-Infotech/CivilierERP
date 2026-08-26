// Reusable entrance animation — RN Animated port of the staggered
// framer-motion `initial={{opacity:0,y:...}} animate={{opacity:1,y:0}}`
// pattern used throughout the web app (Login.tsx, Home.tsx's hero/module
// cards/feed items). One component instead of repeating the same
// useRef+useEffect+interpolate boilerplate at every call site.
import { useEffect, useRef } from "react";
import { Animated, Easing } from "react-native";

export function FadeSlideIn({
  children,
  delay = 0,
  distance = 16,
  duration = 420,
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  distance?: number;
  duration?: number;
  style?: object;
}) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [anim, delay, duration]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: anim,
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
