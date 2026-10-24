// What the sign-in page shows about the company (GET /api/public-stats), and the look it is drawn in: a white
// rounded panel on a soft grey page, the form on the left, a site photo with notched corners on the right, and a
// deep green from the logo for the button. The page keeps its own palette whatever theme is chosen elsewhere.
export interface PublicStats {
  projects: number;
  workOrders: number;
  workOrderCompletionPct: number;
  grns: number;
  activeSuppliers: number;
  quotations: number;
}

/** The building on the right: a cut-out (transparent background) with the old orange shape behind it removed. */
export const LOGIN_PHOTO = "/login-photo.webp";

export const LOGIN_CSS = `
.login-sheet {
  --page: #e9ecea;
  --frame: #ffffff;
  --ink: #101312;
  --ink-2: #4a4f4c;
  --muted: #8b918d;
  --field: #f2f4f3;
  --line: #dfe3e0;
  --brand: #1c4d35;
  --brand-hover: #153c29;
  --brand-ring: rgba(28, 77, 53, 0.18);
  --notch: 34px;
  color: var(--ink);
  font-family: "DM Sans", "Noto Sans", sans-serif;
}

/* Filled field with its label inside */
.login-sheet .ls-field {
  position: relative; display: block; background: var(--field); border: 1px solid transparent; border-radius: 10px;
  padding: 9px 14px 8px; transition: border-color .15s, box-shadow .15s, background-color .15s;
}
.login-sheet .ls-field:hover { background: #eceeed; }
.login-sheet .ls-field:focus-within { background: #fff; border-color: var(--brand); box-shadow: 0 0 0 4px var(--brand-ring); }
.login-sheet .ls-field > span { display: block; font-size: 11.5px; color: var(--muted); line-height: 1.2; }
.login-sheet .ls-field input { width: 100%; background: transparent; border: 0; outline: none; font-size: 15px; color: var(--ink); padding: 2px 0 0; }
.login-sheet .ls-field input::placeholder { color: #b3b8b5; }

.login-sheet .ls-btn {
  width: 100%; height: 48px; display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  background: var(--brand); color: #fff; border: 0; border-radius: 10px;
  font-family: "Sora", sans-serif; font-weight: 600; font-size: 14.5px; transition: background-color .15s, transform .1s;
}
.login-sheet .ls-btn:hover:not(:disabled) { background: var(--brand-hover); }
.login-sheet .ls-btn:active:not(:disabled) { transform: translateY(1px); }
.login-sheet .ls-btn:disabled { opacity: 0.7; cursor: not-allowed; }

.login-sheet .ls-outline {
  width: 100%; height: 46px; display: inline-flex; align-items: center; justify-content: center; gap: 10px;
  background: #fff; color: var(--ink); border: 1px solid var(--line); border-radius: 10px; font-size: 14px; font-weight: 500;
  transition: border-color .15s, background-color .15s;
}
.login-sheet .ls-outline:hover { border-color: #b9c0bc; background: #fafbfa; }
.login-sheet .ls-link { color: var(--brand); font-weight: 600; text-underline-offset: 3px; }
.login-sheet .ls-link:hover { text-decoration: underline; }
.login-sheet .ls-eye { color: var(--muted); transition: color .15s; }
.login-sheet .ls-eye:hover { color: var(--ink); }
.login-sheet :is(.ls-btn, .ls-outline, .ls-link, .ls-eye):focus-visible { outline: 2px solid var(--brand); outline-offset: 3px; }

/* The photo's notched corners: page-coloured blocks bite out the top-left and bottom-right corners, and four small
   inverted corners round off where the bite meets the photo. */
/* Square where the bites sit (they draw those corners), round at the other two. */
.login-sheet .ls-photo { position: relative; border-radius: 0 var(--notch) 0 var(--notch); overflow: hidden; }
.login-sheet .ls-bite { position: absolute; background: var(--frame); z-index: 2; }
.login-sheet .ls-bite.tl { top: -2px; left: -2px; width: calc(34% + 2px); height: calc(13% + 2px); border-bottom-right-radius: var(--notch); }
.login-sheet .ls-bite.br { bottom: -2px; right: -2px; width: calc(26% + 2px); height: calc(12% + 2px); border-top-left-radius: var(--notch); }
.login-sheet .ls-corner { position: absolute; z-index: 2; }
.login-sheet .ls-corner.tl-a { top: 13%; left: -2px; width: calc(var(--notch) + 2px); height: var(--notch); background: radial-gradient(circle at 100% 100%, transparent calc(var(--notch) - 0.5px), var(--frame) var(--notch)); }
.login-sheet .ls-corner.tl-b { top: -2px; left: 34%; width: var(--notch); height: calc(var(--notch) + 2px); background: radial-gradient(circle at 100% 100%, transparent calc(var(--notch) - 0.5px), var(--frame) var(--notch)); }
.login-sheet .ls-corner.br-a { bottom: 12%; right: -2px; width: calc(var(--notch) + 2px); height: var(--notch); background: radial-gradient(circle at 0% 0%, transparent calc(var(--notch) - 0.5px), var(--frame) var(--notch)); }
.login-sheet .ls-corner.br-b { bottom: -2px; right: 26%; width: var(--notch); height: calc(var(--notch) + 2px); background: radial-gradient(circle at 0% 0%, transparent calc(var(--notch) - 0.5px), var(--frame) var(--notch)); }

@keyframes ls-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
.login-sheet .ls-in { animation: ls-rise .6s cubic-bezier(.16, 1, .3, 1) both; }
@media (prefers-reduced-motion: reduce) { .login-sheet .ls-in { animation: none; } }
`;
