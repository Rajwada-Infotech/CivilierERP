// Mobile form kit — single-column, tap-friendly, sticky submit bar.
// Used by every Fixed Asset create/edit screen.
import type { ReactNode } from "react";
import {
  View, Text, TextInput, Pressable, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";

const labelStyle = {
  color: colors.mutedForeground,
  fontSize: 10,
  fontFamily: fonts.body.medium,
  textTransform: "uppercase" as const,
  letterSpacing: 0.4,
  marginBottom: 5,
};

export function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <Text style={labelStyle}>
      {label}
      {required ? <Text style={{ color: colors.destructive }}> *</Text> : null}
    </Text>
  );
}

export function FieldError({ error }: { error?: string | null }) {
  if (!error) return null;
  return (
    <Text style={{ color: colors.destructive, fontSize: 10.5, fontFamily: fonts.body.regular, marginTop: 4 }}>{error}</Text>
  );
}

const boxStyle = {
  borderWidth: 1,
  borderColor: colors.border,
  backgroundColor: `${colors.card}80`,
  borderRadius: 12,
  paddingHorizontal: 12,
  minHeight: 44,
  color: colors.foreground,
  fontSize: 13.5,
  fontFamily: fonts.body.regular,
};

export function TextField({
  label, value, onChangeText, placeholder, required, error, autoCapitalize, keyboardType, multiline,
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
        style={[
          boxStyle,
          multiline ? { minHeight: 84, paddingTop: 10, textAlignVertical: "top" } : { paddingVertical: 10 },
          error ? { borderColor: colors.destructive } : null,
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
          color: colors.foreground, fontSize: 11, fontFamily: fonts.heading.bold,
          letterSpacing: 1, textTransform: "uppercase", marginBottom: 12,
        }}
      >
        {title}
      </Text>
      {children}
    </View>
  );
}

export function FormScaffold({
  children, onSubmit, submitLabel = "Save", onCancel, submitting, disabled,
}: {
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
            backgroundColor: "#eab308", opacity: submitting || disabled ? 0.6 : 1,
          }}
        >
          {submitting ? (
            <ActivityIndicator color="#1a1a1a" size="small" />
          ) : (
            <Text style={{ color: "#1a1a1a", fontSize: 13, fontFamily: fonts.heading.bold }}>{submitLabel}</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
