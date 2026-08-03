// RN equivalent of the web login's AnimatedInput (src/pages/Login.tsx) —
// same floating-label-on-focus/value behavior, built with RN's Animated API
// instead of framer-motion since there's no DOM/CSS layer here.
import { useRef, useState } from "react";
import { Animated, TextInput, View, type TextInputProps } from "react-native";
import { fonts } from "@/theme/fonts";

interface FloatingLabelInputProps extends Omit<TextInputProps, "placeholder"> {
  label: string;
  value: string;
  rightElement?: React.ReactNode;
}

export function FloatingLabelInput({
  label,
  value,
  rightElement,
  onFocus,
  onBlur,
  ...inputProps
}: FloatingLabelInputProps) {
  const [focused, setFocused] = useState(false);
  const anim = useRef(new Animated.Value(value ? 1 : 0)).current;

  const animateTo = (toValue: number) => {
    Animated.timing(anim, { toValue, duration: 180, useNativeDriver: false }).start();
  };

  const active = focused || value.length > 0;

  return (
    <View className="relative">
      <Animated.Text
        pointerEvents="none"
        className="absolute left-4 z-10"
        style={{
          color: focused ? "#c4b5fd" : "rgba(255,255,255,0.35)",
          top: anim.interpolate({ inputRange: [0, 1], outputRange: [18, 6] }),
          fontSize: anim.interpolate({ inputRange: [0, 1], outputRange: [13, 9] }),
          letterSpacing: active ? 0.8 : 0,
          fontFamily: fonts.body.medium,
        }}
      >
        {label}
      </Animated.Text>
      <TextInput
        value={value}
        placeholderTextColor="rgba(255,255,255,0.25)"
        onFocus={(e) => {
          setFocused(true);
          animateTo(1);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          animateTo(value ? 1 : 0);
          onBlur?.(e);
        }}
        className="rounded-xl px-4 pt-6 pb-2.5 text-sm text-white/90"
        style={{
          backgroundColor: focused ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)",
          borderWidth: 1.5,
          borderColor: focused ? "rgba(167,139,250,0.6)" : "rgba(255,255,255,0.10)",
          fontFamily: fonts.body.regular,
        }}
        {...inputProps}
      />
      {rightElement && (
        <View className="absolute right-2 top-0 bottom-0 justify-center">{rightElement}</View>
      )}
    </View>
  );
}
