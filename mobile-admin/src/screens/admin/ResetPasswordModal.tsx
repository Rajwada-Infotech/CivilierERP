// RN port of PasswordReset.tsx's ResetDialog (web), on the drawing sheet: a paper panel under an ink rule with the
// person (initials square, name, email), New password and Confirm password with an eye key each, the strength meter as
// five ruled cells filled ink (red while weak), the match note, then Cancel and Reset password. Same 6-character minimum
// and the same strength scoring as the web.
import { useEffect, useState } from "react";
import { View, Text, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Eye, EyeOff, KeyRound } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { resetUserPassword, type ResetUser } from "@/api/passwordResetApi";
import { Field, Input, Key, Label, Press } from "@/components/sheet/Sheet";
import { SheetPicker } from "@/components/sheet/FormParts";
import { initialsOf, roleLabel } from "./userDisplay";

function passwordStrength(pw: string): { score: number; label: string } {
  if (!pw) return { score: 0, label: "" };
  let score = 0;
  if (pw.length >= 6) score++;
  if (pw.length >= 10) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { score, label: "Weak" };
  if (score <= 2) return { score, label: "Fair" };
  if (score <= 3) return { score, label: "Good" };
  return { score, label: "Strong" };
}

function PasswordField({
  label, value, onChangeText, placeholder, onSubmitEditing, autoFocus,
}: {
  label: string; value: string; onChangeText: (v: string) => void; placeholder: string; onSubmitEditing?: () => void; autoFocus?: boolean;
}) {
  const [shown, setShown] = useState(false);
  return (
    <Field label={label}>
      <Input
        autoFocus={autoFocus}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        secureTextEntry={!shown}
        autoCapitalize="none"
        autoCorrect={false}
        onSubmitEditing={onSubmitEditing}
        right={
          <Press onPress={() => setShown((v) => !v)} style={() => ({ paddingHorizontal: 12, alignSelf: "stretch", justifyContent: "center" })}>
            {shown ? <EyeOff size={15} color={S.graphite} /> : <Eye size={15} color={S.graphite} />}
          </Press>
        }
      />
    </Field>
  );
}

export function ResetPasswordModal({ user, onClose }: { user: ResetUser | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // A fresh panel for each person.
  useEffect(() => {
    setNewPassword("");
    setConfirmPassword("");
  }, [user?.id]);

  const strength = passwordStrength(newPassword);
  const weak = strength.score <= 1;
  const matches = !!newPassword && !!confirmPassword && newPassword === confirmPassword;
  const mismatch = !!confirmPassword && newPassword !== confirmPassword;
  const canSubmit = newPassword.length >= 6 && matches && !loading;

  const close = () => {
    if (loading) return;
    onClose();
  };

  const handleReset = async () => {
    if (!user || !canSubmit) return;
    setLoading(true);
    try {
      await resetUserPassword(Number(user.id), newPassword);
      setLoading(false);
      onClose();
      Alert.alert("Password reset", `${user.name} can now sign in with the new password.`);
    } catch (e: any) {
      setLoading(false);
      Alert.alert("Could not reset", e?.message || "The password was not changed. Try again.");
    }
  };

  return (
    <SheetPicker visible={!!user} title="Reset password" onClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ padding: 16, gap: 14, paddingBottom: insets.bottom + 16 }}>
          {/* Who */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: S.line15 }}>
            <View style={{ width: 40, height: 40, borderWidth: 1, borderColor: S.ink, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontFamily: fonts.heading.bold, fontSize: 13, color: S.ink }}>{initialsOf(user?.name ?? "")}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontFamily: fonts.heading.bold, fontSize: 15, color: S.ink }}>{user?.name}</Text>
              <Text numberOfLines={1} style={{ fontFamily: fonts.body.regular, fontSize: 11, color: S.graphite }}>{user?.email}</Text>
            </View>
            {!!user?.role && <Label>{roleLabel(user.role)}</Label>}
          </View>

          <View style={{ gap: 8 }}>
            <PasswordField label="New password" value={newPassword} onChangeText={setNewPassword} placeholder="At least 6 characters" autoFocus />
            {!!newPassword && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={{ flex: 1, flexDirection: "row", gap: 3 }}>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <View key={i} style={{ flex: 1, height: 6, borderWidth: 1, borderColor: weak ? S.red : S.ink, backgroundColor: i <= strength.score ? (weak ? S.red : S.ink) : "transparent" }} />
                  ))}
                </View>
                <Label color={weak ? S.red : S.ink}>{strength.label}</Label>
              </View>
            )}
            {!!newPassword && newPassword.length < 6 && <Text style={{ fontFamily: fonts.body.medium, fontSize: 11, color: S.red }}>{6 - newPassword.length} more character{6 - newPassword.length === 1 ? "" : "s"} needed.</Text>}
          </View>

          <View style={{ gap: 8 }}>
            <PasswordField label="Confirm password" value={confirmPassword} onChangeText={setConfirmPassword} placeholder="Re-enter password" onSubmitEditing={handleReset} />
            {(matches || mismatch) && (
              <Text style={{ fontFamily: fonts.body.medium, fontSize: 11, color: matches ? S.ink : S.red }}>{matches ? "✓ Passwords match" : "Passwords do not match"}</Text>
            )}
          </View>

          <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
            <Key label="Cancel" onPress={close} disabled={loading} style={{ flex: 1 }} />
            <Key
              tone="ink"
              label={loading ? "Resetting…" : "Reset password"}
              icon={<KeyRound size={13} color={S.paper} />}
              onPress={handleReset}
              disabled={!canSubmit}
              style={{ flex: 1.4 }}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </SheetPicker>
  );
}
