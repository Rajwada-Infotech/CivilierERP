// Lightweight toast — the mobile stand-in for the web app's `sonner`.
// `toast.success(msg)` / `toast.error(msg)` from anywhere; renders a single
// stacked notice near the top, auto-dismissing after 3.5s.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren } from "react";
import { View, Text, Pressable, Animated } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CheckCircle2, AlertCircle, X } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";

type ToastKind = "success" | "error" | "info";
interface ToastItem { id: number; kind: ToastKind; message: string }

interface ToastApi {
  success: (m: string) => void;
  error: (m: string) => void;
  info: (m: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

let external: ToastApi | null = null;
// Module-level proxy so non-component code (mutation callbacks) can call it.
export const toast: ToastApi = {
  success: (m) => external?.success(m),
  error: (m) => external?.error(m),
  info: (m) => external?.info(m),
};

const TONE: Record<ToastKind, { color: string; Icon: typeof CheckCircle2 }> = {
  success: { color: "#10b981", Icon: CheckCircle2 },
  error: { color: colors.destructive, Icon: AlertCircle },
  info: { color: colors.primary, Icon: AlertCircle },
};

export function ToastProvider({ children }: PropsWithChildren) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const remove = useCallback((id: number) => {
    setItems((p) => p.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = ++seq.current;
    setItems((p) => [...p.slice(-2), { id, kind, message }]);
    setTimeout(() => remove(id), 3500);
  }, [remove]);

  const api: ToastApi = {
    success: (m) => push("success", m),
    error: (m) => push("error", m),
    info: (m) => push("info", m),
  };
  external = api;

  return (
    <ToastContext.Provider value={api}>
      {children}
      <SafeAreaView
        edges={["top"]}
        pointerEvents="box-none"
        style={{ position: "absolute", left: 0, right: 0, top: 0, alignItems: "center" }}
      >
        <View style={{ width: "100%", paddingHorizontal: 14, paddingTop: 6, gap: 8 }}>
          {items.map((t) => {
            const { color, Icon } = TONE[t.kind];
            return (
              <Row key={t.id}>
                <View
                  style={{
                    flexDirection: "row", alignItems: "flex-start", gap: 9,
                    backgroundColor: colors.card, borderRadius: 12,
                    borderWidth: 1, borderColor: `${color}55`,
                    paddingVertical: 10, paddingHorizontal: 12,
                    shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8,
                  }}
                >
                  <Icon size={16} color={color} style={{ marginTop: 1 }} />
                  <Text style={{ flex: 1, color: colors.foreground, fontSize: 12.5, fontFamily: fonts.body.medium, lineHeight: 17 }}>
                    {t.message}
                  </Text>
                  <Pressable onPress={() => remove(t.id)} hitSlop={8}>
                    <X size={13} color={colors.mutedForeground} />
                  </Pressable>
                </View>
              </Row>
            );
          })}
        </View>
      </SafeAreaView>
    </ToastContext.Provider>
  );
}

function Row({ children }: PropsWithChildren) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  }, [anim]);
  return (
    <Animated.View
      style={{
        opacity: anim,
        transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }],
      }}
    >
      {children}
    </Animated.View>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
