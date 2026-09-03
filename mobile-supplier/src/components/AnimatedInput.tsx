// RN port of SupplierLogin.tsx's AnimatedInput (web) — floating label that
// rises and shrinks on focus/value, a focus ring instead of a plain border,
// and a bottom highlight line while focused. Light theme (slate text on a
// near-white field), unlike the app's other (dark) FloatingLabelInput —
// this screen is a standalone light page, same as the web version.
import { useRef, useState } from "react";
import { Animated, TextInput, View, type TextInputProps } from "react-native";
import { fonts } from "@/theme/fonts";

interface AnimatedInputProps extends Omit<TextInputProps, "placeholder"> {
  label: string;
  value: string;
  placeholder: string;
  rightElement?: React.ReactNode;
}

export function AnimatedInput({
  label,
  value,
  placeholder,
  rightElement,
  onFocus,
  onBlur,
  ...inputProps
}: AnimatedInputProps) {
  const [focused, setFocused] = useState(false);
  const anim = useRef(new Animated.Value(value ? 1 : 0)).current;
  const active = focused || value.length > 0;

  const animateTo = (toValue: number) => {
    Animated.timing(anim, { toValue, duration: 180, useNativeDriver: false }).start();
  };

  return (
    <View className="relative">
      <Animated.Text
        pointerEvents="none"
        className="absolute left-4 z-10"
        style={{
          color: focused ? "#059669" : "rgba(100,116,139,0.8)",
          top: anim.interpolate({ inputRange: [0, 1], outputRange: [18, 6] }),
          fontSize: anim.interpolate({ inputRange: [0, 1], outputRange: [13, 9] }),
          letterSpacing: active ? 0.8 : 0,
          fontFamily: fonts.body.medium,
        }}
      >
        {label}
      </Animated.Text>
      <View
        style={{
          borderRadius: 12,
          borderWidth: focused ? 2 : 1.5,
          borderColor: focused ? "rgba(5,150,105,0.35)" : "rgba(203,213,225,0.8)",
          backgroundColor: focused ? "rgba(255,255,255,0.98)" : "rgba(248,250,252,0.9)",
          overflow: "hidden",
        }}
      >
        <TextInput
          value={value}
          placeholder={focused ? placeholder : ""}
          placeholderTextColor="rgba(148,163,184,0.6)"
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
          className="px-4 pt-6 pb-2.5 text-sm text-slate-800"
          style={{ fontFamily: fonts.body.regular }}
          {...inputProps}
        />
      </View>
      {rightElement && (
        <View className="absolute right-2 top-0 bottom-0 justify-center">{rightElement}</View>
      )}
    </View>
  );
}
