import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Users, Search, Phone, Building2, Home, ChevronRight } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MaintenanceShell, MAINTENANCE_ACCENT as ACCENT } from "@/components/maintenance/MaintenanceShell";
import { usePageRights } from "@/hooks/usePageRights";
import { getMaintenanceDirectory } from "@/api/maintenanceApi";

export default function MaintenanceDirectory() {
  usePageRights("maintenance-directory");
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["maintenance-directory", search],
    queryFn: () => getMaintenanceDirectory(search),
    staleTime: 60 * 1000,
  });

  const rows = Array.isArray(data) ? data : [];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Maintenance", "Customer Directory"]} />
      <MaintenanceShell
        title="Customer Directory"
        subtitle="Confirmed bookings — select a customer to view their maintenance profile"
        icon={Users}
        action={
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, mobile, unit…"
              className="pl-8 pr-3 py-1.5 rounded-lg text-xs font-body bg-muted border border-border focus:outline-none focus:ring-2 focus:ring-primary text-foreground w-56"
            />
          </div>
        }
      >
        {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {error && <div className="text-sm text-red-500">Failed to load directory.</div>}

        {!isLoading && !error && rows.length === 0 && (
          <div className="rounded-xl border border-dashed border-border py-10 flex flex-col items-center gap-2 text-center px-6">
            <Users size={20} className="text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">No confirmed customers found</p>
            <p className="text-xs text-muted-foreground max-w-sm">
              Customers appear here once their CRM booking status is Confirmed.
            </p>
          </div>
        )}

        {/* Telephone-directory style list — one row per confirmed customer/unit */}
        <div className="divide-y divide-border rounded-xl border border-border overflow-hidden bg-card/40">
          {rows.map((c) => (
            <button
              key={c.Id}
              onClick={() => navigate(`/maintenance/customer/${c.Id}`)}
              className="w-full flex items-center gap-4 px-4 py-3.5 text-left hover:bg-muted/40 transition-colors"
            >
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 font-heading font-bold text-sm"
                style={{ background: `${ACCENT}18`, border: `1px solid ${ACCENT}30`, color: ACCENT }}
              >
                {(c.CustomerName || "?").trim().charAt(0).toUpperCase()}
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-heading font-semibold text-foreground truncate">
                  {c.CustomerName || "Unnamed Customer"}
                </p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-xs text-muted-foreground">
                  {c.ContactNumber && (
                    <span className="flex items-center gap-1">
                      <Phone size={11} /> {c.ContactNumber}
                    </span>
                  )}
                  {(c.UnitNo || c.BlockName) && (
                    <span className="flex items-center gap-1">
                      <Home size={11} /> {[c.BlockName, c.UnitNo].filter(Boolean).join(" / ")}
                    </span>
                  )}
                  {c.ProjectName && (
                    <span className="flex items-center gap-1">
                      <Building2 size={11} /> {c.ProjectName}
                    </span>
                  )}
                </div>
              </div>

              <div className="text-right shrink-0 hidden sm:block">
                <p className="text-[11px] font-mono text-muted-foreground">{c.BookingNo}</p>
                {c.BookingDate && (
                  <p className="text-[11px] text-muted-foreground">
                    {new Date(c.BookingDate).toLocaleDateString("en-IN")}
                  </p>
                )}
              </div>

              <ChevronRight size={16} className="text-muted-foreground shrink-0" />
            </button>
          ))}
        </div>
      </MaintenanceShell>
    </>
  );
}
