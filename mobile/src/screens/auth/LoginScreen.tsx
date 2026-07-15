// RN version of src/pages/Login.tsx (web). Same brand identity — deep
// violet gradient, animated logo ring, typewriter tagline, glassy card,
// floating-label inputs — but rebuilt with RN's Animated API + expo-linear-
// gradient instead of framer-motion/backdrop-filter/mouse-tilt, none of
// which have a mobile equivalent. Hero copy, floating stat cards, and the
// crane SVG scene are intentionally left on web — they're desktop-width
// decoration, not something a phone screen has room for.
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Eye, EyeOff, AlertCircle } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { useTypewriter } from "@/hooks/useTypewriter";
import { FloatingLabelInput } from "@/components/FloatingLabelInput";
import { LogoRing } from "@/components/LogoRing";

function GlowBlob({ style }: { style: object }) {
  return (
    <View pointerEvents="none" style={[{ position: "absolute", borderRadius: 999 }, style]}>
      <LinearGradient
        colors={["rgba(124,58,237,0.35)", "rgba(124,58,237,0)"]}
        style={{ flex: 1, borderRadius: 999 }}
      />
    </View>
  );
}

function ShakeOnError({ trigger, children }: { trigger: unknown; children: React.ReactNode }) {
  const shake = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!trigger) return;
    shake.setValue(0);
    Animated.sequence([
      Animated.timing(shake, { toValue: 1, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -1, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0.6, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  }, [trigger, shake]);

  return (
    <Animated.View
      style={{
        transform: [{ translateX: shake.interpolate({ inputRange: [-1, 1], outputRange: [-6, 6] }) }],
      }}
    >
      {children}
    </Animated.View>
  );
}

export default function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorTick, setErrorTick] = useState(0);

  const tagline = useTypewriter(
    ["Built for Civil Contractors", "Project Insights at a Glance", "One Platform. Total Control."],
    60,
    2400,
  );

  const cardFade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(cardFade, { toValue: 1, duration: 500, useNativeDriver: true }).start();
  }, [cardFade]);

  const onSubmit = async () => {
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid email or password.");
      setErrorTick((t) => t + 1);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View className="flex-1" style={{ backgroundColor: "#0d0a1a" }}>
      <GlowBlob style={{ top: -80, left: -60, width: 260, height: 260 }} />
      <GlowBlob style={{ bottom: -100, right: -70, width: 300, height: 300 }} />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 20 }}
          keyboardShouldPersistTaps="handled"
        >
          <Animated.View
            style={{ opacity: cardFade, transform: [{ translateY: cardFade.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] }}
          >
            <View
              className="rounded-3xl p-6"
              style={{
                backgroundColor: "rgba(255,255,255,0.05)",
                borderWidth: 1,
                borderColor: "rgba(167,139,250,0.18)",
              }}
            >
              {/* Header */}
              <View className="items-center mb-7">
                <LogoRing size={80} />
                <Text
                  className="text-3xl font-bold mt-3"
                  style={{ color: "#c4b5fd", letterSpacing: -0.5 }}
                >
                  CivilierERP
                </Text>
                <View className="flex-row items-center gap-1.5 mt-2">
                  <View className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#a78bfa" }} />
                  <Text className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
                    {tagline}
                  </Text>
                </View>
              </View>

              {/* Form */}
              <View className="gap-4">
                <FloatingLabelInput
                  label="Email Address"
                  value={email}
                  onChangeText={(t) => {
                    setEmail(t);
                    setError(null);
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  textContentType="emailAddress"
                />

                <FloatingLabelInput
                  label="Password"
                  value={password}
                  onChangeText={(t) => {
                    setPassword(t);
                    setError(null);
                  }}
                  secureTextEntry={!showPass}
                  textContentType="password"
                  rightElement={
                    <Pressable onPress={() => setShowPass((v) => !v)} hitSlop={10} className="pr-2">
                      {showPass ? (
                        <EyeOff size={17} color="rgba(255,255,255,0.4)" />
                      ) : (
                        <Eye size={17} color="rgba(255,255,255,0.4)" />
                      )}
                    </Pressable>
                  }
                />

                {error && (
                  <ShakeOnError trigger={errorTick}>
                    <View
                      className="flex-row items-center gap-2 px-4 py-2.5 rounded-xl"
                      style={{ backgroundColor: "rgba(239,68,68,0.12)", borderWidth: 1, borderColor: "rgba(239,68,68,0.25)" }}
                    >
                      <AlertCircle size={14} color="#fca5a5" />
                      <Text className="text-sm flex-1" style={{ color: "#fca5a5" }}>
                        {error}
                      </Text>
                    </View>
                  </ShakeOnError>
                )}

                <Pressable
                  onPress={onSubmit}
                  disabled={loading || !email || !password}
                  style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}
                >
                  <LinearGradient
                    colors={loading || !email || !password ? ["#5b21b6", "#4c1d95"] : ["#7c3aed", "#5b21b6"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={{
                      borderRadius: 12,
                      paddingVertical: 14,
                      alignItems: "center",
                      opacity: loading || !email || !password ? 0.6 : 1,
                    }}
                  >
                    <Text className="text-white font-semibold text-sm">
                      {loading ? "Signing in…" : "Sign In"}
                    </Text>
                  </LinearGradient>
                </Pressable>
              </View>

              <Text className="text-center text-[10px] mt-5" style={{ color: "rgba(255,255,255,0.2)" }}>
                Secure access · Role-based permissions
              </Text>
            </View>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
