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

// Browsers step a focused <input type="number"> on mouse-wheel, silently
// changing amounts/quantities while the user just meant to scroll the page.
// Blur it first so the wheel scrolls the page and the value stays put.
document.addEventListener(
  "wheel",
  (e) => {
    const el = e.target as HTMLElement | null;
    if (
      el instanceof HTMLInputElement &&
      el.type === "number" &&
      document.activeElement === el
    ) {
      el.blur();
    }
  },
  { passive: true, capture: true },
);

// Row-click-to-view: a table row whose "view details" (eye) button is marked
// with data-row-view opens that same view when the row itself is clicked, so
// the eye button can be hidden (see index.css). Clicks on the row's other
// controls (edit/delete buttons, links, inputs, checkboxes) and text
// selections are left alone. data-row-view="hide" marks rows that already
// open the view on their own, where the button only needs hiding.
document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement | null;
  const row = target?.closest?.("tr");
  if (!row) return;
  const viewBtn = row.querySelector<HTMLElement>('[data-row-view]:not([data-row-view="hide"])');
  if (!viewBtn || viewBtn.closest("tr") !== row) return;
  const interactive = target!.closest(
    'button, a, input, select, textarea, label, [role="button"], [role="checkbox"], [role="menuitem"], [role="combobox"], [data-no-row-click]',
  );
  if (interactive && row.contains(interactive)) return;
  if (window.getSelection()?.toString()) return;
  viewBtn.click();
});

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
