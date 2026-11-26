// Employee sign-in: the e-mail on the employee's Employee Master record and the password HR set on Employee Portal Access.
import { useState } from "react";
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Eye, EyeOff } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { Body, Field, Input, Key, Label, Notice, SheetFrame, TitleBlock } from "@/components/sheet/Sheet";
import { colors, sheet as S } from "@/theme/colors";

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

  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 12, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }} keyboardShouldPersistTaps="handled">
          <SheetFrame>
            <TitleBlock eyebrow="CivilierERP · Employee Portal" title="Sign in" subtitle="Attendance, leave and payslips" action={<Logo />} />
            <View style={{ borderTopWidth: 1, borderTopColor: S.rule, padding: 16, gap: 16 }}>
              <Field label="Email Address">
                <Input value={email} placeholder="name@company.com" onChangeText={(t) => { setEmail(t); setError(null); }}
                  autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" />
              </Field>
              <Field label="Password">
                <Input value={password} placeholder="••••••••" onChangeText={(t) => { setPassword(t); setError(null); }}
                  secureTextEntry={!showPass} textContentType="password" onSubmitEditing={onSubmit}
                  right={
                    <Pressable onPress={() => setShowPass((v) => !v)} hitSlop={10} style={{ paddingHorizontal: 12, height: 44, justifyContent: "center" }}>
                      {showPass ? <EyeOff size={16} color={S.graphite} /> : <Eye size={16} color={S.graphite} />}
                    </Pressable>
                  } />
              </Field>
              {error && <Notice>{error}</Notice>}
              <Key tone="ink" label={loading ? "Signing in…" : "Sign in →"} onPress={onSubmit} disabled={loading || !email || !password} />
              <Label style={{ textAlign: "center" }}>No login yet? Ask HR to enable Employee Portal access</Label>
            </View>
            <View style={{ borderTopWidth: 1, borderTopColor: S.rule, padding: 16 }}>
              <Body size={11.5} color={S.graphite}>Forgot your password? HR can reset it from Employee Portal Access.</Body>
            </View>
          </SheetFrame>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
