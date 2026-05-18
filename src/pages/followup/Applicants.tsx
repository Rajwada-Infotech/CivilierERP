import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import {
  Search,
  Filter,
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
  Clock,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Applicant {
  LHeadCode: string;
  LHeadName: string;
  LHeadAlias?: string;
  LHeadStatus: string; // e.g. "A" = Active, "I" = Inactive, "P" = Pending
  Address1?: string;
  Address2?: string;
  City?: string;
  State?: string;
  PinCode?: string;
  Phone1?: string;
  Phone2?: string;
  Mobile?: string;
  Email?: string;
  GSTNo?: string;
  PANNo?: string;
  OpeningBalance?: number;
  CreditLimit?: number;
  CreditDays?: number;
  CreatedDate?: string;
}

// ─── Status helpers ──────────────────────────────────────────────────────────

const STATUS_MAP: Record<
  string,
  { label: string; color: string; icon: React.ReactNode }
> = {
  A: {
    label: "Active",
    color: "status-active",
    icon: <CheckCircle size={12} />,
  },
  I: {
    label: "Inactive",
    color: "status-inactive",
    icon: <XCircle size={12} />,
  },
  P: { label: "Pending", color: "status-pending", icon: <Clock size={12} /> },
};

function getStatus(code: string) {
  return (
    STATUS_MAP[code] ?? { label: code, color: "status-default", icon: null }
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

// Deterministic avatar color from name
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

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  accent: string;
}) {
  return (
    <div className="stat-card">
      <div
        className="stat-icon"
        style={{ background: accent + "18", color: accent }}
      >
        {icon}
      </div>
      <div className="stat-body">
        <span className="stat-value">{value}</span>
        <span className="stat-label">{label}</span>
      </div>
    </div>
  );
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
      className="applicant-card"
      onClick={onClick}
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
    >
      {/* Avatar */}
      <div className="card-avatar" style={{ background: bg }}>
        {initials(applicant.LHeadName)}
      </div>

      {/* Main info */}
      <div className="card-main">
        <div className="card-header-row">
          <span className="card-name">{applicant.LHeadName}</span>
          <span className={`status-badge ${status.color}`}>
            {status.icon}
            {status.label}
          </span>
        </div>
        <span className="card-code">{applicant.LHeadCode}</span>

        <div className="card-meta">
          {applicant.Mobile && (
            <span className="meta-item">
              <Phone size={12} /> {applicant.Mobile}
            </span>
          )}
          {applicant.Email && (
            <span className="meta-item">
              <Mail size={12} />
              <span className="meta-email">{applicant.Email}</span>
            </span>
          )}
          {applicant.City && (
            <span className="meta-item">
              <MapPin size={12} /> {applicant.City}
              {applicant.State ? `, ${applicant.State}` : ""}
            </span>
          )}
        </div>

        <div className="card-chips">
          {applicant.GSTNo && (
            <span className="chip chip-gst">
              <Building2 size={10} /> GST: {applicant.GSTNo}
            </span>
          )}
          {applicant.PANNo && (
            <span className="chip chip-pan">
              <CreditCard size={10} /> PAN: {applicant.PANNo}
            </span>
          )}
          {applicant.CreditLimit != null && applicant.CreditLimit > 0 && (
            <span className="chip chip-credit">
              Limit ₹{applicant.CreditLimit.toLocaleString("en-IN")}
            </span>
          )}
        </div>
      </div>

      <ChevronRight size={16} className="card-arrow" />
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

const Applicants: React.FC = () => {
  const navigate = useNavigate();

  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [cities, setCities] = useState<string[]>([]);

  const fetchApplicants = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      if (cityFilter) params.city = cityFilter;

      const res = await axios.get("/api/applicants", { params });
      const data: Applicant[] = res.data.data ?? [];
      setApplicants(data);

      // Build city list from full dataset (only on first load / no city filter)
      if (!cityFilter) {
        const uniqueCities = [
          ...new Set(data.map((a) => a.City).filter(Boolean)),
        ] as string[];
        setCities(uniqueCities.sort());
      }
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to load applicants");
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, cityFilter]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(fetchApplicants, 300);
    return () => clearTimeout(timer);
  }, [fetchApplicants]);

  // Stats
  const total = applicants.length;
  const active = applicants.filter((a) => a.LHeadStatus === "A").length;
  const inactive = applicants.filter((a) => a.LHeadStatus === "I").length;
  const pending = applicants.filter((a) => a.LHeadStatus === "P").length;

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("");
    setCityFilter("");
  };

  const hasFilters = search || statusFilter || cityFilter;

  return (
    <>
      <style>{`
        /* ── Root ── */
        .appl-page {
          min-height: 100vh;
          background: #f8fafc;
          font-family: 'DM Sans', 'Segoe UI', sans-serif;
          color: #0f172a;
        }

        /* ── Header ── */
        .appl-header {
          background: #fff;
          border-bottom: 1px solid #e2e8f0;
          padding: 20px 28px 0;
        }
        .appl-header-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 20px;
        }
        .appl-title {
          font-size: 22px;
          font-weight: 700;
          letter-spacing: -0.4px;
          color: #0f172a;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .appl-title-icon {
          width: 36px; height: 36px;
          background: #1d4ed8;
          border-radius: 9px;
          display: flex; align-items: center; justify-content: center;
          color: #fff;
        }
        .appl-count {
          font-size: 13px;
          font-weight: 500;
          color: #64748b;
          background: #f1f5f9;
          border-radius: 20px;
          padding: 2px 10px;
          margin-left: 4px;
        }

        .refresh-btn {
          display: flex; align-items: center; gap: 6px;
          background: #f1f5f9;
          border: none; border-radius: 8px;
          padding: 8px 14px;
          font-size: 13px; font-weight: 500;
          color: #475569; cursor: pointer;
          transition: background 0.15s;
        }
        .refresh-btn:hover { background: #e2e8f0; }
        .refresh-btn.loading svg { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* ── Stats ── */
        .stats-row {
          display: flex;
          gap: 12px;
          padding-bottom: 18px;
          overflow-x: auto;
        }
        .stat-card {
          display: flex; align-items: center; gap: 10px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          padding: 10px 16px;
          min-width: 130px;
          flex-shrink: 0;
        }
        .stat-icon {
          width: 34px; height: 34px;
          border-radius: 8px;
          display: flex; align-items: center; justify-content: center;
        }
        .stat-body { display: flex; flex-direction: column; }
        .stat-value { font-size: 20px; font-weight: 700; line-height: 1.2; }
        .stat-label { font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }

        /* ── Filters ── */
        .filter-bar {
          background: #fff;
          border-bottom: 1px solid #e2e8f0;
          padding: 12px 28px;
          display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
        }
        .search-wrap {
          position: relative; flex: 1; min-width: 220px;
        }
        .search-wrap svg {
          position: absolute; left: 11px; top: 50%; transform: translateY(-50%);
          color: #94a3b8; pointer-events: none;
        }
        .search-input {
          width: 100%; padding: 9px 12px 9px 36px;
          border: 1.5px solid #e2e8f0; border-radius: 9px;
          font-size: 14px; background: #f8fafc; color: #0f172a;
          outline: none; transition: border-color 0.15s;
          box-sizing: border-box;
        }
        .search-input:focus { border-color: #1d4ed8; background: #fff; }

        .filter-select {
          padding: 9px 12px; border: 1.5px solid #e2e8f0; border-radius: 9px;
          font-size: 13px; background: #f8fafc; color: #475569;
          outline: none; cursor: pointer; transition: border-color 0.15s;
        }
        .filter-select:focus { border-color: #1d4ed8; }

        .clear-btn {
          display: flex; align-items: center; gap: 5px;
          padding: 9px 12px; border: 1.5px solid #fca5a5;
          background: #fff1f2; border-radius: 9px;
          font-size: 13px; color: #dc2626; cursor: pointer;
          transition: background 0.15s;
        }
        .clear-btn:hover { background: #fee2e2; }

        /* ── List ── */
        .appl-body { padding: 20px 28px; }

        .applicant-card {
          display: flex; align-items: flex-start; gap: 14px;
          background: #fff;
          border: 1.5px solid #e2e8f0;
          border-radius: 12px;
          padding: 16px 18px;
          margin-bottom: 10px;
          cursor: pointer;
          transition: border-color 0.15s, box-shadow 0.15s, transform 0.1s;
          position: relative;
        }
        .applicant-card:hover {
          border-color: #1d4ed8;
          box-shadow: 0 4px 16px rgba(29,78,216,0.08);
          transform: translateY(-1px);
        }
        .applicant-card:focus { outline: 2px solid #1d4ed8; outline-offset: 2px; }

        .card-avatar {
          width: 44px; height: 44px; border-radius: 12px;
          display: flex; align-items: center; justify-content: center;
          font-size: 15px; font-weight: 700; color: #fff;
          flex-shrink: 0; letter-spacing: 0.5px;
        }

        .card-main { flex: 1; min-width: 0; }
        .card-header-row {
          display: flex; align-items: center; gap: 8px;
          flex-wrap: wrap; margin-bottom: 2px;
        }
        .card-name {
          font-size: 15px; font-weight: 600; color: #0f172a;
        }
        .card-code {
          display: block;
          font-size: 12px; color: #94a3b8;
          margin-bottom: 8px;
        }

        /* Status badges */
        .status-badge {
          display: inline-flex; align-items: center; gap: 4px;
          font-size: 11px; font-weight: 600;
          border-radius: 20px; padding: 2px 9px;
        }
        .status-active   { background: #dcfce7; color: #15803d; }
        .status-inactive { background: #fee2e2; color: #b91c1c; }
        .status-pending  { background: #fef3c7; color: #b45309; }
        .status-default  { background: #f1f5f9; color: #475569; }

        .card-meta {
          display: flex; flex-wrap: wrap; gap: 10px;
          margin-bottom: 8px;
        }
        .meta-item {
          display: flex; align-items: center; gap: 4px;
          font-size: 12.5px; color: #475569;
        }
        .meta-email {
          max-width: 180px;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }

        .card-chips { display: flex; flex-wrap: wrap; gap: 6px; }
        .chip {
          display: inline-flex; align-items: center; gap: 4px;
          font-size: 11px; font-weight: 500;
          border-radius: 6px; padding: 3px 8px;
        }
        .chip-gst    { background: #eff6ff; color: #1d4ed8; }
        .chip-pan    { background: #f5f3ff; color: #6d28d9; }
        .chip-credit { background: #f0fdf4; color: #15803d; }

        .card-arrow {
          color: #cbd5e1; margin-top: 4px; flex-shrink: 0;
          transition: color 0.15s, transform 0.15s;
        }
        .applicant-card:hover .card-arrow {
          color: #1d4ed8; transform: translateX(3px);
        }

        /* ── States ── */
        .state-box {
          display: flex; flex-direction: column; align-items: center;
          justify-content: center; padding: 60px 20px; color: #94a3b8;
          gap: 12px;
        }
        .state-box svg { color: #cbd5e1; }
        .state-box p { font-size: 15px; margin: 0; }
        .state-box span { font-size: 13px; }

        .error-box {
          display: flex; align-items: center; gap: 10px;
          background: #fff1f2; border: 1px solid #fca5a5;
          border-radius: 10px; padding: 14px 18px;
          color: #b91c1c; font-size: 14px; margin-bottom: 16px;
        }

        /* ── Skeleton ── */
        .skeleton-card {
          background: #fff; border: 1.5px solid #e2e8f0;
          border-radius: 12px; padding: 16px 18px;
          margin-bottom: 10px; display: flex; gap: 14px; align-items: flex-start;
        }
        .skel { background: #f1f5f9; border-radius: 6px; animation: pulse 1.4s ease-in-out infinite; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
        .skel-avatar { width: 44px; height: 44px; border-radius: 12px; flex-shrink: 0; }
        .skel-body { flex: 1; }
        .skel-line { height: 13px; margin-bottom: 8px; }
        .skel-line.w-60 { width: 60%; }
        .skel-line.w-40 { width: 40%; }
        .skel-line.w-80 { width: 80%; }
      `}</style>

      <div className="appl-page">
        {/* Header */}
        <div className="appl-header">
          <div className="appl-header-top">
            <div className="appl-title">
              <div className="appl-title-icon">
                <Users size={18} />
              </div>
              Applicants
              {!loading && <span className="appl-count">{total}</span>}
            </div>
            <button
              className={`refresh-btn ${loading ? "loading" : ""}`}
              onClick={fetchApplicants}
              disabled={loading}
            >
              <RefreshCw size={14} />
              Refresh
            </button>
          </div>

          {/* Stats */}
          <div className="stats-row">
            <StatCard
              icon={<TrendingUp size={16} />}
              label="Total"
              value={total}
              accent="#1d4ed8"
            />
            <StatCard
              icon={<CheckCircle size={16} />}
              label="Active"
              value={active}
              accent="#15803d"
            />
            <StatCard
              icon={<XCircle size={16} />}
              label="Inactive"
              value={inactive}
              accent="#b91c1c"
            />
            <StatCard
              icon={<Clock size={16} />}
              label="Pending"
              value={pending}
              accent="#b45309"
            />
          </div>
        </div>

        {/* Filter Bar */}
        <div className="filter-bar">
          <div className="search-wrap">
            <Search size={14} />
            <input
              className="search-input"
              placeholder="Search by name, code, mobile, email, GST…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <select
            className="filter-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All Status</option>
            <option value="A">Active</option>
            <option value="I">Inactive</option>
            <option value="P">Pending</option>
          </select>

          {cities.length > 0 && (
            <select
              className="filter-select"
              value={cityFilter}
              onChange={(e) => setCityFilter(e.target.value)}
            >
              <option value="">All Cities</option>
              {cities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}

          {hasFilters && (
            <button className="clear-btn" onClick={clearFilters}>
              <X size={13} /> Clear
            </button>
          )}
        </div>

        {/* Body */}
        <div className="appl-body">
          {error && (
            <div className="error-box">
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          {loading ? (
            // Skeleton
            Array.from({ length: 6 }).map((_, i) => (
              <div className="skeleton-card" key={i}>
                <div className="skel skel-avatar" />
                <div className="skel-body">
                  <div className="skel skel-line w-60" />
                  <div className="skel skel-line w-40" />
                  <div className="skel skel-line w-80" />
                </div>
              </div>
            ))
          ) : applicants.length === 0 ? (
            <div className="state-box">
              <User size={40} />
              <p>No applicants found</p>
              {hasFilters && <span>Try clearing filters</span>}
            </div>
          ) : (
            applicants.map((a) => (
              <ApplicantCard
                key={a.LHeadCode}
                applicant={a}
                onClick={() =>
                  navigate(`/applicant-timeline/${a.LHeadCode}`, {
                    state: { applicant: a },
                  })
                }
              />
            ))
          )}
        </div>
      </div>
    </>
  );
};

export default Applicants;
