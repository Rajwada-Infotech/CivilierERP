// Render long lists a page at a time inside ScrollViews (rooms can hold hundreds of activities): drawing them
// all at once froze the JS thread on open. `useIncremental` gives how many to render; <ShowMore> reveals the next page.
import { useEffect, useState } from "react";
import { Text, TouchableOpacity } from "react-native";
import { ChevronDown } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";

export function useIncremental(total: number, step = 25) {
  const [count, setCount] = useState(step);
  useEffect(() => { setCount(step); }, [total, step]);
  return { count: Math.min(count, total), more: () => setCount((c) => c + step), remaining: Math.max(0, total - count), step };
}

export function ShowMore({ remaining, step, onPress }: { remaining: number; step: number; onPress: () => void }) {
  if (remaining <= 0) return null;
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, marginTop: 4, borderRadius: 10, borderWidth: 1, borderColor: colors.border }}
    >
      <ChevronDown size={14} color={colors.mutedForeground} />
      <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: colors.mutedForeground }}>
        Show {Math.min(step, remaining)} more · {remaining} left
      </Text>
    </TouchableOpacity>
  );
}
