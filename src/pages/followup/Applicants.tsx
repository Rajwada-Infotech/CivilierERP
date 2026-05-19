import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  Search,
  User,
  Phone,
  Mail,
  MapPin,
  ChevronRight,
  Building2,
  CreditCard,
  RefreshCw,
  X,
  AlertCircle,
  TrendingUp,
  Users,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { DashboardBackground } from "@/components/DashboardBackground";
import { Breadcrumbs } from "@/components/Breadcrumbs";

interface Applicant {
  LHeadId: number;
  LHeadCode: string | null;
  LHeadName: string;
  LHeadType: string;
  LHeadStatus: number;
  LHeadPhone?: string;
  LHeadEmail?: string;
  LHeadAddress?: string;
  LHeadContactPerson?: string;
  LHeadPaymentTerms?: string;
  LGST?: string;
  LGSTState?: string;
  LCountry?: string;
  LBelongsTo?: string;
  LDescription?: string;
  LBranchName?: string;
}

const STATUS_CONFIG: Record<
  number,
  { label: string; pill: string; icon: React.ReactNode }
> = {
  1: {
    label: "Active",
    pill: "bg-emerald-500/10 text-emerald-600 border border-emerald-400/20",
    icon: <CheckCircle size={11} />,
  },
  0: {
    label: "Inactive",
    pill: "bg-red-500/10 text-red-500 border border-red-400/20",
    icon: <XCircle size={11} />,
  },
};

function getStatus(code: number) {
  return (
    STATUS_CONFIG[code] ?? {
      label: "Unknown",
      pill: "bg-muted text-muted-foreground border border-border",
      icon: null,
    }
  );
}

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

const AVATAR_COLORS = [
  "#2563EB",
  "#7C3AED",
  "#0891B2",
  "#059669",
  "#D97706",
  "#DC2626",
  "#DB2777",
  "#4F46E5",
];
function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function ApplicantCard({
  applicant,
  onClick,
}: {
  applicant: Applicant;
  onClick: () => void;
}) {
  const status = getStatus(applicant.LHeadStatus);
  const bg = avatarColor(applicant.LHeadName);

  return (
    <div
      className="group flex items-start gap-3.5 bg-card border border-border rounded-xl px-4 py-3.5 mb-2.5 cursor-pointer transition-all duration-200 hover:border-primary/30 hover:shadow-md hover:-translate-y-px focus:outline-none focus:ring-2 focus:ring-primary/40"
      onClick={onClick}
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
    >
      <div
        className="w-11 h-11 rounded-xl flex items-center justify-center text-[15px] font-bold text-white flex-shrink-0"
        style={{ background: bg }}
      >
        {initials(applicant.LHeadName)}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          <span className="text-[15px] font-semibold text-foreground">
            {applicant.LHeadName}
          </span>
          <span
            className={`inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2 py-0.5 ${status.pill}`}
          >
            {status.icon}
            {status.label}
          </span>
        </div>
        {applicant.LHeadCode && (
          <span className="block text-[12px] text-muted-foreground mb-2">
            {applicant.LHeadCode}
          </span>
        )}
        <div className="flex flex-wrap gap-2.5 mb-2">
          {applicant.LHeadPhone && (
            <span className="flex items-center gap-1 text-[12.5px] text-muted-foreground">
              <Phone size={12} /> {applicant.LHeadPhone}
            </span>
          )}
          {applicant.LHeadEmail && (
            <span className="flex items-center gap-1 text-[12.5px] text-muted-foreground">
              <Mail size={12} />
              <span className="max-w-[180px] truncate">
                {applicant.LHeadEmail}
              </span>
            </span>
          )}
          {applicant.LHeadAddress && (
            <span className="flex items-center gap-1 text-[12.5px] text-muted-foreground">
              <MapPin size={12} /> {applicant.LHeadAddress}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {applicant.LGST && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-blue-500/10 text-blue-600 border border-blue-400/20 rounded-md px-2 py-0.5">
              <Building2 size={10} /> GST: {applicant.LGST}
            </span>
          )}
          {applicant.LHeadContactPerson && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-violet-500/10 text-violet-600 border border-violet-400/20 rounded-md px-2 py-0.5">
              <CreditCard size={10} /> Contact: {applicant.LHeadContactPerson}
            </span>
          )}
        </div>
      </div>

      <ChevronRight
        size={16}
        className="text-muted-foreground/40 mt-1 flex-shrink-0 group-hover:text-primary group-hover:translate-x-0.5 transition-all"
      />
    </div>
  );
}

