// Small decorative ring around the CivilierERP mark — used on the login
// card. Generic (no module branding), ported from mobile-supplier's
// SupplierLogoRing minus the emerald-specific palette.
import { View, Image } from "react-native";

export function LogoRing({ size = 64, color = "#eab308" }: { size?: number; color?: string }) {
  const inner = Math.round(size * 0.62);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 2,
        borderColor: `${color}55`,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: `${color}12`,
      }}
    >
      <Image
        source={require("../../assets/branding/Civilier-transparent.png")}
        style={{ width: inner, height: inner, resizeMode: "contain" }}
      />
    </View>
  );
}
