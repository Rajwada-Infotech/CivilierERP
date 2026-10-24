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
  --page: #e8e3d9;
  --frame: #f8f4ec; /* bone / cream white */
  --frame-hi: #fcfaf5;
  --ink: #101312;
  --ink-2: #4a4f4c;
  --muted: #8f8c84;
  --field: #efe9de;
  --line: #e2dacb;
  --brand: #1c4d35;
  --brand-hover: #153c29;
  --brand-ring: rgba(28, 77, 53, 0.18);
  --green: #2f7a4f; /* the tick on "Welcome back" */
  --notch: 34px;
  color: var(--ink);
  font-family: "DM Sans", "Noto Sans", sans-serif;
}

/* Wide: the white panel holding the form and the photo. Narrower: the panel is clear and the form sits in a frosted
   card over the full-screen backdrop (LoginBackdrop). */
.login-sheet .ls-form-side {
  width: 100%; max-width: 460px; margin-inline: auto; padding: 4px 4px 8px;
  background: rgba(248, 244, 236, 0.7); border: 1px solid rgba(252, 250, 245, 0.85); border-radius: 26px;
  backdrop-filter: blur(9px) saturate(1.25); -webkit-backdrop-filter: blur(9px) saturate(1.25);
  box-shadow: 0 1px 2px rgba(16,19,18,0.05), 0 30px 60px -28px rgba(16,19,18,0.35);
}
@media (min-width: 640px) { .login-sheet .ls-form-side { padding: 40px 36px; } }
@media (min-width: 1024px) {
  .login-sheet .ls-panel {
    background: var(--frame); min-height: min(860px, calc(100vh - 6vh));
    box-shadow: 0 1px 2px rgba(16,19,18,0.04), 0 24px 60px -24px rgba(16,19,18,0.18);
  }
  .login-sheet .ls-form-side {
    max-width: none; margin: 0; padding: min(2.5rem, 3vh) 2rem; background: none; border: 0; border-radius: 0;
    backdrop-filter: none; -webkit-backdrop-filter: none; box-shadow: none;
  }
}
/* The fields read as filled on the frosted card too */
@media (max-width: 1023px) { .login-sheet .ls-field { background: rgba(239, 233, 222, 0.9); } }

/* Decoration stays grey under the black-and-white theme like everything but the logo */
[data-theme="bw"] .login-sheet .ls-bits { filter: grayscale(1); }

/* The "Welcome back" card shown after signing in */
.login-sheet .ls-card { background: var(--frame-hi); border: 1px solid var(--line); border-radius: 18px; box-shadow: 0 24px 50px -24px rgba(40,32,18,0.3); }

/* Filled field with its label inside. Clicking into one gives it a little squish and makes its label hop. */
@keyframes ls-squish { 0% { transform: scale(1); } 35% { transform: scale(1.025, 0.96); } 65% { transform: scale(0.99, 1.02); } 100% { transform: scale(1); } }
@keyframes ls-hop { 0% { transform: translateY(0); } 40% { transform: translateY(-4px); } 70% { transform: translateY(1px); } 100% { transform: translateY(0); } }
.login-sheet .ls-field:focus-within { animation: ls-squish .45s cubic-bezier(.3, 1.5, .5, 1); }
.login-sheet .ls-field:focus-within > span { display: inline-block; animation: ls-hop .45s cubic-bezier(.3, 1.5, .5, 1); color: var(--brand); }
@media (prefers-reduced-motion: reduce) { .login-sheet .ls-field:focus-within, .login-sheet .ls-field:focus-within > span { animation: none; } }
.login-sheet .ls-field {
  position: relative; display: block; background: var(--field); border: 1px solid transparent; border-radius: 10px;
  padding: 9px 14px 8px; transition: border-color .15s, box-shadow .15s, background-color .15s;
}
.login-sheet .ls-field:hover { background: #ebe4d8; }
.login-sheet .ls-field:focus-within { background: var(--frame-hi); border-color: var(--brand); box-shadow: 0 0 0 4px var(--brand-ring); }
.login-sheet .ls-field > span { display: block; font-size: 11.5px; color: var(--muted); line-height: 1.2; }
.login-sheet .ls-field input { width: 100%; background: transparent; border: 0; outline: none; font-size: 15px; color: var(--ink); padding: 2px 0 0; }
.login-sheet .ls-field input::placeholder { color: #b8b2a6; }

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
  background: var(--frame-hi); color: var(--ink); border: 1px solid var(--line); border-radius: 10px; font-size: 14px; font-weight: 500;
  transition: border-color .15s, background-color .15s;
}
.login-sheet .ls-outline:hover { border-color: #c9bfae; background: #f3eee4; }
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

/* Motion (the springy entrances are framer-motion, see ./motion): clouds drift across the sky, the sun breathes, and a
   light sweeps across the Sign in button now and then. All of it stops for anyone who asks for reduced motion. */
.login-sheet .ls-cloud {
  position: absolute; left: -30%; z-index: 1; border-radius: 999px; pointer-events: none;
  background: radial-gradient(closest-side, rgba(255,255,255,0.95), rgba(255,255,255,0.55) 60%, rgba(255,255,255,0));
  filter: blur(6px); animation: ls-drift linear infinite;
}
/* Across the panel, left edge to right edge, bobbing a little on the way */
@keyframes ls-drift {
  0%   { left: -30%; transform: translateY(0); }
  50%  { transform: translateY(-8px); }
  100% { left: 105%; transform: translateY(0); }
}
.login-sheet .ls-sun { animation: ls-breathe 7s ease-in-out infinite; }
@keyframes ls-breathe { 0%, 100% { opacity: 0.85; transform: scale(1); } 50% { opacity: 1; transform: scale(1.05); } }

.login-sheet .ls-shine { position: relative; overflow: hidden; }
.login-sheet .ls-shine::after {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(105deg, transparent 35%, rgba(255,255,255,0.28) 50%, transparent 65%);
  transform: translateX(-120%); animation: ls-sweep 4.5s ease-in-out 1.6s infinite;
}
.login-sheet .ls-shine:disabled::after { animation: none; }
@keyframes ls-sweep { 0% { transform: translateX(-120%); } 30%, 100% { transform: translateX(120%); } }

@media (prefers-reduced-motion: reduce) {
  .login-sheet .ls-cloud, .login-sheet .ls-sun, .login-sheet .ls-shine::after { animation: none; }
}
`;
