// Catches any render/lifecycle error anywhere below it in the tree and
// shows a recoverable screen instead of the app hard-crashing to the OS
// home screen. Wraps the whole app (see App.tsx) — this is the last line
// of defense; individual screens should still handle their own known
// failure modes (network errors, unhandled promise rejections) rather than
// relying on this to catch them, since a caught error here loses whatever
// the user was doing on that screen.
import { Component, type ReactNode } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { AlertTriangle, RotateCcw } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary] caught:", error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <View
          style={{
            width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center",
            backgroundColor: `${colors.destructive}22`, marginBottom: 18,
          }}
        >
          <AlertTriangle size={26} color={colors.destructive} />
        </View>
        <Text style={{ color: colors.foreground, fontSize: 16, fontFamily: fonts.heading.semibold, textAlign: "center", marginBottom: 6 }}>
          Something went wrong
        </Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 12.5, fontFamily: fonts.body.regular, textAlign: "center", marginBottom: 16 }}>
          The screen hit an unexpected error. Your data on the server is safe — try again.
        </Text>
        <ScrollView
          style={{ maxHeight: 120, width: "100%", marginBottom: 20 }}
          contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 10 }}
        >
          <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.card, padding: 12 }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.body.regular }} numberOfLines={6}>
              {error.message || String(error)}
            </Text>
          </View>
        </ScrollView>
        <Pressable
          onPress={this.reset}
          style={{
            flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingVertical: 12,
            borderRadius: 14, backgroundColor: colors.primary,
          }}
        >
          <RotateCcw size={14} color="#fff" />
          <Text style={{ color: "#fff", fontSize: 13, fontFamily: fonts.heading.semibold }}>Try Again</Text>
        </Pressable>
      </View>
    );
  }
}
