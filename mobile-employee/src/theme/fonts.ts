// Same two-font system as the web app (tailwind.config.ts fontFamily.heading
// / .body, loaded via Google Fonts in src/index.css): Sora for headings,
// DM Sans for body text. Bundled as real font files here via
// @expo-google-fonts/* instead of a <link> — RN has no CSS @font-face.
import {
  useFonts,
  Sora_400Regular,
  Sora_500Medium,
  Sora_600SemiBold,
  Sora_700Bold,
} from "@expo-google-fonts/sora";
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
} from "@expo-google-fonts/dm-sans";

export const fonts = {
  heading: {
    regular: "Sora_400Regular",
    medium: "Sora_500Medium",
    semibold: "Sora_600SemiBold",
    bold: "Sora_700Bold",
  },
  body: {
    regular: "DMSans_400Regular",
    medium: "DMSans_500Medium",
    semibold: "DMSans_600SemiBold",
    bold: "DMSans_700Bold",
  },
} as const;

export function useAppFonts() {
  return useFonts({
    Sora_400Regular,
    Sora_500Medium,
    Sora_600SemiBold,
    Sora_700Bold,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
  });
}
