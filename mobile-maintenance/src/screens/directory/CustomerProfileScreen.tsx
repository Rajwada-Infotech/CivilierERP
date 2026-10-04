// Customer Maintenance Profile — direct port of the web app's
// src/pages/maintenance/CustomerMaintenanceProfile.tsx: contact/unit/
// project info + payment history (empty state until maintenance payment
// collection is wired up, same as web). Same "Resident Directory" violet
// identity as DirectoryScreen.tsx, which this opens from.
import { View, Text, ScrollView, ActivityIndicator } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useQuery } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Phone, Mail, Home, Building2, History, Wallet, ListChecks, Receipt, Ticket } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { getMaintenanceCustomer, getMaintenanceCharges } from "@/api/maintenanceApi";
import { getMaintenanceBills } from "@/api/maintenanceBillApi";
import { getTicketsForBooking } from "@/api/serviceTicketApi";
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

  const { data: charges } = useQuery({
    queryKey: ["maint-charges", bookingId],
    queryFn: () => getMaintenanceCharges(bookingId),
  });
  const { data: bills } = useQuery({
    queryKey: ["maint-bills-customer", bookingId],
    queryFn: () => getMaintenanceBills({ bookingId }),
  });
  const { data: tickets } = useQuery({
    queryKey: ["maint-tickets-booking", bookingId],
    queryFn: () => getTicketsForBooking(bookingId),
  });

  const chargeRows = Array.isArray(charges) ? charges : [];
  const billRows   = Array.isArray(bills)   ? bills   : [];
  const ticketRows = Array.isArray(tickets) ? tickets : [];
  const activeBills = billRows.filter((b) => b.Status === "Active");
  const totalBilled = activeBills.reduce((s, b) => s + (Number(b.GrandTotal) || 0), 0);
  const openTickets = ticketRows.filter((t) => !["Closed", "Resolved"].includes(t.Status));

  const INR = (n: number | null | undefined) =>
    `\u20B9${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
        <InfoTile icon={Phone}     label="Contact" value={customer.ContactNumber || "\u2014"} />
        <InfoTile icon={Mail}      label="Email"   value={customer.Email || "\u2014"} />
        <InfoTile icon={Home}      label="Unit"    value={unit} />
        <InfoTile icon={Building2} label="Project" value={customer.ProjectName || "\u2014"} />
      </View>

      {/* ── Quick stats ── */}
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 20 }}>
        {[
          { label: "Charges", value: String(chargeRows.length),         icon: ListChecks, color: "#65a30d" },
          { label: "Billed",  value: INR(totalBilled),                  icon: Wallet,     color: "#f59e0b" },
          { label: "Tickets", value: `${openTickets.length} open`,      icon: Ticket,     color: DIR_VIOLET },
        ].map((s) => (
          <View key={s.label} style={{ flex: 1, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: `${s.color}30`, padding: 11 }}>
            <s.icon size={13} color={s.color} />
            <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.bold, marginTop: 6 }}>{s.value}</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 9.5, fontFamily: fonts.heading.semibold, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 2 }}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* ── Bills ── */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 }}>
        <Receipt size={13} color="#f59e0b" />
        <Text style={{ color: colors.foreground, fontSize: 11.5, fontFamily: fonts.heading.semibold, textTransform: "uppercase", letterSpacing: 0.4 }}>
          Bills
        </Text>
      </View>
      {billRows.length === 0 ? (
        <View style={{ alignItems: "center", paddingVertical: 28, borderRadius: 14, borderWidth: 1, borderColor: colors.border, marginBottom: 20 }}>
          <Receipt size={18} color={colors.mutedForeground} />
          <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, marginTop: 8 }}>No bills raised yet.</Text>
        </View>
      ) : (
        <View style={{ borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: "hidden", marginBottom: 20 }}>
          {billRows.map((b, i) => (
            <View key={b.Id} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 13, paddingVertical: 10, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.border }}>
              <View>
                <Text style={{ fontSize: 11.5, fontFamily: fonts.body.medium, color: colors.foreground }}>{b.BillNo}</Text>
                <Text style={{ fontSize: 10, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>{b.BillDate ? new Date(b.BillDate).toLocaleDateString("en-IN") : ""}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{INR(b.GrandTotal)}</Text>
                <Text style={{ fontSize: 10, fontFamily: fonts.body.regular, color: b.Status === "Active" ? "#059669" : "#ef4444" }}>{b.Status}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* ── Service Ticket summary ── */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 }}>
        <Ticket size={13} color={DIR_VIOLET} />
        <Text style={{ color: colors.foreground, fontSize: 11.5, fontFamily: fonts.heading.semibold, textTransform: "uppercase", letterSpacing: 0.4 }}>
          Service Tickets
        </Text>
      </View>
      {ticketRows.length === 0 ? (
        <View style={{ alignItems: "center", paddingVertical: 28, borderRadius: 14, borderWidth: 1, borderColor: colors.border }}>
          <Ticket size={18} color={colors.mutedForeground} />
          <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, marginTop: 8 }}>No service tickets yet.</Text>
        </View>
      ) : (
        <View style={{ borderRadius: 14, borderWidth: 1, borderColor: `${DIR_VIOLET}30`, overflow: "hidden" }}>
          {ticketRows.map((t, i) => (
            <View key={t.Id} style={{ paddingHorizontal: 13, paddingVertical: 10, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.border }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 3 }}>
                <Text style={{ fontSize: 10, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>{t.TicketNo}</Text>
                <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: `${DIR_VIOLET}18` }}>
                  <Text style={{ fontSize: 10, fontFamily: fonts.heading.semibold, color: DIR_VIOLET }}>{t.Status}</Text>
                </View>
                <Text style={{ fontSize: 10, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>{t.Category}</Text>
              </View>
              <Text numberOfLines={1} style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: colors.foreground }}>{t.Subject}</Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

