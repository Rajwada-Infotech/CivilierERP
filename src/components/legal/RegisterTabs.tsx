import { useLocation, useNavigate } from "react-router-dom";

/** The registers as one set of tabs (shown on top of each register page). Read-only lists with export. */
export const REGISTERS = [
  { label: "Land & Projects", path: "/legal/land/projects", hint: "Registered land by project; amendments to registered land" },
  { label: "Land Sales", path: "/legal/land/sales", hint: "Sale / disposal of company land" },
  { label: "RS records", path: "/legal/land/rs-register", hint: "Every RS Khatian & Dag of every land" },
  { label: "LR records (RoR)", path: "/legal/land/lr-register", hint: "Every LR Khatian & Dag of every land" },
];

export function RegisterTabs() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const at = REGISTERS.find((r) => pathname.startsWith(r.path));
  return (
    <nav aria-label="Registers" className="mb-4 border border-border bg-card">
      <div className="flex overflow-x-auto">
        {REGISTERS.map((r) => (
          <button key={r.path} onClick={() => navigate(r.path)} title={r.hint} aria-current={r === at ? "page" : undefined}
            className={`shrink-0 px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.06em] ${r === at ? "bg-foreground text-background" : "text-muted-foreground hover:bg-primary/5 hover:text-foreground"}`}>
            {r.label}
          </button>
        ))}
      </div>
      {at && <p className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">{at.hint}</p>}
    </nav>
  );
}
