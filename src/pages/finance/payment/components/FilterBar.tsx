import React from "react";
import { useTheme } from "@/contexts/ThemeContext";
import { Building2, FolderKanban, CalendarDays, FileText, Search, X, ChevronDown } from "lucide-react";
import type { BookingFilters } from "../types";
import { PARTY_TYPE_LABELS } from "../api";

export function FilterBar({
  companyOptions,
  projectOptions,
  supplierOptions,
  finYearOptions,
  filters,
  onChange,
  selectedCompanyId,
}: {
  companyOptions: { id: number; label: string }[];
  projectOptions: {
    id: number;
    label: string;
    belongs_to?: number | null;
    company_id?: number | null;
  }[];
  supplierOptions: { id: number; label: string; type?: string }[];
  finYearOptions: { id: number; label: string }[];
  filters: BookingFilters;
  onChange: (key: keyof BookingFilters, value: string) => void;
  selectedCompanyId?: number | null;
}) {
  const companies = companyOptions.map((o) => o.label);

  // Filter projects to only those belonging to the selected company
  const filteredProjectOptions = selectedCompanyId
    ? projectOptions.filter(
        (p) =>
          p.belongs_to === selectedCompanyId ||
          p.company_id === selectedCompanyId,
      )
    : projectOptions;
  const projects = filteredProjectOptions.map((o) => o.label);
  const finYears = finYearOptions.map((o) => o.label);

  // Suppliers get grouped by category (Suppliers / Contractors / Brokers)
  // instead of one flat list — see PARTY_TYPE_LABELS.
  const supplierGroups = (() => {
    const groups = new Map<string, { id: number; label: string }[]>();
    supplierOptions.forEach((o) => {
      const key = PARTY_TYPE_LABELS[(o.type ?? "").trim()] ?? "Other";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(o);
    });
    const order = ["Suppliers", "Contractors", "Brokers", "Other"];
    return [...groups.keys()]
      .sort((a, b) => order.indexOf(a) - order.indexOf(b))
      .map((groupLabel) => ({ groupLabel, items: groups.get(groupLabel)! }));
  })();

  const activeCount = Object.values(filters).filter(Boolean).length;

  const dropdowns: {
    key: keyof BookingFilters;
    label: string;
    icon: React.ElementType;
    items: string[];
    placeholder: string;
  }[] = [
    {
      key: "company",
      label: "Company",
      icon: Building2,
      items: companies,
      placeholder: "All companies",
    },
    {
      key: "project",
      label: "Project",
      icon: FolderKanban,
      items: projects,
      placeholder: "All projects",
    },
    {
      key: "year",
      label: "Year",
      icon: CalendarDays,
      items: finYears,
      placeholder: "All years",
    },
  ];

  const { theme: _fbTheme } = useTheme();
  const _fbDark = _fbTheme !== "light";
  return (
    <div
      className="rounded-xl p-3 space-y-3"
      style={{
        background: _fbDark ? "rgba(15,17,26,0.4)" : "rgba(248,250,252,0.72)",
        border: _fbDark
          ? "1px solid rgba(99,102,241,0.14)"
          : "1px solid rgba(99,102,241,0.12)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div
            className="flex items-center justify-center w-5 h-5 rounded"
            style={{ background: "rgba(99,102,241,0.15)" }}
          >
            <Search size={11} style={{ color: "#818cf8" }} />
          </div>
          <span
            className="text-[11px] font-heading uppercase tracking-wider"
            style={{ color: _fbDark ? "#64748b" : "#6366f1" }}
          >
            Filter expense bookings
          </span>
          {activeCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-heading font-semibold bg-primary/15 text-primary border border-primary/20">
              {activeCount} active
            </span>
          )}
        </div>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={() => {
              onChange("company", "");
              onChange("project", "");
              onChange("year", "");
              onChange("supplier", "");
            }}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive transition-colors"
          >
            <X size={10} /> Clear all
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {dropdowns.map(({ key, label, icon: Icon, items, placeholder }) => (
          <div key={key} className="space-y-1">
            <label className="flex items-center gap-1 text-[10px] font-heading uppercase tracking-wider text-muted-foreground">
              <Icon size={9} /> {label}
            </label>
            <div className="relative">
              <select
                value={filters[key] || ""}
                onChange={(e) => onChange(key, e.target.value)}
                className="w-full appearance-none pl-2 pr-7 py-1.5 rounded-lg text-xs bg-background border border-border/70 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="">{placeholder}</option>
                {items.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={11}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
            </div>
          </div>
        ))}

        {/* Supplier / Contractor / Broker — grouped by category, unlike the flat lists above */}
        <div className="space-y-1">
          <label className="flex items-center gap-1 text-[10px] font-heading uppercase tracking-wider text-muted-foreground">
            <FileText size={9} /> Supplier
          </label>
          <div className="relative">
            <select
              value={filters.supplier || ""}
              onChange={(e) => onChange("supplier", e.target.value)}
              className="w-full appearance-none pl-2 pr-7 py-1.5 rounded-lg text-xs bg-background border border-border/70 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="">All suppliers</option>
              {supplierGroups.map(({ groupLabel, items }) => (
                <optgroup key={groupLabel} label={groupLabel}>
                  {items.map((item) => (
                    <option key={item.id} value={item.label}>
                      {item.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <ChevronDown
              size={11}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
          </div>
        </div>
      </div>

      {activeCount > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {(Object.entries(filters) as [keyof BookingFilters, string][]).map(
            ([key, val]) => {
              if (!val) return null;
              return (
                <span
                  key={key}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-heading font-semibold bg-primary/10 text-primary border border-primary/20"
                >
                  {val}
                  <button
                    type="button"
                    onClick={() => onChange(key, "")}
                    className="ml-0.5 text-primary/50 hover:text-destructive transition-colors"
                  >
                    <X size={9} />
                  </button>
                </span>
              );
            },
          )}
        </div>
      )}
    </div>
  );
}