import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    proxy: {
      // Proxy /api/* → local Express backend on port 5000
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
        secure: false,
        ws: true,
        timeout: 0,
        proxyTimeout: 0,
      },
      // Ensure socket.io traffic also reaches the backend (port 5000).
      // Critical: ws: true for WebSocket upgrade.
      "/socket.io": {
        target: "http://localhost:5000",
        changeOrigin: true,
        ws: true,
        secure: false,
      },
    },
  },
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          const normalizedId = id.replace(/\\/g, "/");

          if (
            normalizedId.includes("/node_modules/react/") ||
            normalizedId.includes("/node_modules/react-dom/") ||
            normalizedId.includes("/node_modules/scheduler/") ||
            normalizedId.includes("/node_modules/react-router") ||
            normalizedId.includes("/node_modules/@remix-run/") ||
            normalizedId.includes("/node_modules/@tanstack/")
          ) {
            return "vendor-framework";
          }
          if (normalizedId.includes("/node_modules/@radix-ui/")) {
            return "vendor-ui";
          }
          if (
            normalizedId.includes("/node_modules/recharts") ||
            normalizedId.includes("/node_modules/d3-") ||
            normalizedId.includes("/node_modules/victory-vendor/")
          ) {
            return "vendor-charts";
          }
          if (normalizedId.includes("/node_modules/framer-motion/")) {
            return "vendor-ui";
          }
          if (normalizedId.includes("/node_modules/motion-dom/")) {
            return "vendor-ui";
          }
          if (normalizedId.includes("/node_modules/@react-pdf/")) {
            return "vendor-react-pdf";
          }
          if (
            normalizedId.includes("/node_modules/fontkit/") ||
            normalizedId.includes("/node_modules/hyphen/") ||
            normalizedId.includes("/node_modules/linebreak/") ||
            normalizedId.includes("/node_modules/png-js/") ||
            normalizedId.includes("/node_modules/unicode-properties/") ||
            normalizedId.includes("/node_modules/yoga-layout/")
          ) {
            return "vendor-pdf-support";
          }
          if (normalizedId.includes("/node_modules/jspdf/")) {
            return "vendor-jspdf";
          }
          if (normalizedId.includes("/node_modules/html2canvas/")) {
            return "vendor-html2canvas";
          }
          if (
            normalizedId.includes("/node_modules/dompurify/") ||
            normalizedId.includes("/node_modules/fflate/")
          ) {
            return "vendor-export-utils";
          }
          if (normalizedId.includes("/node_modules/lucide-react/")) {
            return "vendor-ui";
          }
          if (normalizedId.includes("/node_modules/date-fns/")) {
            return "vendor-ui";
          }
          if (
            normalizedId.includes("/node_modules/react-day-picker/") ||
            normalizedId.includes("/node_modules/date-fns-jalali/")
          ) {
            return "vendor-ui";
          }
          if (
            normalizedId.includes("/node_modules/react-hook-form/") ||
            normalizedId.includes("/node_modules/@hookform/") ||
            normalizedId.includes("/node_modules/zod/")
          ) {
            return "vendor-ui";
          }
          if (
            normalizedId.includes("/node_modules/sonner/") ||
            normalizedId.includes("/node_modules/cmdk/") ||
            normalizedId.includes("/node_modules/vaul/") ||
            normalizedId.includes("/node_modules/embla-carousel")
          ) {
            return "vendor-ui";
          }
          if (
            normalizedId.includes("/node_modules/axios/") ||
            normalizedId.includes("/node_modules/tailwind-merge/") ||
            normalizedId.includes("/node_modules/class-variance-authority/") ||
            normalizedId.includes("/node_modules/clsx/")
          ) {
            return "vendor-ui";
          }
          return "vendor";
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
