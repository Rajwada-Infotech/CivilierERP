import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";

// Global safety net: unhandled promise rejections that slip past React Query
// are logged to the console (visible in DevTools / server logs) but never
// silently swallowed. The app stays running — only the failing component
// needs to show a graceful state.
window.addEventListener("unhandledrejection", (e) => {
  console.error("[Unhandled Promise Rejection]", e.reason);
});

// Catch synchronous JS errors outside the React tree (e.g. in event listeners
// wired by third-party scripts). Log them; do not alert or crash the UI.
window.addEventListener("error", (e) => {
  if (e.error) console.error("[Uncaught Error]", e.error);
});

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
