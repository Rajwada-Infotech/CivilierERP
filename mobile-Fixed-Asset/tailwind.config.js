/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./App.tsx", "./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Kept in sync with src/theme/colors.ts (hex of the web app's dark
        // theme tokens) so `className="bg-background"` and inline
        // `style={{ backgroundColor: colors.background }}` render the same.
        primary: "#6467f2",
        background: "#0c0c12",
        card: "#15151e",
        border: "#272735",
        muted: "#818898",
        foreground: "#e7e9ef",
        destructive: "#dc2828",
        accent: "#eab308",
      },
    },
  },
  plugins: [],
};
