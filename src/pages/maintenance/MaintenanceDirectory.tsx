import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Users, Search, Phone, Building2, Home, ChevronRight } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MaintenanceShell } from "@/components/maintenance/MaintenanceShell";
import { HrAvatar, HrEmpty, HrError, HR_FIELD, HR_NUM, HR_RULE } from "@/components/hrpayroll/HrUi";
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
        subtitle="Handed-over units only — select a customer to view their maintenance profile"
        action={
          <div className="relative w-full sm:w-64">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, mobile, unit…"
              className={`${HR_FIELD} pl-8`}
            />
          </div>
        }
      >
        {isLoading && <div className="skel" style={{ height: 240 }} />}
        {error && <HrError text="Failed to load directory." />}

        {!isLoading && !error && rows.length === 0 && (
          <div className="bg-card" style={{ border: HR_RULE }}>
            <HrEmpty
              icon={Users}
              title="No maintenance customers found"
              text="A customer appears here only once their unit has actually been handed over (CRM Handover marked Completed) — a Confirmed booking alone isn't enough."
            />
          </div>
        )}

        {/* Telephone-directory style list — one row per handed-over customer/unit */}
        {rows.length > 0 && (
          <div className="bg-card divide-y divide-foreground/15" style={{ border: HR_RULE }}>
            {rows.map((c) => (
              <button
                key={c.Id}
                onClick={() => navigate(`/maintenance/customer/${c.Id}`)}
                className="w-full flex items-center gap-4 px-4 py-3.5 text-left hover:bg-primary/5 transition-colors"
              >
                <HrAvatar name={c.CustomerName} size={36} />

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-heading font-semibold text-foreground truncate">
                    {c.CustomerName || "Unnamed Customer"}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-xs text-muted-foreground">
                    {c.ContactNumber && (
                      <span className={`flex items-center gap-1 ${HR_NUM}`}>
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
                  <p className={`text-[0.6875rem] text-foreground ${HR_NUM}`}>{c.BookingNo}</p>
                  {c.HandoverDate && (
                    <p className={`text-[0.6875rem] text-muted-foreground ${HR_NUM}`}>
                      Handed over {new Date(c.HandoverDate).toLocaleDateString("en-IN")}
                    </p>
                  )}
                </div>

                <ChevronRight size={16} className="text-muted-foreground shrink-0" />
              </button>
            ))}
          </div>
        )}
      </MaintenanceShell>
    </>
  );
}
