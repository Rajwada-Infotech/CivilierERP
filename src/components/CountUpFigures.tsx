// Dashboard figures count up. Wrap a dashboard (withCountUp) and every large number on it — a text that is just a
// figure, e.g. "1,234", "₹ 12.5 Cr", "87%", set at 18px or more — runs up from 0 when it first appears, and from the
// old value to the new one when a refresh changes it. Table cells, inputs and anything inside [data-no-count] are left
// alone. Nothing moves under reduced motion. It only rewrites the digits of text React already rendered and always
// ends on React's exact text, so the page reads the same once it settles.
import React, { useEffect, useRef } from "react";

const FIGURE = /^(\D{0,4}?)(-?\d[\d,]*(?:\.\d+)?)(\s?\D{0,4})$/;
const MIN_PX = 18;
const DURATION = 900;
const ease = (t: number) => 1 - Math.pow(1 - t, 4);

interface Run { target: string; shown: string; value: number; raf: number; timer: number }

function parse(text: string) {
  const m = FIGURE.exec(text.trim());
  if (!m || /\d/.test(m[1]) || /\d/.test(m[3])) return null;
  const raw = m[2];
  const value = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;
  const decimals = raw.includes(".") ? raw.split(".")[1].length : 0;
  const grouping = !raw.includes(",") ? null : /\d,\d\d,/.test(raw) || /^-?\d{1,2},\d\d,\d{3}/.test(raw) ? "en-IN" : "en-US";
  const at = text.indexOf(raw);
  return { value, decimals, grouping, before: text.slice(0, at), after: text.slice(at + raw.length) };
}

function eligible(node: Text) {
  const el = node.parentElement;
  if (!el || el.closest("td, th, input, textarea, select, [data-no-count]")) return false;
  return parseFloat(getComputedStyle(el).fontSize) >= MIN_PX;
}

export const CountUpScope: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = root.current;
    if (!host || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const runs = new WeakMap<Text, Run>();
    const live = new Set<Run>();
    const stop = (r: Run) => {
      cancelAnimationFrame(r.raf);
      clearTimeout(r.timer);
      live.delete(r);
    };

    const play = (node: Text) => {
      const text = node.nodeValue || "";
      const prev = runs.get(node);
      if (prev && (text === prev.shown || text === prev.target)) return; // our own write, or unchanged
      const p = parse(text);
      if (!p || !eligible(node)) return;
      const from = prev ? prev.value : 0;
      if (prev) stop(prev);
      if (from === p.value) { runs.set(node, { target: text, shown: text, value: from, raf: 0, timer: 0 }); return; }
      const fmt = (n: number) =>
        p.before +
        (p.grouping
          ? n.toLocaleString(p.grouping, { minimumFractionDigits: p.decimals, maximumFractionDigits: p.decimals })
          : n.toFixed(p.decimals)) +
        p.after;
      const run: Run = { target: text, shown: text, value: from, raf: 0, timer: 0 };
      runs.set(node, run);
      live.add(run);
      const finish = () => {
        stop(run);
        run.value = p.value;
        run.shown = run.target;
        node.nodeValue = run.target;
      };
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / DURATION);
        if (t >= 1) return finish();
        run.value = from + (p.value - from) * ease(t);
        run.shown = fmt(run.value);
        node.nodeValue = run.shown;
        run.raf = requestAnimationFrame(step);
      };
      run.shown = fmt(from);
      node.nodeValue = run.shown;
      run.raf = requestAnimationFrame(step);
      // Frames don't run in a background tab: the exact figure lands on time regardless.
      run.timer = window.setTimeout(finish, DURATION + 150);
    };

    const scan = (n: Node) => {
      if (n.nodeType === Node.TEXT_NODE) return play(n as Text);
      const walk = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
      for (let t = walk.nextNode(); t; t = walk.nextNode()) play(t as Text);
    };

    scan(host);
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === "characterData") play(r.target as Text);
        else r.addedNodes.forEach(scan);
      }
    });
    mo.observe(host, { subtree: true, childList: true, characterData: true });
    return () => {
      mo.disconnect();
      live.forEach(stop);
    };
  }, []);

  return <div ref={root} style={{ display: "contents" }}>{children}</div>;
};

/** A dashboard whose figures count up. */
export function withCountUp<P extends object>(Page: React.ComponentType<P>) {
  const Wrapped = (props: P) => (
    <CountUpScope>
      <Page {...props} />
    </CountUpScope>
  );
  Wrapped.displayName = `withCountUp(${Page.displayName || Page.name || "Page"})`;
  return Wrapped;
}
