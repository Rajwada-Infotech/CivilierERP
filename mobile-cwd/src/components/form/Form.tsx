// Mobile form kit — single-column, tap-friendly, sticky submit bar.
// Used by every Maintenance create/edit screen.
import type { ReactNode } from "react";
import {
  View, Text, TextInput, Pressable, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";

// The sheet's capital label (Sora semibold 10, tracked out, graphite).
const labelStyle = {
  color: S.graphite,
  fontSize: 10,
  fontFamily: fonts.heading.semibold,
  textTransform: "uppercase" as const,
  letterSpacing: 1.2,
  marginBottom: 6,
};

export function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <Text style={labelStyle}>
      {label}
      {required ? <Text style={{ color: S.red }}> *</Text> : null}
    </Text>
  );
}

export function FieldError({ error }: { error?: string | null }) {
  if (!error) return null;
  return (
    <Text style={{ color: S.red, fontSize: 11.5, fontFamily: fonts.body.medium, marginTop: 4 }}>{error}</Text>
  );
}

// The sheet's input: square, a 40% ink border, paper inside.
const boxStyle = {
  borderWidth: 1,
  borderColor: S.line40,
  backgroundColor: S.paper,
  borderRadius: 0,
  paddingHorizontal: 12,
  minHeight: 44,
  color: S.ink,
  fontSize: 14,
  fontFamily: fonts.body.regular,
};

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
        placeholderTextColor={S.faint}
        autoCapitalize={autoCapitalize}
        keyboardType={keyboardType}
        multiline={multiline}
        editable={!disabled}
        style={[
          boxStyle,
          multiline ? { minHeight: 84, paddingTop: 10, textAlignVertical: "top" } : { paddingVertical: 10 },
          error ? { borderColor: S.red } : null,
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
          color: S.ink, fontSize: 10, fontFamily: fonts.heading.semibold, letterSpacing: 1.2, textTransform: "uppercase",
          paddingBottom: 8, marginBottom: 12, borderBottomWidth: 1, borderBottomColor: S.ink,
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
      style={{ flex: 1, backgroundColor: S.paper }}
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
          borderTopWidth: 1.5, borderTopColor: S.ink, backgroundColor: S.paper,
        }}
      >
        <Pressable
          onPress={submitting ? undefined : onCancel}
          style={{ flex: 1, minHeight: 44, justifyContent: "center", borderWidth: 1, borderColor: S.ink, alignItems: "center" }}
        >
          <Text style={{ color: S.ink, fontSize: 11, letterSpacing: 1.1, textTransform: "uppercase", fontFamily: fonts.heading.semibold }}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={submitting || disabled ? undefined : onSubmit}
          style={{
            flex: 1.5, minHeight: 44, justifyContent: "center", alignItems: "center",
            backgroundColor: S.ink, borderWidth: 1, borderColor: S.ink, opacity: submitting || disabled ? 0.5 : 1,
          }}
        >
          {submitting ? (
            <ActivityIndicator color={S.paper} size="small" />
          ) : (
            <Text style={{ color: S.paper, fontSize: 11, letterSpacing: 1.1, textTransform: "uppercase", fontFamily: fonts.heading.semibold }}>{submitLabel}</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
