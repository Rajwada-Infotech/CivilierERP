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
  optimizeDeps: {
    exclude: ["bcryptjs", "express", "morgan", "dotenv", "bun", "vercel"],
    include: ["jspdf", "jspdf-autotable", "fflate"],
  },
  server: {
    port: 8080,
    host: true,
    open: true,
    proxy: {
      "/api/user-activity/stream": {
        target: "http://localhost:5000",
        changeOrigin: true,
        ws: false,
        timeout: 0,
        proxyTimeout: 0,
        configure: (proxy) => {
          proxy.on("error", (err, _req, res) => {
            if ((err as NodeJS.ErrnoException).code !== "ECONNRESET") {
              console.log("SSE proxy error", err);
            }
            try {
              if (!res.headersSent) {
                res.writeHead(502);
                res.end("SSE proxy error");
              }
            } catch (_) {}
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
    sourcemap: false,
  },
});
