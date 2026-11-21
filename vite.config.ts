import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import net from "net";
import fs from "fs";

// Dev proxy while the backend restarts (nodemon restarts it on every backend file change, e.g. after a pull):
//  - GET / HEAD requests wait for it (its port is checked every 500 ms, for up to 20 s) and are then sent once, so a
//    page loading mid-restart just takes a moment longer instead of failing;
//  - anything else (a save) gets a 503 with a plain message rather than a bare 502, since its body can't be replayed;
//  - the log says once that the backend is down and once that it's back, instead of a stack trace per request.
// Vite adds its own error listener after `configure` (it logs every failure and answers 502); ours replaces it.
type ProxyLike = {
  on: (event: string, fn: (...args: any[]) => void) => unknown;
  web: (req: any, res: any, opts?: any) => void;
};
const CHECK_EVERY_MS = 500;
const WAIT_UP_TO_MS = 20_000;
let backendDown = false;

function portOpen(target: string): Promise<boolean> {
  const u = new URL(target);
  return new Promise((resolve) => {
    const sock = net.connect({ host: u.hostname === "localhost" ? "127.0.0.1" : u.hostname, port: Number(u.port || 80) });
    const done = (ok: boolean) => { sock.destroy(); resolve(ok); };
    sock.setTimeout(1000, () => done(false));
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
  });
}
async function waitForBackend(target: string, isGone: () => boolean): Promise<boolean> {
  const until = Date.now() + WAIT_UP_TO_MS;
  while (Date.now() < until && !isGone()) {
    if (await portOpen(target)) return true;
    await new Promise((r) => setTimeout(r, CHECK_EVERY_MS));
  }
  return false;
}

function gracefulProxy(target: string) {
  return (proxy: ProxyLike) => {
    const on = proxy.on.bind(proxy);
    let ours = false;
    proxy.on = (event: string, fn: (...args: any[]) => void) => (event === "error" && ours ? proxy : on(event, fn));
    on("error", async (err: NodeJS.ErrnoException, req: any, res: any) => {
      const down = err.code === "ECONNREFUSED" || err.code === "ECONNRESET" || err.code === "ECONNABORTED";
      if (!down) console.error("[proxy error]", req?.url, err.message);
      else if (!backendDown) {
        backendDown = true;
        console.log(`[proxy] backend at ${target} is not answering (restarting?) - holding page requests until it is back`);
      }
      // WebSocket upgrade: res is the socket; the client (socket.io) reconnects by itself.
      if (!res || typeof res.writeHead !== "function") {
        res?.end?.();
        return;
      }
      if (res.headersSent || res.writableEnded) return;
      const method = String(req?.method || "GET").toUpperCase();
      if (down && (method === "GET" || method === "HEAD") && !req.__proxyRetried) {
        req.__proxyRetried = true;
        if (await waitForBackend(target, () => res.writableEnded || req.socket?.destroyed)) {
          if (backendDown) {
            backendDown = false;
            console.log("[proxy] backend is back");
          }
          proxy.web(req, res);
          return;
        }
      }
      if (res.headersSent || res.writableEnded) return;
      res.writeHead(503, { "Content-Type": "application/json", "Retry-After": "2" });
      res.end(JSON.stringify({ error: "The server is restarting. Try again in a moment." }));
    });
    ours = true;
  };
}

// The project folder as Windows actually spells it. Started from a differently-cased path (e.g. "...\desktop\..."),
// Vite served some files twice - once as /src/..., once as /@fs/<other casing>/... - so modules like AuthContext existed
// twice and the page crashed ("useAuth must be used inside AuthProvider").
const ROOT = fs.realpathSync.native(import.meta.dirname);

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ROOT, "");
  const backendUrl = env.VITE_BACKEND_URL || "http://localhost:5000";
  return {
  root: ROOT,
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    proxy: {
      "/api": {
        target: backendUrl,
        changeOrigin: true,
        secure: false,
        ws: true,
        // Was 0 (infinite) — a backend restart mid-request left the proxy
        // holding a dead socket that never errored out, so every request
        // through it hung forever instead of failing fast. 30s is generous
        // enough for slow reports/exports but still bounded.
        timeout: 30_000,
        proxyTimeout: 30_000,
        configure: gracefulProxy(backendUrl),
      },
      "/socket.io": {
        target: backendUrl,
        changeOrigin: true,
        ws: true,
        secure: false,
        configure: gracefulProxy(backendUrl),
      },
    },
  },
  plugins: [react()],
  build: {
    // Raise the warning threshold slightly — jspdf/html2canvas are
    // intentionally large and can't be split further without async imports.
    chunkSizeWarningLimit: 600,

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
      "@": path.resolve(ROOT, "./src"),
    },
  },
};
});
