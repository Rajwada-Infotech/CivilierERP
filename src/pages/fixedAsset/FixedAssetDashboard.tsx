import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { usePageRights } from "@/hooks/usePageRights";
import { Cpu, Tag, Setting2, ArrowSwapHorizontal } from "iconsax-react";
import { Boxes, AlertCircle, PlayCircle, Wallet, ChevronRight, Upload, UserCheck, ShieldCheck, Wrench, Calculator, Printer, PieChart } from "lucide-react";
import { GlassShell, GlassCard, GlassSection } from "@/components/dashboard/GlassShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { getFixedAssets, type FixedAssetListItem } from "@/api/fixedAssetApi";

const ACCENT = "#eab308";

function fmtCur(n: number | null | undefined) {
  if (n == null) return "—";
  return "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
}

// Same straight-line book-value math FixedAssetRecord.tsx uses for its
// portfolio stats — duplicated here rather than imported since it's a small,
// self-contained calculation and importing across page modules would pull in
// that page's full bundle just for one function.
function calcBookValue(purchaseCost: number, rate: number, purchaseDate: string) {
  if (!purchaseCost || !rate || !purchaseDate) return purchaseCost || 0;
  const msPerYear = 365.25 * 24 * 60 * 60 * 1000;
  const years = Math.max(0, (Date.now() - new Date(purchaseDate).getTime()) / msPerYear);
  const annualDep = purchaseCost * (rate / 100);
  const totalDep = Math.min(purchaseCost, annualDep * years);
  return Math.max(0, purchaseCost - totalDep);
}

function ensureArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function QuickLinkCard({
  icon: Icon,
  title,
  desc,
  onClick,
}: {
  icon: React.ElementType;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group relative flex items-center gap-3 rounded-xl p-4 text-left transition-all hover:-translate-y-0.5"
      style={{
        background: `${ACCENT}0f`,
        border: `1px solid ${ACCENT}28`,
      }}
    >
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: `${ACCENT}20`, border: `1px solid ${ACCENT}40` }}
      >
        <Icon size={16} style={{ color: ACCENT }} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground truncate">{desc}</p>
      </div>
      <ChevronRight size={16} className="text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

const STATUS_COLOR: Record<string, string> = {
  Active: "#10b981",
  Pending: "#f59e0b",
  Assigned: "#3b82f6",
  "In Repair": "#f97316",
  Maintenance: "#f97316",
  Disposed: "#ef4444",
  Inactive: "#64748b",
};

// Every page of the module (same routes as the Fixed Asset sidebar).
const QUICK_LINKS: { icon: React.ElementType; title: string; desc: string; path: string }[] = [
  { icon: Cpu, title: "Fixed Asset Depreciation Tag", desc: "Browse & manage the full asset register", path: "/fixed-asset/record" },
  { icon: Tag, title: "FA Inventory", desc: "Tag received stock, track untagged qty", path: "/fixed-asset/tagging" },
  { icon: Printer, title: "FA Code Stickers", desc: "Print asset code labels", path: "/fixed-asset/depreciation-tag-stickers" },
  { icon: Upload, title: "Inventory Import", desc: "Bulk-load assets from a spreadsheet", path: "/fixed-asset/inventory-import" },
  { icon: UserCheck, title: "Assignment", desc: "Assign assets to users", path: "/fixed-asset/assignment" },
  { icon: ArrowSwapHorizontal, title: "User-Wise Asset Transfer", desc: "Move assets between users, project-wise", path: "/fixed-asset/transfer" },
  { icon: ShieldCheck, title: "Owner & Quality Checking", desc: "Owner confirmation & condition checks", path: "/fixed-asset/quality-check" },
  { icon: Wrench, title: "FA Maintenance & Repair", desc: "Log servicing and repairs", path: "/fixed-asset/maintenance" },
  { icon: Calculator, title: "Depreciation Generate", desc: "Post a month's depreciation per project", path: "/fixed-asset/depreciation-generate" },
  { icon: Setting2, title: "Depreciation Setup", desc: "Category-wise depreciation rates", path: "/fixed-asset/depreciation-setup" },
];

export default function FixedAssetDashboard() {
  usePageRights("fixed-asset-dashboard");
  const navigate = useNavigate();

  const { data: assets = [], isLoading } = useQuery({
    queryKey: ["fixed-assets"],
    queryFn: () => getFixedAssets(),
  });

  const live = ensureArray<FixedAssetListItem>(assets).filter((a) => a.Status !== "Deleted");
  const stats = {
    total: live.length,
    pending: live.filter((a) => a.AssetStatus === "Pending").length,
    active: live.filter((a) => a.AssetStatus === "Active").length,
    // Every AssetStatus present, for the breakdown bar (display only).
    byStatus: Object.entries(
      live.reduce<Record<string, number>>((m, a) => { const k = a.AssetStatus || "Unknown"; m[k] = (m[k] || 0) + 1; return m; }, {}),
    ).sort((a, b) => b[1] - a[1]),
    bookValue: live.reduce(
      (s, a) =>
        s +
        (a.PurchaseDate && a.DepreciationRate
          ? calcBookValue(a.PurchaseCost, a.DepreciationRate, a.PurchaseDate)
          : a.PurchaseCost || 0),
      0,
    ),
  };

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Fixed Asset"]} />
      <GlassShell
        title="Fixed Asset"
        subtitle="Portfolio overview, tagging queue & depreciation"
        icon={Cpu}
        accentColor={ACCENT}
      >
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <GlassCard label="Total Assets" value={isLoading ? "—" : stats.total} icon={Boxes} accentColor={ACCENT} />
          <GlassCard
            label="Pending / Untagged"
            value={isLoading ? "—" : stats.pending}
            icon={AlertCircle}
            accentColor="#f59e0b"
            sub={stats.pending > 0 ? "Needs tagging" : undefined}
          />
          <GlassCard label="Active" value={isLoading ? "—" : stats.active} icon={PlayCircle} accentColor="#10b981" />
          <GlassCard
            label="Total Book Value"
            value={isLoading ? "—" : fmtCur(stats.bookValue)}
            icon={Wallet}
            accentColor={ACCENT}
          />
        </div>

        {/* ── Where the portfolio stands ── */}
        {!isLoading && stats.total > 0 && (
          <GlassSection title="Status Breakdown" icon={PieChart} accentColor={ACCENT}>
            <div className="rounded-xl border border-border bg-card/60 p-4">
              <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
                {stats.byStatus.map(([k, n]) => (
                  <div key={k} title={`${k}: ${n}`} style={{ width: `${(n / stats.total) * 100}%`, background: STATUS_COLOR[k] ?? "#94a3b8" }} />
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
                {stats.byStatus.map(([k, n]) => (
                  <span key={k} className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_COLOR[k] ?? "#94a3b8" }} />
                    {k}
                    <span className="font-semibold tabular-nums text-foreground">{n}</span>
                    <span className="tabular-nums">({Math.round((n / stats.total) * 100)}%)</span>
                  </span>
                ))}
              </div>
            </div>
          </GlassSection>
        )}

        <GlassSection title="Quick Links" icon={Cpu} accentColor={ACCENT}>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {QUICK_LINKS.map((l) => (
              <QuickLinkCard key={l.path} icon={l.icon} title={l.title} desc={l.desc} onClick={() => navigate(l.path)} />
            ))}
          </div>
        </GlassSection>
      </GlassShell>
    </>
  );
}
