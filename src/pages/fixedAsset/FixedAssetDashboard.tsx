import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { usePageRights } from "@/hooks/usePageRights";
import { Cpu, Tag, Setting2, ArrowSwapHorizontal } from "iconsax-react";
import { Boxes, AlertCircle, PlayCircle, Wallet, ChevronRight } from "lucide-react";
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

        <GlassSection title="Quick Links" icon={Cpu} accentColor={ACCENT}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <QuickLinkCard
              icon={Cpu}
              title="Fixed Asset Record"
              desc="Browse & manage the full asset register"
              onClick={() => navigate("/fixed-asset/record")}
            />
            <QuickLinkCard
              icon={Tag}
              title="FA Inventory"
              desc="Tag received stock, track untagged qty"
              onClick={() => navigate("/fixed-asset/tagging")}
            />
            <QuickLinkCard
              icon={ArrowSwapHorizontal}
              title="User-Wise Asset Transfer"
              desc="Move assets between users, project-wise"
              onClick={() => navigate("/fixed-asset/transfer")}
            />
            <QuickLinkCard
              icon={Setting2}
              title="Depreciation Setup"
              desc="Category-wise depreciation rates"
              onClick={() => navigate("/fixed-asset/depreciation-setup")}
            />
          </div>
        </GlassSection>
      </GlassShell>
    </>
  );
}
