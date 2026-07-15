// Proof-of-concept screen: exercises the full loop this scaffold exists to
// validate — auth (Bearer token attached by fetchWithAuth) -> TanStack Query
// -> a real backend list endpoint -> render. Swap for a real dashboard once
// the loop is confirmed working end-to-end against your backend.
import { View, Text, FlatList, ActivityIndicator, Pressable } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { getPaymentReasons } from "@/api/paymentReasonApi";
import { useAuth } from "@/auth/AuthContext";

export default function DashboardScreen() {
  const { currentUser, logout } = useAuth();
  const { data: reasons = [], isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ["payment-reasons"],
    queryFn: getPaymentReasons,
  });

  return (
    <View className="flex-1 bg-background px-4 pt-4">
      <View className="flex-row justify-between items-center mb-4">
        <View>
          <Text className="text-foreground text-lg font-bold">Hi, {currentUser?.name}</Text>
          <Text className="text-muted text-xs">{currentUser?.role}</Text>
        </View>
        <Pressable onPress={() => logout()}>
          <Text className="text-destructive text-sm">Sign out</Text>
        </Pressable>
      </View>

      <Text className="text-muted text-xs uppercase tracking-wide mb-2">
        Payment Reasons (live from backend)
      </Text>

      {isLoading && <ActivityIndicator color="#6366f1" />}
      {error && <Text className="text-destructive">{(error as Error).message}</Text>}

      <FlatList
        data={reasons}
        keyExtractor={(item) => String(item.id)}
        onRefresh={refetch}
        refreshing={isRefetching}
        renderItem={({ item }) => (
          <View className="bg-card border border-border rounded-lg px-3 py-3 mb-2">
            <Text className="text-foreground font-medium">{item.name}</Text>
            {item.description ? (
              <Text className="text-muted text-xs mt-0.5">{item.description}</Text>
            ) : null}
          </View>
        )}
        ListEmptyComponent={
          !isLoading ? <Text className="text-muted">No payment reasons found.</Text> : null
        }
      />
    </View>
  );
}
