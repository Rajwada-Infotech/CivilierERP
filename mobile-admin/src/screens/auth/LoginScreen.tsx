// RN port of src/pages/Login.tsx (web), matching what the web app itself
// renders at its own mobile breakpoint: the left hero column (headline,
// crane scene, floating stat cards) is `hidden lg:flex` there too, so a
// faithful mobile port is the background effects + the login card, full
// screen, centered — not a shrunk-down version of the desktop split layout.
// Built with RN's Animated API + expo-linear-gradient + react-native-svg
// instead of framer-motion/backdrop-filter/mouse-tilt, none of which exist
// on a touch device.
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Eye, EyeOff, AlertCircle, Truck, Building2, ArrowUpRight } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { useTypewriter } from "@/hooks/useTypewriter";
import { FloatingLabelInput } from "@/components/FloatingLabelInput";
import { LogoRing } from "@/components/LogoRing";
import { GradientText } from "@/components/GradientText";
import { DotGrid } from "@/components/DotGrid";
import { ScanLine } from "@/components/ScanLine";
import { FloatingParticles } from "@/components/FloatingParticles";
import { PasswordStrength } from "@/components/PasswordStrength";
import { fonts } from "@/theme/fonts";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

function GlowBlob({ style, colors }: { style: object; colors: [string, string] }) {
  return (
    <View pointerEvents="none" style={[{ position: "absolute", borderRadius: 999, overflow: "hidden" }, style]}>
      <LinearGradient colors={colors} style={{ flex: 1 }} />
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
      style={{ transform: [{ translateX: shake.interpolate({ inputRange: [-1, 1], outputRange: [-6, 6] }) }] }}
    >
      {children}
    </Animated.View>
  );
}

function BlueprintCorners() {
  const corner = "absolute w-5 h-5 border-violet-400/60";
  return (
    <>
      <View className={`${corner} top-0 left-0 border-t-2 border-l-2 rounded-tl-2xl`} />
      <View className={`${corner} top-0 right-0 border-t-2 border-r-2 rounded-tr-2xl`} />
      <View className={`${corner} bottom-0 left-0 border-b-2 border-l-2 rounded-bl-2xl`} />
      <View className={`${corner} bottom-0 right-0 border-b-2 border-r-2 rounded-br-2xl`} />
    </>
  );
}

function PortalButton({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-1 rounded-xl p-3"
      style={{ backgroundColor: "rgba(139,92,246,0.06)", borderWidth: 1, borderColor: "rgba(139,92,246,0.18)" }}
    >
      <View className="flex-row items-center justify-between mb-2">
        <View className="w-7 h-7 rounded-lg items-center justify-center" style={{ backgroundColor: "rgba(139,92,246,0.15)" }}>
          {icon}
        </View>
        <ArrowUpRight size={13} color="rgba(255,255,255,0.2)" />
      </View>
      <Text className="text-xs" style={{ color: "rgba(255,255,255,0.8)", fontFamily: fonts.body.semibold }}>
        {title}
      </Text>
      <Text className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)", fontFamily: fonts.body.regular }}>
        {subtitle}
      </Text>
    </Pressable>
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
  const [portalNotice, setPortalNotice] = useState<string | null>(null);

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
      {/* Background layers — dot grid, scan line, particles, blobs (matches
          the web login's mobile breakpoint: crane + hero copy stay hidden) */}
      <DotGrid width={SCREEN_W} height={SCREEN_H} />
      <ScanLine height={SCREEN_H} />
      <FloatingParticles />
      <GlowBlob
        style={{ top: -SCREEN_H * 0.06, left: -SCREEN_W * 0.2, width: SCREEN_W * 0.7, height: SCREEN_W * 0.7 }}
        colors={["rgba(124,58,237,0.28)", "rgba(124,58,237,0)"]}
      />
      <GlowBlob
        style={{ bottom: -SCREEN_H * 0.06, right: -SCREEN_W * 0.2, width: SCREEN_W * 0.7, height: SCREEN_W * 0.7 }}
        colors={["rgba(79,70,229,0.22)", "rgba(79,70,229,0)"]}
      />

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 20 }}
          keyboardShouldPersistTaps="handled"
        >
          <Animated.View
            style={{
              opacity: cardFade,
              transform: [{ translateY: cardFade.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
            }}
          >
            <View
              className="rounded-3xl p-6 overflow-hidden"
              style={{ backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "rgba(167,139,250,0.18)" }}
            >
              <BlueprintCorners />

              {/* Header */}
              <View className="items-center mb-7">
                <LogoRing size={80} />
                <View className="mt-3">
                  <GradientText style={{ fontSize: 30, fontFamily: fonts.heading.bold, letterSpacing: -0.5 }}>
                    CivilierERP
                  </GradientText>
                </View>
                <View className="flex-row items-center gap-1.5 mt-2">
                  <View className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#a78bfa" }} />
                  <Text className="text-xs" style={{ color: "rgba(255,255,255,0.4)", fontFamily: fonts.body.medium }}>
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

                <View>
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
                  <PasswordStrength password={password} />
                </View>

                {error && (
                  <ShakeOnError trigger={errorTick}>
                    <View
                      className="flex-row items-center gap-2 px-4 py-2.5 rounded-xl"
                      style={{ backgroundColor: "rgba(239,68,68,0.12)", borderWidth: 1, borderColor: "rgba(239,68,68,0.25)" }}
                    >
                      <AlertCircle size={14} color="#fca5a5" />
                      <Text className="text-sm flex-1" style={{ color: "#fca5a5", fontFamily: fonts.body.medium }}>
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
                    <Text className="text-white text-sm" style={{ fontFamily: fonts.body.semibold }}>
                      {loading ? "Signing in…" : "Sign In"}
                    </Text>
                  </LinearGradient>
                </Pressable>
              </View>

              <Text className="text-center text-[10px] mt-5" style={{ color: "rgba(255,255,255,0.2)", fontFamily: fonts.body.regular }}>
                Secure access · Role-based permissions
              </Text>

              {/* Other portals — visual parity with web; supplier/customer
                  portal navigation isn't built on mobile yet, so these just
                  surface a notice instead of a dead route. */}
              <View className="mt-5 pt-5" style={{ borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)" }}>
                <Text
                  className="text-center text-[10px] uppercase mb-3"
                  style={{ color: "rgba(255,255,255,0.25)", letterSpacing: 1, fontFamily: fonts.body.semibold }}
                >
                  Looking for a different portal?
                </Text>
                <View className="flex-row gap-2.5">
                  <PortalButton
                    icon={<Truck size={14} color="#c4b5fd" />}
                    title="Supplier"
                    subtitle="Vendor & order portal"
                    onPress={() => setPortalNotice("Supplier portal isn't available on mobile yet — use the web app.")}
                  />
                  <PortalButton
                    icon={<Building2 size={14} color="#c4b5fd" />}
                    title="Customer"
                    subtitle="Booking & owner portal"
                    onPress={() => setPortalNotice("Customer portal isn't available on mobile yet — use the web app.")}
                  />
                </View>
                {portalNotice && (
                  <Text className="text-center text-[10px] mt-3" style={{ color: "rgba(255,255,255,0.35)", fontFamily: fonts.body.regular }}>
                    {portalNotice}
                  </Text>
                )}
              </View>
            </View>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
