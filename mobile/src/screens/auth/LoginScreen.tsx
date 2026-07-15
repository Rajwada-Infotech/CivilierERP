import { useState } from "react";
import { View, Text, TextInput, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { useAuth } from "@/auth/AuthContext";

export default function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    setError(null);
    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="flex-1 bg-background justify-center px-6"
    >
      <Text className="text-foreground text-2xl font-bold mb-1">CivilierERP</Text>
      <Text className="text-muted mb-8">Sign in to continue</Text>

      <Text className="text-muted text-xs uppercase tracking-wide mb-1">Email</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="you@company.com"
        placeholderTextColor="#6b7280"
        className="bg-card border border-border rounded-lg px-3 py-3 text-foreground mb-4"
      />

      <Text className="text-muted text-xs uppercase tracking-wide mb-1">Password</Text>
      <TextInput
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        placeholder="••••••••"
        placeholderTextColor="#6b7280"
        className="bg-card border border-border rounded-lg px-3 py-3 text-foreground mb-2"
      />

      {error && <Text className="text-destructive text-sm mb-2">{error}</Text>}

      <Pressable
        onPress={onSubmit}
        disabled={loading || !email || !password}
        className="bg-primary rounded-lg py-3 items-center mt-4 disabled:opacity-50"
      >
        {loading ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-semibold">Sign In</Text>}
      </Pressable>
    </KeyboardAvoidingView>
  );
}
