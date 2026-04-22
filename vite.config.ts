import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 8080,
    host: true,
    open: true,
    proxy: {
      // ── SSE route: dedicated entry BEFORE the generic /api catch-all ──────
      // Vite matches proxy keys longest-first, so this takes priority.
      "/api/user-activity/stream": {
        target: "http://localhost:5000",
        changeOrigin: true,
        ws: false,
        timeout: 0, // disable proxy-level socket timeout
        proxyTimeout: 0, // disable upstream response timeout
        configure: (proxy) => {
          proxy.on("error", (err, _req, res) => {
            // ECONNRESET when the browser tab closes is completely normal for
            // SSE — swallow it silently instead of spamming the console.
            if ((err as NodeJS.ErrnoException).code !== "ECONNRESET") {
              console.log("SSE proxy error", err);
            }
            try {
              if (!res.headersSent) {
                res.writeHead(502);
                res.end("SSE proxy error");
              }
            } catch (_) {
              // response already gone — ignore
            }
          });
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.setHeader("Connection", "keep-alive");
            proxyReq.setHeader("Cache-Control", "no-cache");
          });
          proxy.on("proxyRes", (proxyRes) => {
            proxyRes.headers["connection"] = "keep-alive";
            proxyRes.headers["x-accel-buffering"] = "no";
          });
        },
      },

      // ── All other API routes ───────────────────────────────────────────────
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("error", (err, _req, _res) => {
            console.log("proxy error", err);
          });
        },
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
