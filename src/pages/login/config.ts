// What the sign-in page shows about the company (GET /api/public-stats), and the look it is drawn in: a drafting-film
// panel on a cool grey page, the form on the left, a blueprint of a building going up on the right (./SiteDrawing),
// the logo's green for the button and the crane's safety yellow as the one accent. The page keeps its own palette
// whatever theme is chosen elsewhere.
export interface PublicStats {
  projects: number;
  workOrders: number;
  workOrderCompletionPct: number;
  grns: number;
  activeSuppliers: number;
  quotations: number;
}

export const LOGIN_CSS = `
.login-sheet {
  --page: #dde3e8;
  --frame: #f3f5f6; /* drafting film */
  --frame-hi: #fafbfb;
  --ink: #0f1a24;
  --ink-2: #44515c;
  --muted: #84909a;
  --field: #e8ecef;
  --line: #d3dbe1;
  --brand: #1c4d35;
  --brand-hover: #153c29;
  --brand-ring: rgba(28, 77, 53, 0.18);
  --blue: #0f3354;    /* blueprint */
  --blue-2: #0a2540;
  --safety: #f4b400;
  --green: #2f7a4f; /* the tick on "Welcome back" */
  color: var(--ink);
  font-family: "DM Sans", "Noto Sans", sans-serif;
  background-color: var(--page);
  background-image:
    linear-gradient(rgba(15, 51, 84, 0.11) 1px, transparent 1px),
    linear-gradient(90deg, rgba(15, 51, 84, 0.11) 1px, transparent 1px),
    linear-gradient(rgba(15, 51, 84, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(15, 51, 84, 0.05) 1px, transparent 1px);
  background-size: 140px 140px, 140px 140px, 28px 28px, 28px 28px;
}

/* Wide: the panel holding the form and the drawing. Narrower: the panel is clear and the form sits in a frosted card
   over the full-screen blueprint (SiteBackdrop). */
.login-sheet .ls-form-side {
  width: 100%; max-width: 460px; margin-inline: auto; padding: 4px 4px 8px;
  background: rgba(243, 245, 246, 0.86); border: 1px solid rgba(250, 251, 251, 0.6); border-radius: 22px;
  backdrop-filter: blur(10px) saturate(1.2); -webkit-backdrop-filter: blur(10px) saturate(1.2);
  box-shadow: 0 1px 2px rgba(10,37,64,0.08), 0 30px 60px -24px rgba(5,20,36,0.6);
}
@media (min-width: 640px) { .login-sheet .ls-form-side { padding: 40px 36px; } }
@media (min-width: 1024px) {
  .login-sheet .ls-panel {
    background: var(--frame); min-height: min(860px, calc(100vh - 6vh));
    box-shadow: 0 1px 2px rgba(10,37,64,0.06), 0 24px 60px -24px rgba(10,37,64,0.28);
  }
  .login-sheet .ls-form-side {
    max-width: none; margin: 0; padding: min(2.5rem, 3vh) 2rem; background: none; border: 0; border-radius: 0;
    backdrop-filter: none; -webkit-backdrop-filter: none; box-shadow: none;
  }
}
@media (max-width: 1023px) { .login-sheet .ls-field { background: rgba(232, 236, 239, 0.95); } }

/* The site plan behind the form fades toward the middle, where the form sits */
.login-sheet .ls-siteplan {
  -webkit-mask-image: radial-gradient(ellipse 44% 46% at 50% 50%, transparent 0%, rgba(0,0,0,0.25) 55%, #000 100%);
  mask-image: radial-gradient(ellipse 44% 46% at 50% 50%, transparent 0%, rgba(0,0,0,0.25) 55%, #000 100%);
}

/* Decoration stays grey under the black-and-white theme like everything but the logo */
[data-theme="bw"] .login-sheet :is(.ls-bits, .ls-blueprint, .ls-siteplan) { filter: grayscale(1); }

/* The "Welcome back" card shown after signing in */
.login-sheet .ls-card { background: var(--frame-hi); border: 1px solid var(--line); border-radius: 16px; box-shadow: 0 24px 50px -24px rgba(10,37,64,0.35); }

/* Filled field with its label inside. Clicking into one gives it a little squish and makes its label hop. */
@keyframes ls-squish { 0% { transform: scale(1); } 35% { transform: scale(1.025, 0.96); } 65% { transform: scale(0.99, 1.02); } 100% { transform: scale(1); } }
@keyframes ls-hop { 0% { transform: translateY(0); } 40% { transform: translateY(-4px); } 70% { transform: translateY(1px); } 100% { transform: translateY(0); } }
.login-sheet .ls-field:focus-within { animation: ls-squish .45s cubic-bezier(.3, 1.5, .5, 1); }
.login-sheet .ls-field:focus-within > span { display: inline-block; animation: ls-hop .45s cubic-bezier(.3, 1.5, .5, 1); color: var(--brand); }
@media (prefers-reduced-motion: reduce) { .login-sheet .ls-field:focus-within, .login-sheet .ls-field:focus-within > span { animation: none; } }
.login-sheet .ls-field {
  position: relative; display: block; background: var(--field); border: 1px solid transparent; border-radius: 8px;
  padding: 9px 14px 8px; transition: border-color .15s, box-shadow .15s, background-color .15s;
}
.login-sheet .ls-field:hover { background: #e2e7eb; }
.login-sheet .ls-field:focus-within { background: var(--frame-hi); border-color: var(--brand); box-shadow: 0 0 0 4px var(--brand-ring); }
.login-sheet .ls-field > span { display: block; font-size: 11.5px; color: var(--muted); line-height: 1.2; }
.login-sheet .ls-field input { width: 100%; background: transparent; border: 0; outline: none; font-size: 15px; color: var(--ink); padding: 2px 0 0; }
.login-sheet .ls-field input::placeholder { color: #a9b3bb; }

.login-sheet .ls-btn {
  width: 100%; height: 48px; display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  background: var(--brand); color: #fff; border: 0; border-radius: 8px;
  font-family: "Sora", sans-serif; font-weight: 600; font-size: 14.5px; transition: background-color .15s, transform .1s;
}
.login-sheet .ls-btn:hover:not(:disabled) { background: var(--brand-hover); }
.login-sheet .ls-btn:active:not(:disabled) { transform: translateY(1px); }
.login-sheet .ls-btn:disabled { opacity: 0.7; cursor: not-allowed; }

.login-sheet .ls-outline {
  width: 100%; height: 46px; display: inline-flex; align-items: center; justify-content: center; gap: 10px;
  background: var(--frame-hi); color: var(--ink); border: 1px solid var(--line); border-radius: 8px; font-size: 14px; font-weight: 500;
  transition: border-color .15s, background-color .15s;
}
.login-sheet .ls-outline:hover { border-color: #b7c3cc; background: #edf1f3; }
.login-sheet .ls-link { color: var(--brand); font-weight: 600; text-underline-offset: 3px; }
.login-sheet .ls-link:hover { text-decoration: underline; }
.login-sheet .ls-eye { color: var(--muted); transition: color .15s; }
.login-sheet .ls-eye:hover { color: var(--ink); }
.login-sheet :is(.ls-btn, .ls-outline, .ls-link, .ls-eye):focus-visible { outline: 2px solid var(--brand); outline-offset: 3px; }

/* The blueprint: deep blue with a soft light from the top, the drawing border inset with zone marks, and a title
   block in the corner. */
.login-sheet .ls-blueprint {
  background:
    radial-gradient(90% 60% at 30% 0%, rgba(80, 140, 200, 0.28), transparent 70%),
    linear-gradient(180deg, var(--blue) 0%, var(--blue-2) 100%);
}
@media (min-width: 1024px) { .login-sheet .ls-panel .ls-blueprint { border-radius: 18px; } }
.login-sheet .ls-border { position: absolute; inset: 14px; border: 1px solid rgba(190, 220, 255, 0.35); border-radius: 6px; pointer-events: none; z-index: 2; }
.login-sheet .ls-border::after { content: ""; position: absolute; inset: 5px; border: 1px solid rgba(190, 220, 255, 0.14); border-radius: 3px; }
.login-sheet .ls-zone { position: absolute; font: 600 9px "Sora", sans-serif; color: rgba(190, 220, 255, 0.5); transform: translate(-50%, -50%); }
.login-sheet .ls-eyebrow {
  display: inline-flex; align-items: center; gap: 8px; font: 600 10.5px "Sora", sans-serif; letter-spacing: 0.16em;
  text-transform: uppercase; color: var(--safety);
}
.login-sheet .ls-eyebrow::before { content: ""; width: 18px; height: 2px; background: var(--safety); }
.login-sheet .ls-note {
  top: 34px; left: 34px; max-width: min(360px, 58%); padding: 12px 16px 14px;
  background: rgba(8, 30, 52, 0.94); border: 1px solid rgba(190, 220, 255, 0.45); border-left: 3px solid var(--safety);
  box-shadow: 0 12px 30px -14px rgba(0, 0, 0, 0.6);
}
.login-sheet .ls-titleblock {
  right: 30px; bottom: 30px; width: min(380px, 60%);
  background: rgba(8, 30, 52, 0.94); border: 1px solid rgba(190, 220, 255, 0.45);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); color: #e6f1ff;
}
.login-sheet .ls-tb-head, .login-sheet .ls-tb-foot {
  display: flex; justify-content: space-between; gap: 12px; padding: 7px 12px;
  font: 600 9.5px "Sora", sans-serif; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(214, 232, 255, 0.75);
}
.login-sheet .ls-tb-head { border-bottom: 1px solid rgba(190, 220, 255, 0.45); }
.login-sheet .ls-tb-head > span:first-child { color: #fff; }
.login-sheet .ls-tb-foot { border-top: 1px solid rgba(190, 220, 255, 0.45); }
.login-sheet .ls-tb-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.login-sheet .ls-tb-grid > div { padding: 10px 10px 11px; min-width: 0; }
.login-sheet .ls-tb-grid > div + div { border-left: 1px solid rgba(190, 220, 255, 0.22); }
.login-sheet .ls-tb-fig { font: 600 clamp(16px, 1.3vw, 21px)/1 "Sora", sans-serif; font-variant-numeric: tabular-nums; color: #fff; }
.login-sheet .ls-tb-lbl { margin-top: 5px; font-size: 10px; color: rgba(225, 238, 255, 0.85); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.login-sheet .ls-shine { position: relative; overflow: hidden; }
.login-sheet .ls-shine::after {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(105deg, transparent 35%, rgba(255,255,255,0.28) 50%, transparent 65%);
  transform: translateX(-120%); animation: ls-sweep 4.5s ease-in-out 1.6s infinite;
}
.login-sheet .ls-shine:disabled::after { animation: none; }
@keyframes ls-sweep { 0% { transform: translateX(-120%); } 30%, 100% { transform: translateX(120%); } }
@media (prefers-reduced-motion: reduce) { .login-sheet .ls-shine::after { animation: none; } }
`;
