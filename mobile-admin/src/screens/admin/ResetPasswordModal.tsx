// RN port of PasswordReset.tsx's ResetDialog (web) — same 6-char minimum,
// same 5-segment strength meter (length/uppercase/digit/special-char based),
// same match indicator. web's dialog becomes a bottom-sheet-style Modal.
import { useState } from "react";
import { View, Text, Modal, Pressable, TextInput, ActivityIndicator, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Eye, EyeOff, KeyRound, Lock, CheckCircle2, AlertCircle, X } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { resetUserPassword, type ResetUser } from "@/api/passwordResetApi";
import { avatarGradientColor, initialsOf, roleLabel } from "./userDisplay";

function passwordStrength(pw: string): { score: number; label: string; color: string } {
  if (!pw) return { score: 0, label: "", color: "" };
  let score = 0;
  if (pw.length >= 6) score++;
  if (pw.length >= 10) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { score, label: "Weak", color: "#ef4444" };
  if (score <= 2) return { score, label: "Fair", color: "#f59e0b" };
  if (score <= 3) return { score, label: "Good", color: "#3b82f6" };
  return { score, label: "Strong", color: "#10b981" };
}

function PasswordField({
  label, value, onChangeText, placeholder, onSubmitEditing, borderColor, autoFocus,
}: {
  label: string; value: string; onChangeText: (v: string) => void; placeholder: string;
  onSubmitEditing?: () => void; borderColor?: string; autoFocus?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.heading.semibold, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
        {label}
      </Text>
      <View style={{ position: "relative" }}>
        <TextInput
          autoFocus={autoFocus}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={`${colors.mutedForeground}66`}
          secureTextEntry={!visible}
          onSubmitEditing={onSubmitEditing}
          style={{
            borderWidth: 1, borderColor: borderColor ?? colors.border, borderRadius: 12,
            paddingHorizontal: 14, paddingVertical: 11, paddingRight: 40,
            color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13,
          }}
        />
        <Pressable onPress={() => setVisible((v) => !v)} style={{ position: "absolute", right: 12, top: 0, bottom: 0, justifyContent: "center" }}>
          {visible ? <EyeOff size={15} color={colors.mutedForeground} /> : <Eye size={15} color={colors.mutedForeground} />}
        </Pressable>
      </View>
    </View>
  );
}

export function ResetPasswordModal({ user, onClose }: { user: ResetUser | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const strength = passwordStrength(newPassword);
  const matches = !!newPassword && !!confirmPassword && newPassword === confirmPassword;
  const mismatch = !!confirmPassword && newPassword !== confirmPassword;
  const canSubmit = newPassword.length >= 6 && matches && !loading;

  const close = () => {
    if (loading) return;
    setNewPassword("");
    setConfirmPassword("");
    onClose();
  };

  const handleReset = async () => {
    if (!user || !canSubmit) return;
    setLoading(true);
    try {
      await resetUserPassword(Number(user.id), newPassword);
      close();
    } catch (e: any) {
      Alert.alert("Reset failed", e.message || "Failed to reset password.");
    } finally {
      setLoading(false);
    }
  };

  if (!user) return null;
  const grad = avatarGradientColor(user.name);

  return (
    <Modal visible={!!user} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} onPress={close}>
        <Pressable
          onPress={() => {}}
          style={{
            position: "absolute", left: 0, right: 0, bottom: 0,
            backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
            borderWidth: 1, borderColor: colors.border, overflow: "hidden",
          }}
        >
          {/* Header */}
          <View style={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Pressable onPress={close} disabled={loading} style={{ position: "absolute", top: 14, right: 14, padding: 6, opacity: loading ? 0.4 : 1 }}>
              <X size={14} color={colors.mutedForeground} />
            </Pressable>

            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: grad, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: "#fff", fontSize: 14, fontFamily: fonts.heading.bold }}>{initialsOf(user.name)}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.semibold }}>{user.name}</Text>
                <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 10.5, marginTop: 1 }}>{user.email}</Text>
                <View style={{ alignSelf: "flex-start", marginTop: 4, paddingHorizontal: 6, paddingVertical: 1.5, borderRadius: 5, backgroundColor: `${colors.primary}1a` }}>
                  <Text style={{ color: colors.primary, fontSize: 9.5, fontFamily: fonts.heading.semibold }}>{roleLabel(user.role)}</Text>
                </View>
              </View>
            </View>

            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14 }}>
              <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: "#3b82f61a", alignItems: "center", justifyContent: "center" }}>
                <Lock size={12} color="#3b82f6" />
              </View>
              <View>
                <Text style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.heading.semibold }}>Set new password</Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 10 }}>Must be at least 6 characters</Text>
              </View>
            </View>
          </View>

          {/* Body */}
          <View style={{ paddingHorizontal: 20, paddingTop: 16 }}>
            <PasswordField label="New Password" value={newPassword} onChangeText={setNewPassword} placeholder="Enter new password" autoFocus />
            {!!newPassword && (
              <View style={{ marginTop: -8, marginBottom: 14 }}>
                <View style={{ flexDirection: "row", gap: 4, marginBottom: 4 }}>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <View key={i} style={{ height: 3, flex: 1, borderRadius: 2, backgroundColor: i <= strength.score ? strength.color : colors.muted }} />
                  ))}
                </View>
                <Text style={{ color: strength.color, fontSize: 10, fontFamily: fonts.body.medium }}>{strength.label}</Text>
              </View>
            )}

            <PasswordField
              label="Confirm Password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Re-enter password"
              onSubmitEditing={canSubmit ? handleReset : undefined}
              borderColor={mismatch ? colors.destructive : matches ? "#10b981" : colors.border}
            />
            {!!confirmPassword && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: -8, marginBottom: 4 }}>
                {matches ? <CheckCircle2 size={12} color="#10b981" /> : <AlertCircle size={12} color={colors.destructive} />}
                <Text style={{ color: matches ? "#10b981" : colors.destructive, fontSize: 11, fontFamily: fonts.body.medium }}>
                  {matches ? "Passwords match" : "Passwords do not match"}
                </Text>
              </View>
            )}
          </View>

          {/* Footer */}
          <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 20, paddingTop: 16, paddingBottom: insets.bottom + 20 }}>
            <Pressable onPress={close} disabled={loading} style={{ flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, opacity: loading ? 0.5 : 1 }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 13, fontFamily: fonts.heading.semibold }}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={handleReset}
              disabled={!canSubmit}
              style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 12, borderRadius: 12, backgroundColor: "#2563eb", opacity: canSubmit ? 1 : 0.4 }}
            >
              {loading ? <ActivityIndicator size="small" color="#fff" /> : <KeyRound size={14} color="#fff" />}
              <Text style={{ color: "#fff", fontSize: 13, fontFamily: fonts.heading.semibold }}>{loading ? "Resetting…" : "Reset Password"}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
