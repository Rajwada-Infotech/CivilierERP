// Sign-in, drawn on the web app's drawing sheet (see components/sheet): the title block with the logo, the two fields,
// one ink key, and the other portals underneath. Port of src/pages/Login.tsx — what the web renders at its own mobile
// breakpoint is the sign-in card alone, full screen, centred (the hero column is `hidden lg:flex` there too).
import { useEffect, useRef, useState } from "react";
import { Animated, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { Eye, EyeOff, Truck, Building2, ArrowUpRight } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { useTypewriter } from "@/hooks/useTypewriter";
import { PasswordStrength } from "@/components/PasswordStrength";
import { Body, Field, Input, Key, Label, Notice, Press, SheetFrame, TitleBlock } from "@/components/sheet/Sheet";
import { colors, sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";

/** The company logo in a ruled circle, as on the web sign-in. */
function Logo({ size = 52 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 1.5, borderColor: S.ink, backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      <Image source={require("../../../assets/branding/Civilier.png")} style={{ width: size * 0.72, height: size * 0.72 }} resizeMode="contain" />
    </View>
  );
}

/** Another portal: an ink-ruled key with an icon, a name and a line under it. */
function PortalKey({ icon, title, subtitle, onPress }: { icon: React.ReactNode; title: string; subtitle: string; onPress: () => void }) {
  return (
    <Press
      onPress={onPress}
      style={(pressed) => ({ flex: 1, padding: 12, gap: 8, borderWidth: 1, borderColor: S.ink, backgroundColor: pressed ? S.blueWash : "transparent" })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        {icon}
        <ArrowUpRight size={13} color={S.graphite} />
      </View>
      <View>
        <Text style={{ color: S.ink, fontSize: 12, fontFamily: fonts.heading.semibold }}>{title}</Text>
        <Text style={{ color: S.graphite, fontSize: 10.5, fontFamily: fonts.body.regular, marginTop: 1 }}>{subtitle}</Text>
      </View>
    </Press>
  );
}

export default function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [portalNotice, setPortalNotice] = useState<string | null>(null);

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
      await login(email.trim(), password);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid email or password.");
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
              <TitleBlock eyebrow="CivilierERP · Admin" title="Sign in" subtitle={tagline || " "} action={<Logo />} />

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
                  <PasswordStrength password={password} />
                </Field>

                {error && <Notice>{error}</Notice>}

                <Key tone="ink" label={loading ? "Signing in…" : "Sign in →"} onPress={onSubmit} disabled={loading || !email || !password} />

                <Label style={{ textAlign: "center" }}>Secure access · Role-based permissions</Label>
              </View>

              {/* Other portals: not built on mobile yet, so they say so instead of opening a dead page. */}
              <View style={{ borderTopWidth: 1, borderTopColor: S.rule, padding: 16, gap: 12 }}>
                <Label>Looking for a different portal?</Label>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <PortalKey
                    icon={<Truck size={15} color={S.ink} />}
                    title="Supplier"
                    subtitle="Vendor & order portal"
                    onPress={() => setPortalNotice("The Supplier portal isn't on mobile yet. Use the web app.")}
                  />
                  <PortalKey
                    icon={<Building2 size={15} color={S.ink} />}
                    title="Customer"
                    subtitle="Booking & owner portal"
                    onPress={() => setPortalNotice("The Customer portal isn't on mobile yet. Use the web app.")}
                  />
                </View>
                {portalNotice && <Body size={11.5} color={S.graphite}>{portalNotice}</Body>}
              </View>
            </SheetFrame>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
