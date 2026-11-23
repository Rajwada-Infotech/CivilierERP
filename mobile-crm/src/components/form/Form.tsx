// Mobile form kit — single-column, tap-friendly, sticky submit bar. Used by every create / edit screen (Maintenance
// and CRM). Sentence-case labels over soft rounded fields, as the app's kit (screens/crm/ui.tsx). The styles are worked
// out at each draw, so a change of theme (light / dark, accent) shows at once.
import type { ReactNode } from "react";
import {
  View, Text, TextInput, Pressable, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";

const labelStyle = () => ({
  color: colors.mutedForeground,
  fontSize: 13,
  fontFamily: fonts.body.medium,
  marginBottom: 7,
});

export function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <Text style={labelStyle()}>
      {label}
      {required ? <Text style={{ color: colors.destructive }}> *</Text> : null}
    </Text>
  );
}

export function FieldError({ error }: { error?: string | null }) {
  if (!error) return null;
  return (
    <Text style={{ color: colors.destructive, fontSize: 12.5, fontFamily: fonts.body.regular, marginTop: 5 }}>{error}</Text>
  );
}

const boxStyle = () => ({
  borderWidth: 1,
  borderColor: colors.border,
  backgroundColor: colors.card,
  borderRadius: 14,
  paddingHorizontal: 14,
  minHeight: 48,
  color: colors.foreground,
  fontSize: 15,
  fontFamily: fonts.body.regular,
});

export function TextField({
  label, value, onChangeText, placeholder, required, error, autoCapitalize, keyboardType, multiline, disabled,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  error?: string | null;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  keyboardType?: "default" | "numeric" | "decimal-pad" | "email-address";
  multiline?: boolean;
  disabled?: boolean;
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      <FieldLabel label={label} required={required} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={`${colors.mutedForeground}99`}
        autoCapitalize={autoCapitalize}
        keyboardType={keyboardType}
        multiline={multiline}
        editable={!disabled}
        style={[
          boxStyle(),
          multiline ? { minHeight: 96, paddingTop: 12, textAlignVertical: "top" } : { paddingVertical: 12 },
          error ? { borderColor: colors.destructive } : null,
          disabled ? { opacity: 0.5 } : null,
        ]}
      />
      <FieldError error={error} />
    </View>
  );
}

export function NumberField(props: Omit<Parameters<typeof TextField>[0], "keyboardType" | "autoCapitalize">) {
  return <TextField {...props} keyboardType="decimal-pad" autoCapitalize="none" />;
}

export function RemarksField(props: Omit<Parameters<typeof TextField>[0], "multiline">) {
  return <TextField {...props} multiline />;
}

export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ marginBottom: 18 }}>
      <Text
        style={{
          color: colors.foreground, fontSize: 17, fontFamily: fonts.heading.semibold,
          letterSpacing: -0.2, marginBottom: 12,
        }}
      >
        {title}
      </Text>
      {children}
    </View>
  );
}

export function FormScaffold({
  children, onSubmit, submitLabel = "Save", onCancel, submitting, disabled, tone, toneInk = "#FFFFFF",
}: {
  /** The submit key's colour and its text colour: the app's accent (Settings) unless a screen passes its own. */
  tone?: string;
  toneInk?: string;
  children: ReactNode;
  onSubmit: () => void;
  submitLabel?: string;
  onCancel: () => void;
  submitting?: boolean;
  disabled?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
      <View
        style={{
          flexDirection: "row", gap: 10, padding: 12, paddingBottom: insets.bottom + 12,
          borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background,
        }}
      >
        <Pressable
          onPress={submitting ? undefined : onCancel}
          style={{ flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: "center" }}
        >
          <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.semibold }}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={submitting || disabled ? undefined : onSubmit}
          style={{
            flex: 1.5, paddingVertical: 13, borderRadius: 12, alignItems: "center",
            backgroundColor: tone ?? colors.primary, opacity: submitting || disabled ? 0.6 : 1,
          }}
        >
          {submitting ? (
            <ActivityIndicator color={toneInk} size="small" />
          ) : (
            <Text style={{ color: toneInk, fontSize: 13, fontFamily: fonts.heading.bold }}>{submitLabel}</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
