/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./App.tsx", "./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Mirrors the web app's semantic tokens (src/index.css) so screens
        // built here read the same way as the Finance/Material/CRM web UI.
        primary: "#6366f1",
        background: "#0b0f19",
        card: "#111826",
        border: "#1f2937",
        muted: "#6b7280",
        foreground: "#e5e7eb",
        destructive: "#ef4444",
      },
    },
  },
  plugins: [],
};
