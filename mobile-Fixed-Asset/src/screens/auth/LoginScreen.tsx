// RN login card for the Fixed Asset app. Ported from mobile-supplier's
// LoginScreen — same Animated API + expo-linear-gradient, rebranded from
// the supplier emerald palette to the Fixed Asset amber accent.
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
import { AnimatedInput } from "@/components/AnimatedInput";
import { ShimmerButton } from "@/components/ShimmerButton";
import { GradientText } from "@/components/GradientText";
import { LogoRing } from "@/components/LogoRing";
import { WelcomeOverlay } from "@/components/WelcomeOverlay";
import { fonts } from "@/theme/fonts";

const NAV_HOLD_MS = 1800;

function CornerAccents() {
  const corner = "absolute w-5 h-5";
  const color = "rgba(234,179,8,0.4)";
  return (
    <>
      <View className={`${corner} top-0 left-0 border-t-2 border-l-2 rounded-tl-2xl`} style={{ borderColor: color }} />
      <View className={`${corner} top-0 right-0 border-t-2 border-r-2 rounded-tr-2xl`} style={{ borderColor: color }} />
      <View className={`${corner} bottom-0 left-0 border-b-2 border-l-2 rounded-bl-2xl`} style={{ borderColor: color }} />
      <View className={`${corner} bottom-0 right-0 border-b-2 border-r-2 rounded-br-2xl`} style={{ borderColor: color }} />
    </>
  );
}

export default function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginSuccess, setLoginSuccess] = useState(false);
  const [loginName, setLoginName] = useState("");

  const cardFade = useRef(new Animated.Value(0)).current;
  const cardY = useRef(new Animated.Value(24)).current;
  useEffect(() => {
    Animated.timing(cardFade, { toValue: 1, duration: 500, useNativeDriver: true }).start();
    Animated.timing(cardY, { toValue: 0, duration: 500, useNativeDriver: true }).start();
  }, [cardFade, cardY]);

  const onSubmit = async () => {
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      await login(email.trim(), password, (user) => {
        setLoginName(user.name || "");
        setLoginSuccess(true);
      }, NAV_HOLD_MS);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid email or password.");
      setLoading(false);
    }
  };

  return (
    <View className="flex-1">
      <LinearGradient
        colors={["#fefce8", "#fef9c3", "#ffffff", "#fffdf5"]}
        locations={[0, 0.3, 0.65, 1]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={{ position: "absolute", inset: 0 }}
      />

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 20 }}
          keyboardShouldPersistTaps="handled"
        >
          <Animated.View style={{ opacity: cardFade, transform: [{ translateY: cardY }] }}>
            <View
              className="rounded-3xl p-6 overflow-hidden"
              style={{
                backgroundColor: "rgba(255,255,255,0.92)",
                borderWidth: 1,
                borderColor: "rgba(202,138,4,0.12)",
                shadowColor: "#ca8a04",
                shadowOpacity: 0.1,
                shadowRadius: 24,
                shadowOffset: { width: 0, height: 10 },
                elevation: 6,
              }}
            >
              <CornerAccents />

              <View className="items-center mb-6">
                <LogoRing size={64} />
                <View className="mt-3">
                  <GradientText
                    style={{ fontSize: 24, fontFamily: fonts.heading.bold, letterSpacing: -0.3 }}
                    colors={["#713f12", "#ca8a04", "#facc15"]}
                  >
                    Fixed Asset
                  </GradientText>
                </View>
                <Text style={{ color: "#94a3b8", fontSize: 12, fontFamily: fonts.body.regular, marginTop: 6 }}>
                  Sign in to the CivilierERP Fixed Asset module
                </Text>
              </View>

              <View className="gap-4">
                <AnimatedInput
                  label="Email Address"
                  value={email}
                  placeholder="name@company.com"
                  onChangeText={(t) => {
                    setEmail(t);
                    setError(null);
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  textContentType="emailAddress"
                />

                <AnimatedInput
                  label="Password"
                  value={password}
                  placeholder="••••••••"
                  onChangeText={(t) => {
                    setPassword(t);
                    setError(null);
                  }}
                  secureTextEntry={!showPass}
                  textContentType="password"
                  rightElement={
                    <Pressable onPress={() => setShowPass((v) => !v)} hitSlop={10} className="pr-3">
                      {showPass ? <EyeOff size={16} color="#94a3b8" /> : <Eye size={16} color="#94a3b8" />}
                    </Pressable>
                  }
                />

                {error && (
                  <View
                    className="flex-row items-center gap-2 px-4 py-2.5 rounded-xl"
                    style={{ backgroundColor: "rgba(254,226,226,0.8)", borderWidth: 1, borderColor: "rgba(252,165,165,0.5)" }}
                  >
                    <AlertCircle size={14} color="#dc2626" />
                    <Text className="text-sm flex-1" style={{ color: "#dc2626", fontFamily: fonts.body.medium }}>
                      {error}
                    </Text>
                  </View>
                )}

                <ShimmerButton onPress={onSubmit} disabled={loading || !email || !password || loginSuccess}>
                  {loading ? (
                    <>
                      <Animated.View
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: 8,
                          borderWidth: 2,
                          borderColor: "rgba(255,255,255,0.3)",
                          borderTopColor: "#fff",
                        }}
                      />
                      <Text style={{ color: "#fff", fontSize: 14, fontFamily: fonts.body.semibold }}>Signing in…</Text>
                    </>
                  ) : (
                    <Text style={{ color: "#fff", fontSize: 14, fontFamily: fonts.body.semibold }}>Sign In →</Text>
                  )}
                </ShimmerButton>
              </View>
            </View>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>

      {loginSuccess && <WelcomeOverlay name={loginName} durationMs={NAV_HOLD_MS} />}
    </View>
  );
}
