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

// Row-click-to-view: every "view details" (eye) button is marked with
// data-row-view. Its row — a table <tr>, or the repeating item of any list /
// card layout — becomes clickable and opens that same view, and the eye
// button itself is hidden (see index.css). Clicks on the row's own controls
// (edit/delete buttons, links, inputs, checkboxes) and text selections are
// left alone. data-row-view="hide" marks rows that already open the view on
// their own, where the button only needs hiding.
//
// The row of a non-table list is found by walking up from the button to the
// last ancestor that doesn't also contain a sibling item's view button. A
// lone button with no repeating list around it (no row found within a few
// levels) is left visible so its view always stays reachable.
const ROW_MAX_DEPTH = 8;
function findRow(btn: HTMLElement): HTMLElement | null {
  const explicit = btn.closest<HTMLElement>("tr, [data-row]");
  if (explicit) return explicit;
  let el: HTMLElement = btn;
  for (let i = 0; i < ROW_MAX_DEPTH; i++) {
    const parent = el.parentElement;
    if (!parent || parent === document.body || parent.tagName === "MAIN") return null;
    if (parent.querySelectorAll("[data-row-view]").length > 1) {
      return el === btn ? null : el;
    }
    el = parent;
  }
  return null;
}

function markRows() {
  document.querySelectorAll<HTMLElement>("[data-row-view]").forEach((btn) => {
    const row = findRow(btn);
    if (!row) {
      btn.removeAttribute("data-row-view-hidden");
      return;
    }
    btn.setAttribute("data-row-view-hidden", "");
    if (btn.getAttribute("data-row-view") !== "hide") row.setAttribute("data-row-clickable", "");
  });
}
// Sticky actions column: a table whose last column is its row actions
// (header "Action"/"Actions", or an empty header over cells that hold
// buttons) keeps that column pinned to the right while the rest scrolls
// sideways. Each cell's real column is computed (honouring rowSpan /
// colSpan, e.g. grouped two-row headers), and exactly the cells that sit in
// the last column — header and body alike — get .sticky-act, so the header
// stays aligned over its column. See index.css.
function lastColumnCells(table: HTMLTableElement): { cells: HTMLTableCellElement[]; head: HTMLTableCellElement[] } {
  const rows = Array.from(table.rows);
  const taken: boolean[][] = [];
  const placed: { cell: HTMLTableCellElement; end: number; span: number; inHead: boolean }[] = [];
  let ncols = 0;
  rows.forEach((row, r) => {
    taken[r] = taken[r] || [];
    let c = 0;
    Array.from(row.cells).forEach((cell) => {
      while (taken[r][c]) c++;
      const cs = Math.max(1, cell.colSpan || 1);
      const rs = Math.max(1, cell.rowSpan || 1);
      for (let dr = 0; dr < rs; dr++) {
        taken[r + dr] = taken[r + dr] || [];
        for (let dc = 0; dc < cs; dc++) taken[r + dr][c + dc] = true;
      }
      placed.push({ cell, end: c + cs - 1, span: cs, inHead: row.parentElement?.tagName === "THEAD" });
      c += cs;
      ncols = Math.max(ncols, c);
    });
  });
  const last = placed.filter((p) => p.end === ncols - 1 && p.span === 1);
  return { cells: last.map((p) => p.cell), head: last.filter((p) => p.inHead).map((p) => p.cell) };
}
function markStickyActions() {
  document.querySelectorAll<HTMLTableElement>("main table, [role=dialog] table").forEach((table) => {
    const { cells, head } = lastColumnCells(table);
    let isActions = false;
    const label = head.map((h) => (h.textContent || "").trim()).join("");
    if (/^actions?$/i.test(label)) isActions = true;
    else if (!label && head.length) {
      const bodyCell = cells.find((c) => c.parentElement?.parentElement?.tagName === "TBODY");
      isActions = !!bodyCell && !!bodyCell.querySelector("button, a");
    }
    const want = new Set(isActions ? cells : []);
    table.querySelectorAll<HTMLTableCellElement>(".sticky-act").forEach((c) => {
      if (!want.has(c)) c.classList.remove("sticky-act");
    });
    want.forEach((c) => c.classList.add("sticky-act"));
    table.classList.toggle("table-sticky-actions", isActions);
  });
}

let markQueued = false;
new MutationObserver(() => {
  if (markQueued) return;
  markQueued = true;
  requestAnimationFrame(() => {
    markQueued = false;
    markRows();
    markStickyActions();
  });
}).observe(document.documentElement, { childList: true, subtree: true });

document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement | null;
  const row = target?.closest?.<HTMLElement>("[data-row-clickable]");
  if (!row) return;
  const viewBtn = Array.from(
    row.querySelectorAll<HTMLElement>('[data-row-view]:not([data-row-view="hide"])'),
  ).find((b) => findRow(b) === row);
  if (!viewBtn) return;
  const interactive = target!.closest(
    'button, a, input, select, textarea, label, [role="button"], [role="checkbox"], [role="menuitem"], [role="combobox"], [data-no-row-click]',
  );
  if (interactive && row.contains(interactive)) return;
  if (window.getSelection()?.toString()) return;
  viewBtn.click();
});

// Overflow tooltip for tables: hovering a cell value that's cut off ("…")
// shows its full text in a small tooltip. Values that fit show nothing, and
// elements with their own title / tooltip are left alone.
(() => {
  const ROW_SCOPE = "table, .ai-row";
  let tip: HTMLDivElement | null = null;
  let current: HTMLElement | null = null;
  const hide = () => {
    current = null;
    if (tip) tip.style.opacity = "0";
  };
  const isClipped = (el: HTMLElement) =>
    el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
  const findClipped = (start: HTMLElement): HTMLElement | null => {
    let el: HTMLElement | null = start;
    for (let i = 0; el && i < 4; i++, el = el.parentElement) {
      if (el.matches("td, th, table") || el.classList.contains("ai-row")) break;
      const cs = getComputedStyle(el);
      const clips = cs.textOverflow === "ellipsis" || cs.webkitLineClamp !== "none" || cs.overflow === "hidden";
      if (clips && isClipped(el) && (el.textContent || "").trim()) return el;
    }
    // The cell itself may be the clipping box.
    const cell = start.closest<HTMLElement>("td, th");
    if (cell && isClipped(cell) && getComputedStyle(cell).overflow !== "visible") return cell;
    return null;
  };
  document.addEventListener("pointerover", (e) => {
    const target = e.target as HTMLElement | null;
    if (!target?.closest || !target.closest(ROW_SCOPE) || target.closest("[title], [data-radix-popper-content-wrapper]")) return;
    const el = findClipped(target);
    if (!el) return hide();
    if (el === current) return;
    current = el;
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "cell-overflow-tip";
      tip.setAttribute("role", "tooltip");
      document.body.appendChild(tip);
    }
    tip.textContent = (el.textContent || "").replace(/\s+/g, " ").trim();
    const r = el.getBoundingClientRect();
    tip.style.opacity = "1";
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - tw - 8));
    const top = r.top - th - 6 < 8 ? r.bottom + 6 : r.top - th - 6;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  });
  document.addEventListener("pointerout", (e) => {
    if (current && !current.contains(e.relatedTarget as Node | null)) hide();
  });
  window.addEventListener("scroll", hide, true);
})();

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
