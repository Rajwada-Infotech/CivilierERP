/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./App.tsx", "./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // The web app's default (dark) theme tokens (src/index.css), as in src/theme/colors.ts.
        primary: "#6467f2",
        background: "#0f1114",
        card: "#17191e",
        border: "#373a43",
        muted: "#9ba0ab",
        foreground: "#dcdfe5",
        destructive: "#e34545",
      },
    },
  },
  plugins: [],
};
