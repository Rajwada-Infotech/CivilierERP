// RN port of src/pages/supplier/SupplierCompanyProfile.tsx (web) — same
// GET /me data (company name/code, contact details, GST/payment terms),
// same emerald gradient hero + two info-card layout, dark-shell styling to
// match the rest of the authenticated app (Dashboard/Catalog/OrderDetail).
import { ActivityIndicator, ScrollView, Text, View, Pressable, Alert } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";
import {
  User,
  Mail,
  Phone,
  MapPin,
  Globe,
  Hash,
  CreditCard,
  FileText,
  Tag,
  Landmark,
  CheckCircle2,
  LogOut,
} from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import * as spApi from "@/api/supplierPortalApi";
import { fonts } from "@/theme/fonts";

function InfoRow({
  icon: Icon,
  label,
  value,
  mono = false,
  highlight = false,
}: {
  icon: React.ComponentType<{ size?: number; color?: string }>;
  label: string;
  value?: string | null;
  mono?: boolean;
  highlight?: boolean;
}) {
  if (!value) return null;
  return (
    <View className="flex-row items-start gap-3" style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#21212c" }}>
      <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: "rgba(16,185,129,0.10)", alignItems: "center", justifyContent: "center", marginTop: 1 }}>
        <Icon size={12} color="#6ee7b7" />
      </View>
      <View className="flex-1 min-w-0">
        <Text style={{ fontSize: 9, fontFamily: fonts.heading.bold, color: "#5c6270", textTransform: "uppercase", letterSpacing: 1, marginBottom: 1 }}>
          {label}
        </Text>
        <Text
          style={{
            fontSize: 13,
            fontFamily: mono ? fonts.body.semibold : fonts.body.medium,
            color: highlight ? "#6ee7b7" : "#e7e9ef",
          }}
        >
          {value}
        </Text>
      </View>
    </View>
  );
}

