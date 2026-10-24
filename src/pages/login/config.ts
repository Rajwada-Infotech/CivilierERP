// What the sign-in page shows about the company (GET /api/public-stats), and the look it is drawn in: calm and
// minimal — an off-white page, one white card, near-black ink and a green taken from the logo for focus. The page
// keeps its own palette whatever theme is chosen elsewhere in the app, since nobody has signed in yet.
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
  --page: #f6f6f4;
  --card: #ffffff;
  --ink: #111214;
  --ink-2: #44464b;
  --muted: #8a8c91;
  --line: #e4e4e1;
  --line-2: #d3d3cf;
  --green: #1e8a4a;
  --green-ring: rgba(30, 138, 74, 0.16);
  color: var(--ink);
  font-family: "DM Sans", "Noto Sans", sans-serif;
}
.login-sheet .ls-card {
  background: var(--card); border-radius: 20px;
  box-shadow: 0 1px 2px rgba(17, 18, 20, 0.04), 0 12px 40px -12px rgba(17, 18, 20, 0.12);
  border: 1px solid rgba(17, 18, 20, 0.05);
}
.login-sheet .ls-label { display: block; font-size: 13px; font-weight: 500; color: var(--ink-2); margin-bottom: 6px; }
.login-sheet .ls-input {
  width: 100%; height: 46px; padding: 0 14px; background: #fff; color: var(--ink);
  border: 1px solid var(--line-2); border-radius: 10px; outline: none; font-size: 15px;
  transition: border-color .15s, box-shadow .15s;
}
.login-sheet .ls-input::placeholder { color: #a9aaae; }
.login-sheet .ls-input:hover { border-color: #b9b9b4; }
.login-sheet .ls-input:focus { border-color: var(--green); box-shadow: 0 0 0 4px var(--green-ring); }
.login-sheet .ls-btn {
  width: 100%; height: 46px; display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  background: var(--ink); color: #fff; border: 0; border-radius: 10px;
  font-family: "Sora", sans-serif; font-weight: 600; font-size: 14px;
  transition: background-color .15s, transform .1s;
}
.login-sheet .ls-btn:hover:not(:disabled) { background: #2a2c30; }
.login-sheet .ls-btn:active:not(:disabled) { transform: translateY(1px); }
.login-sheet .ls-btn:disabled { opacity: 0.65; cursor: not-allowed; }
.login-sheet .ls-link { color: var(--ink-2); transition: color .15s; }
.login-sheet .ls-link:hover { color: var(--ink); }
.login-sheet .ls-eye { color: var(--muted); transition: color .15s; }
.login-sheet .ls-eye:hover { color: var(--ink); }
.login-sheet :is(.ls-btn, .ls-link, .ls-eye):focus-visible { outline: 2px solid var(--green); outline-offset: 3px; border-radius: 8px; }
@keyframes ls-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
.login-sheet .ls-in { animation: ls-rise .6s cubic-bezier(.16, 1, .3, 1) both; }
@media (prefers-reduced-motion: reduce) { .login-sheet .ls-in { animation: none; } }
`;
