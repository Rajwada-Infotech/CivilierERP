// What the sign-in page shows about the company (GET /api/public-stats), and the look it is drawn in: a site
// hoarding — charcoal board, hazard stripe, one hi-vis orange — beside a light concrete sign-in side. The page keeps
// its own palette whatever theme is chosen elsewhere in the app, since nobody has signed in yet.
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
  --concrete: #ebe8e1;
  --paper: #f6f4ef;
  --board: #15171b;
  --board-2: #1d2026;
  --ink: #17191e;
  --ink-2: #3a3c42;
  --graphite: #6f6c66;
  --rule: #d5d0c5;
  --hivis: #ff5a14;
  --hivis-deep: #e24800;
  --hivis-wash: #fff0e8;
  --chalk: #f3f1ec;
  --chalk-2: rgba(243, 241, 236, 0.64);
  --chalk-rule: rgba(243, 241, 236, 0.13);
  color: var(--ink);
  font-family: "DM Sans", "Noto Sans", sans-serif;
}
.login-sheet .eyebrow {
  font-family: "Sora", sans-serif; font-weight: 600; font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase;
}
.login-sheet .display { font-family: "Sora", sans-serif; font-weight: 700; letter-spacing: -0.045em; line-height: 0.95; text-wrap: balance; }
.login-sheet .num { font-family: "Sora", sans-serif; font-weight: 600; letter-spacing: -0.03em; line-height: 1; font-variant-numeric: tabular-nums; }

/* The hazard stripe: the hoarding's one loud mark */
.login-sheet .hazard {
  background: repeating-linear-gradient(-45deg, var(--hivis) 0 14px, var(--board) 14px 28px);
}

.login-sheet .ls-label { display: block; font-size: 13px; font-weight: 600; color: var(--ink-2); margin-bottom: 8px; }
.login-sheet .ls-input {
  width: 100%; height: 52px; padding: 0 16px; background: #fff; color: var(--ink);
  border: 1px solid var(--rule); border-radius: 12px; outline: none; font-size: 15px;
  transition: border-color .15s, box-shadow .15s;
}
.login-sheet .ls-input::placeholder { color: #a8a39a; }
.login-sheet .ls-input:hover { border-color: #b9b3a6; }
.login-sheet .ls-input:focus { border-color: var(--hivis); box-shadow: 0 0 0 4px rgba(255, 90, 20, 0.16); }

.login-sheet .ls-btn {
  position: relative; width: 100%; height: 54px; display: flex; align-items: center; justify-content: space-between;
  padding: 0 8px 0 22px; background: var(--board); color: var(--chalk); border: 0; border-radius: 12px;
  font-family: "Sora", sans-serif; font-weight: 600; font-size: 15px; letter-spacing: -0.01em;
  transition: background-color .2s;
}
.login-sheet .ls-btn .chip {
  width: 40px; height: 40px; border-radius: 9px; display: inline-flex; align-items: center; justify-content: center;
  background: var(--hivis); color: #fff; transition: transform .2s cubic-bezier(.16, 1, .3, 1);
}
.login-sheet .ls-btn:hover:not(:disabled) { background: #0b0c0f; }
.login-sheet .ls-btn:hover:not(:disabled) .chip { transform: translateX(3px); }
.login-sheet .ls-btn:disabled { opacity: 0.7; cursor: not-allowed; }

.login-sheet .ls-row { transition: background-color .15s; border-radius: 12px; }
.login-sheet .ls-row:hover { background: #fff; }
.login-sheet .ls-row:hover .ls-go { color: var(--hivis); transform: translate(2px, -2px); }
.login-sheet .ls-go { transition: transform .2s, color .2s; color: var(--graphite); }
.login-sheet .ls-link { color: var(--ink-2); text-decoration: underline; text-decoration-color: var(--rule); text-underline-offset: 4px; transition: color .15s, text-decoration-color .15s; }
.login-sheet .ls-link:hover { color: var(--ink); text-decoration-color: var(--hivis); }
.login-sheet .ls-eye { color: var(--graphite); transition: color .15s; }
.login-sheet .ls-eye:hover { color: var(--ink); }

.login-sheet :is(.ls-btn, .ls-row, .ls-link, .ls-eye):focus-visible { outline: 2px solid var(--hivis); outline-offset: 3px; }

@keyframes ls-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
.login-sheet .ls-in { animation: ls-rise .7s cubic-bezier(.16, 1, .3, 1) both; }
@media (prefers-reduced-motion: reduce) { .login-sheet .ls-in { animation: none; } }
`;