export default function ProfileScreen() {
  const { currentUser, logout } = useAuth();

  const profileQ = useQuery({
    queryKey: ["supplier-profile"],
    queryFn: spApi.getSupplierProfile,
    staleTime: 5 * 60_000,
  });
  const profile = profileQ.data;

  if (profileQ.isLoading) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: "#0c0c12" }}>
        <ActivityIndicator color="#818898" />
      </View>
    );
  }

  const name = profile?.Name ?? currentUser?.name ?? "Supplier";
  const initials = name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const isActive = !profile?.LHeadStatus || profile.LHeadStatus === "Approved";

  const confirmSignOut = () =>
    Alert.alert("Sign out?", "You'll need to log in again to access the supplier portal.", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: () => logout() },
    ]);

  return (
    <ScrollView className="flex-1" style={{ backgroundColor: "#0c0c12" }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <LinearGradient
        colors={["#052e16", "#064e3b", "#047857"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: 18, padding: 20, marginBottom: 16, overflow: "hidden" }}
      >
        <View className="flex-row items-center gap-4">
          <View style={{ width: 58, height: 58, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.12)", borderWidth: 1, borderColor: "rgba(255,255,255,0.20)", alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontSize: 19, fontFamily: fonts.heading.bold, color: "#fff" }}>{initials}</Text>
          </View>
          <View className="flex-1 min-w-0">
            <Text style={{ fontSize: 9, fontFamily: fonts.heading.bold, color: "rgba(110,231,183,0.6)", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 3 }}>
              Supplier Company
            </Text>
            <Text numberOfLines={2} style={{ fontSize: 17, fontFamily: fonts.heading.bold, color: "#fff" }}>
              {name}
            </Text>
            {profile?.LHeadCode && (
              <View className="flex-row items-center gap-1" style={{ marginTop: 4 }}>
                <Hash size={10} color="rgba(110,231,183,0.6)" />
                <Text style={{ fontSize: 11, fontFamily: fonts.body.medium, color: "rgba(167,243,208,0.7)" }}>{profile.LHeadCode}</Text>
              </View>
            )}
          </View>
        </View>

        <View className="flex-row" style={{ marginTop: 14 }}>
          {isActive ? (
            <View className="flex-row items-center gap-1.5" style={{ backgroundColor: "rgba(52,211,153,0.15)", borderWidth: 1, borderColor: "rgba(52,211,153,0.25)", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 }}>
              <CheckCircle2 size={11} color="#6ee7b7" />
              <Text style={{ fontSize: 11, fontFamily: fonts.heading.bold, color: "#6ee7b7" }}>Active</Text>
            </View>
          ) : (
            <View style={{ backgroundColor: "rgba(255,255,255,0.10)", borderWidth: 1, borderColor: "rgba(255,255,255,0.20)", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 }}>
              <Text style={{ fontSize: 11, fontFamily: fonts.heading.bold, color: "#cbd5e1" }}>{profile?.LHeadStatus}</Text>
            </View>
          )}
        </View>

        {profile?.LDescription && (
          <View style={{ marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.10)" }}>
            <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: "rgba(255,255,255,0.55)", fontStyle: "italic", lineHeight: 18 }}>
              "{profile.LDescription}"
            </Text>
          </View>
        )}
      </LinearGradient>

      {/* ── Contact details ──────────────────────────────────────────── */}
      <View style={{ borderRadius: 14, borderWidth: 1, borderColor: "#272735", backgroundColor: "#15151e", padding: 16, marginBottom: 12 }}>
        <View className="flex-row items-center gap-2 mb-1">
          <User size={13} color="#6ee7b7" />
          <Text style={{ fontSize: 13, fontFamily: fonts.heading.bold, color: "#e7e9ef" }}>Contact Details</Text>
        </View>
        <View style={{ marginTop: 4 }}>
          <InfoRow icon={User} label="Contact Person" value={profile?.LHeadContactPerson} />
          <InfoRow icon={Mail} label="Email" value={profile?.LHeadEmail} />
          <InfoRow icon={Phone} label="Phone" value={profile?.LHeadPhone} />
          <InfoRow icon={MapPin} label="Address" value={profile?.LHeadAddress} />
          <InfoRow icon={Globe} label="Country" value={profile?.LCountry} />
        </View>
      </View>

      {/* ── Financial info ───────────────────────────────────────────── */}
      <View style={{ borderRadius: 14, borderWidth: 1, borderColor: "#272735", backgroundColor: "#15151e", padding: 16, marginBottom: 16 }}>
        <View className="flex-row items-center gap-2 mb-1">
          <Landmark size={13} color="#6ee7b7" />
          <Text style={{ fontSize: 13, fontFamily: fonts.heading.bold, color: "#e7e9ef" }}>Financial Info</Text>
        </View>
        <View style={{ marginTop: 4 }}>
          <InfoRow icon={CreditCard} label="GST Number" value={profile?.LGST} mono highlight />
          <InfoRow icon={MapPin} label="GST State" value={profile?.LGSTState} />
          <InfoRow icon={FileText} label="Payment Terms" value={profile?.LHeadPaymentTerms} />
          <InfoRow icon={Tag} label="Belongs To" value={profile?.LBelongsTo} />
          <InfoRow icon={Hash} label="Supplier Code" value={profile?.LHeadCode} mono />
        </View>
      </View>

      <Text style={{ fontSize: 11, fontFamily: fonts.body.regular, color: "#5c6270", textAlign: "center", marginBottom: 20 }}>
        To update company details, contact your procurement team.
      </Text>

      <Pressable
        onPress={confirmSignOut}
        className="flex-row items-center justify-center gap-2"
        style={{ borderRadius: 12, borderWidth: 1, borderColor: "rgba(220,40,40,0.25)", backgroundColor: "rgba(220,40,40,0.08)", paddingVertical: 13 }}
      >
        <LogOut size={15} color="#f87171" />
        <Text style={{ fontSize: 13, fontFamily: fonts.body.semibold, color: "#f87171" }}>Sign Out</Text>
      </Pressable>
    </ScrollView>
  );
}