const Applicants: React.FC = () => {
  const navigate = useNavigate();
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const fetchApplicants = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetchWithAuth(`/api/applicants?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setApplicants(json.data ?? []);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load applicants");
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    const timer = setTimeout(fetchApplicants, 300);
    return () => clearTimeout(timer);
  }, [fetchApplicants]);

  const total = applicants.length;
  const active = applicants.filter((a) => a.LHeadStatus === 1).length;
  const inactive = applicants.filter((a) => a.LHeadStatus === 0).length;
  const hasFilters = search || statusFilter;

  return (
    <>
      <DashboardBackground />
      <div className="relative z-10 p-6 space-y-6 max-w-[1400px] mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <Breadcrumbs
              items={[
                { label: "Follow-Up", path: "/followup" },
                { label: "Applicants", path: "/followup/sales/applicants" },
              ]}
            />
            <div className="flex items-center gap-3 mt-1.5">
              <div className="p-2.5 rounded-xl bg-blue-500/10">
                <Users size={20} className="text-blue-600" />
              </div>
              <div>
                <h1 className="text-2xl font-heading font-bold text-foreground">
                  Applicants
                </h1>
                <p className="text-xs text-muted-foreground mt-0.5">
                  All registered applicants and leads
                </p>
              </div>
            </div>
          </div>
          <button
            onClick={fetchApplicants}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-muted transition-colors mt-1"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            {
              icon: <TrendingUp size={16} />,
              label: "Total",
              value: total,
              accent: "text-blue-600",
              bg: "bg-blue-500/10",
            },
            {
              icon: <CheckCircle size={16} />,
              label: "Active",
              value: active,
              accent: "text-emerald-600",
              bg: "bg-emerald-500/10",
            },
            {
              icon: <XCircle size={16} />,
              label: "Inactive",
              value: inactive,
              accent: "text-red-500",
              bg: "bg-red-500/10",
            },
          ].map((t) => (
            <div
              key={t.label}
              className="rounded-xl border border-border bg-card p-4"
            >
              <div className={`p-2 rounded-lg ${t.bg} w-fit mb-3`}>
                <span className={t.accent}>{t.icon}</span>
              </div>
              <p className="text-2xl font-bold font-heading text-foreground leading-none">
                {t.value}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">
                {t.label}
              </p>
            </div>
          ))}
        </div>

        {/* Filter bar */}
        <div className="flex gap-2.5 items-center flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
            <input
              className="w-full pl-9 pr-9 py-[9px] border border-border rounded-lg text-sm bg-card text-foreground outline-none focus:border-primary/60 transition-colors"
              placeholder="Search by name, code, mobile, email, GST…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X size={13} />
              </button>
            )}
          </div>
          <select
            className="px-3 py-[9px] border border-border rounded-lg text-sm bg-card text-muted-foreground outline-none cursor-pointer focus:border-primary/60 transition-colors"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All Status</option>
            <option value="1">Active</option>
            <option value="0">Inactive</option>
          </select>
          {hasFilters && (
            <button
              className="flex items-center gap-1.5 px-3 py-[9px] border border-red-400/30 bg-red-500/5 text-red-500 rounded-lg text-xs font-medium hover:bg-red-500/10 transition-colors"
              onClick={() => {
                setSearch("");
                setStatusFilter("");
              }}
            >
              <X size={13} /> Clear
            </button>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2.5 bg-red-500/10 border border-red-400/30 rounded-xl px-4 py-3 text-sm text-red-500">
            <AlertCircle size={16} /> {error}
          </div>
        )}

        {/* List */}
        {loading ? (
          <div className="space-y-2.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="flex gap-3.5 bg-card border border-border rounded-xl px-4 py-3.5 animate-pulse"
              >
                <div className="w-11 h-11 rounded-xl bg-muted flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-muted rounded w-3/5" />
                  <div className="h-3 bg-muted rounded w-2/5" />
                  <div className="h-3 bg-muted rounded w-4/5" />
                </div>
              </div>
            ))}
          </div>
        ) : applicants.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="p-4 rounded-2xl bg-muted mb-4">
              <User size={28} className="text-muted-foreground" />
            </div>
            <p className="text-sm font-semibold text-foreground">
              No applicants found
            </p>
            {hasFilters && (
              <p className="text-xs text-muted-foreground mt-1">
                Try clearing filters
              </p>
            )}
          </div>
        ) : (
          <div>
            {applicants.map((a) => (
              <ApplicantCard
                key={a.LHeadId ?? a.LHeadCode}
                applicant={a}
                onClick={() =>
                  navigate(`/applicant-timeline/${a.LHeadId}`, {
                    state: { applicant: a },
                  })
                }
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
};

export default Applicants;
