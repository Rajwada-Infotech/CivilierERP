import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// Suppress ECONNREFUSED noise when backend is not running
function silentProxyError(err: NodeJS.ErrnoException) {
  if (err.code === "ECONNREFUSED" || err.code === "ECONNRESET") return;
  console.error("[proxy error]", err.message);
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    proxy: {
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
        secure: false,
        ws: true,
        // Was 0 (infinite) — a backend restart mid-request left the proxy
        // holding a dead socket that never errored out, so every request
        // through it hung forever instead of failing fast. 30s is generous
        // enough for slow reports/exports but still bounded.
        timeout: 30_000,
        proxyTimeout: 30_000,
        configure: (proxy) => {
          proxy.on("error", silentProxyError);
        },
      },
      "/socket.io": {
        target: "http://localhost:5000",
        changeOrigin: true,
        ws: true,
        secure: false,
        configure: (proxy) => {
          proxy.on("error", silentProxyError);
        },
      },
    },
  },
  plugins: [react()],
  build: {
    // Raise the warning threshold slightly — jspdf/html2canvas are
    // intentionally large and can't be split further without async imports.
    chunkSizeWarningLimit: 600,

    rolldownOptions: {
      // Silence the lottie-web eval() warning — it's a third-party player
      // that uses indirect eval internally; we cannot change its source.
      onwarn(warning, defaultHandler) {
        if (warning.code === "EVAL" && warning.id?.includes("lottie-web")) {
          return;
        }
        defaultHandler(warning);
      },
    },

    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          const n = id.replace(/\\/g, "/");

          // ── Core React runtime ──────────────────────────────────────────
          if (
            n.includes("/node_modules/react/") ||
            n.includes("/node_modules/react-dom/") ||
            n.includes("/node_modules/scheduler/") ||
            n.includes("/node_modules/react-router") ||
            n.includes("/node_modules/@remix-run/") ||
            n.includes("/node_modules/@tanstack/")
          )
            return "vendor-framework";

          // ── PDF / export ────────────────────────────────────────────────
          if (n.includes("/node_modules/jspdf/")) return "vendor-jspdf";
          if (n.includes("/node_modules/html2canvas/"))
            return "vendor-html2canvas";
          if (n.includes("/node_modules/@react-pdf/"))
            return "vendor-react-pdf";
          if (
            n.includes("/node_modules/fontkit/") ||
            n.includes("/node_modules/hyphen/") ||
            n.includes("/node_modules/linebreak/") ||
            n.includes("/node_modules/png-js/") ||
            n.includes("/node_modules/unicode-properties/") ||
            n.includes("/node_modules/yoga-layout/")
          )
            return "vendor-pdf-support";
          if (
            n.includes("/node_modules/dompurify/") ||
            n.includes("/node_modules/fflate/")
          )
            return "vendor-export-utils";

          // ── Charts / data-vis ───────────────────────────────────────────
          if (
            n.includes("/node_modules/recharts") ||
            n.includes("/node_modules/d3-") ||
            n.includes("/node_modules/victory-vendor/")
          )
            return "vendor-charts";

          // ── Spreadsheet / xlsx ──────────────────────────────────────────
          if (n.includes("/node_modules/xlsx/")) return "vendor-xlsx";

          // ── Animation ───────────────────────────────────────────────────
          if (
            n.includes("/node_modules/lottie-web/") ||
            n.includes("/node_modules/@lottiefiles/")
          )
            return "vendor-lottie";
          if (
            n.includes("/node_modules/framer-motion/") ||
            n.includes("/node_modules/motion-dom/")
          )
            return "vendor-motion";

          // ── Real-time / networking ──────────────────────────────────────
          if (
            n.includes("/node_modules/socket.io-client/") ||
            n.includes("/node_modules/engine.io-client/") ||
            n.includes("/node_modules/@socket.io/")
          )
            return "vendor-socketio";

          // ── Radix UI primitives ─────────────────────────────────────────
          if (n.includes("/node_modules/@radix-ui/")) return "vendor-radix";

          // ── Date utilities ──────────────────────────────────────────────
          if (
            n.includes("/node_modules/date-fns/") ||
            n.includes("/node_modules/date-fns-jalali/") ||
            n.includes("/node_modules/react-day-picker/")
          )
            return "vendor-dates";

          // ── Forms / validation ──────────────────────────────────────────
          if (
            n.includes("/node_modules/react-hook-form/") ||
            n.includes("/node_modules/@hookform/") ||
            n.includes("/node_modules/zod/")
          )
            return "vendor-forms";

          // ── Small UI utilities ──────────────────────────────────────────
          if (
            n.includes("/node_modules/lucide-react/") ||
            n.includes("/node_modules/sonner/") ||
            n.includes("/node_modules/cmdk/") ||
            n.includes("/node_modules/vaul/") ||
            n.includes("/node_modules/embla-carousel") ||
            n.includes("/node_modules/tailwind-merge/") ||
            n.includes("/node_modules/class-variance-authority/") ||
            n.includes("/node_modules/clsx/")
          )
            return "vendor-ui-utils";

          // ── HTTP / misc ─────────────────────────────────────────────────
          if (n.includes("/node_modules/axios/")) return "vendor-http";

          // ── Everything else in node_modules ────────────────────────────
          return "vendor-misc";
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
