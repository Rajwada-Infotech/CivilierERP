// Customer Maintenance Profile — direct port of the web app's
// src/pages/maintenance/CustomerMaintenanceProfile.tsx: contact/unit/
// project info + payment history (empty state until maintenance payment
// collection is wired up, same as web). Same "Resident Directory" violet
// identity as DirectoryScreen.tsx, which this opens from.
import { View, Text, ScrollView, ActivityIndicator } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useQuery } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Phone, Mail, Home, Building2, History, Wallet } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { getMaintenanceCustomer, getMaintenancePayments } from "@/api/maintenanceApi";
import type { MainStackParamList } from "@/navigation/MainStack";

const DIR_VIOLET = "#a78bfa";
const DIR_INK = "#150f28";

type Props = NativeStackScreenProps<MainStackParamList, "CustomerProfile">;

function InfoTile({ icon: Icon, label, value }: { icon: typeof Phone; label: string; value: string }) {
  return (
    <View style={{ flex: 1, minWidth: "45%", backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: `${DIR_VIOLET}20`, padding: 13 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <View style={{ width: 22, height: 22, borderRadius: 7, backgroundColor: `${DIR_VIOLET}18`, alignItems: "center", justifyContent: "center" }}>
          <Icon size={11} color={DIR_VIOLET} />
        </View>
        <Text style={{ color: colors.mutedForeground, fontSize: 9.5, fontFamily: fonts.heading.semibold, textTransform: "uppercase", letterSpacing: 0.5 }}>
          {label}
        </Text>
      </View>
      <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13.5, fontFamily: fonts.heading.semibold }}>
        {value}
      </Text>
    </View>
  );
}

export default function CustomerProfileScreen({ route }: Props) {
  const { bookingId, customerName } = route.params;

  const { data: customer, isLoading, error } = useQuery({
    queryKey: ["maint-customer", bookingId],
    queryFn: () => getMaintenanceCustomer(bookingId),
  });

  const { data: payments } = useQuery({
    queryKey: ["maint-payments", bookingId],
    queryFn: () => getMaintenancePayments(bookingId),
  });
  const paymentRows = Array.isArray(payments) ? payments : [];

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    );
  }

  if (error || !customer) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, padding: 16 }}>
        <Text style={{ color: colors.destructive, fontSize: 12.5, fontFamily: fonts.body.regular }}>
          Confirmed booking not found.
        </Text>
      </View>
    );
  }

  const unit = [customer.BlockName, customer.UnitNo].filter(Boolean).join(" / ") || "—";
  const initial = (customerName ?? customer.CustomerName ?? "?").trim().charAt(0).toUpperCase();

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      {/* ── Identity hero ── */}
      <LinearGradient
        colors={[DIR_INK, "#241a3d", DIR_INK]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: 20, padding: 18, marginBottom: 16, overflow: "hidden", borderWidth: 1, borderColor: `${DIR_VIOLET}30`, flexDirection: "row", alignItems: "center", gap: 14 }}
      >
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: `${DIR_VIOLET}1f`,
            borderWidth: 1.5,
            borderColor: `${DIR_VIOLET}45`,
          }}
        >
          <Text style={{ color: DIR_VIOLET, fontSize: 21, fontFamily: fonts.heading.bold }}>{initial}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: "#ede9fe", fontSize: 17, fontFamily: fonts.heading.bold }}>
            {customerName ?? customer.CustomerName ?? "Customer"}
          </Text>
          <Text numberOfLines={1} style={{ color: "rgba(237,233,254,0.65)", fontSize: 11.5, fontFamily: fonts.body.regular, marginTop: 4 }}>
            {customer.BookingNo} · {unit}
          </Text>
        </View>
      </LinearGradient>

      {/* ── Info tiles ── */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 24 }}>
        <InfoTile icon={Phone} label="Contact" value={customer.ContactNumber || "—"} />
        <InfoTile icon={Mail} label="Email" value={customer.Email || "—"} />
        <InfoTile icon={Home} label="Unit" value={unit} />
        <InfoTile icon={Building2} label="Project" value={customer.ProjectName || "—"} />
      </View>

      {/* ── Payment history ── */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 }}>
        <History size={13} color={DIR_VIOLET} />
        <Text style={{ color: colors.foreground, fontSize: 11.5, fontFamily: fonts.heading.semibold, textTransform: "uppercase", letterSpacing: 0.4 }}>
          Payment History
        </Text>
      </View>

      {paymentRows.length === 0 ? (
        <View
          style={{
            alignItems: "center",
            gap: 8,
            paddingVertical: 36,
            paddingHorizontal: 24,
            borderRadius: 16,
            borderWidth: 1,
            borderStyle: "dashed",
            borderColor: colors.border,
          }}
        >
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: `${DIR_VIOLET}14`, alignItems: "center", justifyContent: "center", marginBottom: 4 }}>
            <Wallet size={18} color={DIR_VIOLET} />
          </View>
          <Text style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.body.semibold, textAlign: "center" }}>
            No maintenance payments recorded yet.
          </Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.body.regular, textAlign: "center", maxWidth: 260, lineHeight: 15 }}>
            Payment collection for maintenance charges isn't wired up yet — this section is ready for it.
          </Text>
        </View>
      ) : (
        <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular }}>
          {paymentRows.length} payment(s) on file.
        </Text>
      )}
    </ScrollView>
  );
}
