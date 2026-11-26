// Sign-in, on the drawing sheet: the title block with the logo, a Staff / Resident switch, the two fields and one ink key.
// Staff (guards, security admins) sign in with their CivilierERP email; residents with the mobile number and password
// of their customer-portal account (the same one Civilier Home uses).
import { useEffect, useRef, useState } from "react";
import { Animated, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import { Eye, EyeOff } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { useTypewriter } from "@/hooks/useTypewriter";
import { PasswordStrength } from "@/components/PasswordStrength";
import { Field, Input, Key, Label, Notice, Seg, SheetFrame, TitleBlock } from "@/components/sheet/Sheet";
import { colors, sheet as S } from "@/theme/colors";

/** The company logo in a ruled circle, as on the web sign-in. */
function Logo({ size = 52 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 1.5, borderColor: S.ink, backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      <Image source={require("../../../assets/branding/Civilier.png")} style={{ width: size * 0.72, height: size * 0.72 }} resizeMode="contain" />
    </View>
  );
}

export default function LoginScreen() {
  const { login, loginCustomer } = useAuth();
  const [who, setWho] = useState<"staff" | "resident">("staff");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tagline = useTypewriter(["Built for Civil Contractors", "Project Insights at a Glance", "One Platform. Total Control."], 60, 2400);

  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(rise, { toValue: 1, duration: 450, useNativeDriver: true }).start();
  }, [rise]);

  const onSubmit = async () => {
    if (loading || !email || !password) return;
    setError(null);
    setLoading(true);
    try {
      if (who === "resident") await loginCustomer(email.replace(/\D/g, "").slice(-10), password);
      else await login(email.trim(), password);
    } catch (e) {
      setError(e instanceof Error ? e.message : who === "resident" ? "Invalid mobile number or password." : "Invalid email or password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 12 }} keyboardShouldPersistTaps="handled">
          <Animated.View style={{ opacity: rise, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }] }}>
            <SheetFrame>
              <TitleBlock eyebrow="Civilier · Security Intercom" title="Sign in" subtitle={tagline || " "} action={<Logo />} />

              <View style={{ borderTopWidth: 1, borderTopColor: S.rule, padding: 16, gap: 16 }}>
                <Seg
                  options={[
                    { value: "staff", label: "Staff" },
                    { value: "resident", label: "Resident" },
                  ]}
                  value={who}
                  onChange={(v) => {
                    setWho(v);
                    setEmail("");
                    setError(null);
                  }}
                />
                {who === "resident" ? (
                  <Field label="Registered Mobile Number">
                    <Input
                      value={email}
                      placeholder="10-digit mobile number"
                      onChangeText={(t) => {
                        setEmail(t);
                        setError(null);
                      }}
                      keyboardType="phone-pad"
                      textContentType="telephoneNumber"
                      maxLength={14}
                    />
                  </Field>
                ) : (
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
                )}

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
                  {who === "staff" && <PasswordStrength password={password} />}
                </Field>

                {error && <Notice>{error}</Notice>}

                <Key tone="ink" label={loading ? "Signing in…" : "Sign in →"} onPress={onSubmit} disabled={loading || !email || !password} />

                <Label style={{ textAlign: "center" }}>
                  {who === "resident" ? "Use your Civilier customer-portal password" : "Guards and security staff"}
                </Label>
              </View>

            </SheetFrame>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
