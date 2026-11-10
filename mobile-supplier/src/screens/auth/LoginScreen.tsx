// Supplier sign-in, drawn on the web app's drawing sheet (see components/sheet): the title block with the logo, the
// two fields, one ink key. Port of src/pages/supplier/SupplierLogin.tsx — what the web renders at its own mobile
// breakpoint is the sign-in card alone, full screen, centred.
import { useEffect, useRef, useState } from "react";
import { Animated, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import { Eye, EyeOff } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { Field, Input, Key, Notice, SheetFrame, TitleBlock } from "@/components/sheet/Sheet";
import { WelcomeOverlay } from "@/components/WelcomeOverlay";
import { colors, sheet as S } from "@/theme/colors";

// Same ~1.8s window SupplierLogin.tsx (web) holds before navigate("/supplier")
// after a successful login — long enough for the welcome moment to read,
// short enough not to feel like a stall.
const NAV_HOLD_MS = 1800;

/** The company logo in a ruled circle, as on the web sign-in. */
function Logo({ size = 52 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 1.5, borderColor: S.ink, backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      <Image source={require("../../../assets/branding/Civilier.png")} style={{ width: size * 0.72, height: size * 0.72 }} resizeMode="contain" />
    </View>
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

  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(rise, { toValue: 1, duration: 450, useNativeDriver: true }).start();
  }, [rise]);

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
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 12 }} keyboardShouldPersistTaps="handled">
          <Animated.View style={{ opacity: rise, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }] }}>
            <SheetFrame>
              <TitleBlock
                eyebrow="CivilierERP · Supplier"
                title="Supplier Portal"
                subtitle="Sign in to your supplier account"
                action={<Logo />}
              />

              <View style={{ borderTopWidth: 1, borderTopColor: S.rule, padding: 16, gap: 16 }}>
                <Field label="Email Address">
                  <Input
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
                </Field>

                <Field label="Password">
                  <Input
                    value={password}
                    placeholder="••••••••"
                    onChangeText={(t) => {
                      setPassword(t);
                      setError(null);
                    }}
                    secureTextEntry={!showPass}
                    textContentType="password"
                    onSubmitEditing={onSubmit}
                    right={
                      <Pressable onPress={() => setShowPass((v) => !v)} hitSlop={10} style={{ paddingHorizontal: 12, height: 44, justifyContent: "center" }}>
                        {showPass ? <EyeOff size={16} color={S.graphite} /> : <Eye size={16} color={S.graphite} />}
                      </Pressable>
                    }
                  />
                </Field>

                {error && <Notice>{error}</Notice>}

                <Key
                  tone="ink"
                  label={loading ? "Signing in…" : "Sign in →"}
                  onPress={onSubmit}
                  disabled={loading || !email || !password || loginSuccess}
                />
              </View>
            </SheetFrame>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>

      {loginSuccess && <WelcomeOverlay name={loginName} durationMs={NAV_HOLD_MS} />}
    </View>
  );
}
