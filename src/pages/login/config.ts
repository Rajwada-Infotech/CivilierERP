// What the sign-in page shows about the company (GET /api/public-stats), and the sheet look it is drawn in:
// violet ink on a dark blueprint ground, square ruled panels, small-caps labels. The page keeps its own palette
// whatever theme is chosen elsewhere in the app, since nobody has signed in yet.
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
  --ground: #0d0a1a;
  --paper: #14102a;
  --ink: #f1edff;
  --ink-2: rgba(241, 237, 255, 0.78);
  --graphite: #a99fd2;
  --rule: rgba(167, 139, 250, 0.6);
  --rule-soft: rgba(167, 139, 250, 0.2);
  --violet: #8b5cf6;
  --violet-deep: #6d28d9;
  --violet-soft: #c4b5fd;
  color: var(--ink);
}
.login-sheet .label {
  font-family: "Sora", sans-serif; font-weight: 600; font-size: 10px; letter-spacing: 0.12em;
  text-transform: uppercase; color: var(--graphite);
}
.login-sheet .figure {
  font-family: "Sora", sans-serif; font-weight: 600; letter-spacing: -0.02em; line-height: 1;
  font-variant-numeric: tabular-nums; color: var(--ink);
}
.login-sheet .ls-input {
  width: 100%; height: 48px; padding: 0 14px; background: rgba(255, 255, 255, 0.03); color: var(--ink);
  border: 1px solid var(--rule-soft); border-radius: 0; outline: none; font-size: 14px;
  transition: border-color .15s, background-color .15s;
}
.login-sheet .ls-input::placeholder { color: rgba(169, 159, 210, 0.5); }
.login-sheet .ls-input:hover { border-color: var(--rule); }
.login-sheet .ls-input:focus { border-color: var(--violet); background: rgba(139, 92, 246, 0.08); box-shadow: 0 0 0 1px var(--violet); }
.login-sheet .ls-btn {
  width: 100%; height: 48px; display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  background: var(--violet-deep); color: #fff; border: 1px solid var(--violet); border-radius: 0;
  font-family: "Sora", sans-serif; font-weight: 600; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase;
  transition: background-color .15s, border-color .15s;
}
.login-sheet .ls-btn:hover:not(:disabled) { background: #7c3aed; border-color: var(--violet-soft); }
.login-sheet .ls-btn:focus-visible, .login-sheet .ls-tile:focus-visible, .login-sheet .ls-link:focus-visible { outline: 2px solid var(--violet-soft); outline-offset: 2px; }
.login-sheet .ls-btn:disabled { opacity: 0.65; cursor: not-allowed; }
.login-sheet .ls-tile { border: 1px solid var(--rule-soft); background: transparent; transition: border-color .15s, background-color .15s; }
.login-sheet .ls-tile:hover { border-color: var(--violet); background: rgba(139, 92, 246, 0.08); }
.login-sheet .ls-link { color: var(--graphite); transition: color .15s; }
.login-sheet .ls-link:hover { color: var(--violet-soft); }
@keyframes ls-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.login-sheet .ls-in { animation: ls-in .5s cubic-bezier(.16, 1, .3, 1) both; }
@media (prefers-reduced-motion: reduce) { .login-sheet .ls-in { animation: none; } }
`;
