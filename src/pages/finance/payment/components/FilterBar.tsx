import React from "react";
import { createPortal } from "react-dom";
import { useTheme } from "@/contexts/ThemeContext";
import { Building2, FolderKanban, CalendarDays, Users, Search, X, ChevronDown } from "lucide-react";
import type { BookingFilters } from "../types";
import { PARTY_TYPE_LABELS } from "../api";

// Typeable, scrollable combobox for the Vendor filter (suppliers,
// contractors, brokers — grouped by category) — a plain native <select>
// gets unwieldy once the combined list runs past a couple dozen names.
//
// The dropdown panel is portalled to document.body (fixed-positioned off
// the trigger's own bounding rect) rather than absolutely positioned
// inside this grid cell — sitting inside the 4-column filter grid meant
// its stacking context could be intercepted by sibling cells (Company/
// Project/Year), which rendered their own chevrons/boxes overlapping the
// open panel. Portalling escapes that entirely, same pattern as
// LoanSanction.tsx's ComboField/CustomerComboField.
function VendorCombo({
  value,
  onChange,
  groups,
  placeholder,
}: {
  value: string;
  onChange: (val: string) => void;
  groups: { groupLabel: string; items: { id: number; label: string }[] }[];
  placeholder: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [rect, setRect] = React.useState<DOMRect | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  const updateRect = React.useCallback(() => {
    if (triggerRef.current) setRect(triggerRef.current.getBoundingClientRect());
  }, []);

  React.useEffect(() => {
    if (!open) return;
    updateRect();
    window.addEventListener("scroll", updateRect, true);
    window.addEventListener("resize", updateRect);
    return () => {
      window.removeEventListener("scroll", updateRect, true);
      window.removeEventListener("resize", updateRect);
    };
  }, [open, updateRect]);

  React.useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target as Node) &&
        panelRef.current && !panelRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const q = search.trim().toLowerCase();
  const filteredGroups = q
    ? groups
        .map((g) => ({ ...g, items: g.items.filter((i) => i.label.toLowerCase().includes(q)) }))
        .filter((g) => g.items.length > 0)
    : groups;

  const GAP = 4;
  const PANEL_MAX = 260;
  const spaceBelow = rect ? window.innerHeight - rect.bottom - GAP : 0;
  const spaceAbove = rect ? rect.top - GAP : 0;
  const openUpward = spaceAbove > spaceBelow && spaceBelow < PANEL_MAX;
  const listMaxHeight = Math.max(120, Math.min(192, (openUpward ? spaceAbove : spaceBelow) - 44));

  const panel = open && rect && createPortal(
    <div
      ref={panelRef}
      style={{
        position: "fixed",
        ...(openUpward
          ? { bottom: window.innerHeight - rect.top + GAP }
          : { top: rect.bottom + GAP }),
        left: rect.left,
        width: Math.max(rect.width, 200),
        zIndex: 9999,
      }}
      className="bg-card border border-border rounded-lg shadow-2xl overflow-hidden"
    >
      <div className="p-1.5 border-b border-border">
        <div className="relative">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            autoFocus
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Type to search…"
            className="w-full pl-6 pr-2 py-1 text-xs bg-muted border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>
      <div className="overflow-y-auto" style={{ maxHeight: listMaxHeight }}>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { onChange(""); setOpen(false); setSearch(""); }}
          className={`w-full text-left px-2.5 py-1.5 text-xs hover:bg-muted/50 transition-colors ${!value ? "text-primary font-semibold" : "text-muted-foreground"}`}
        >
          {placeholder}
        </button>
        {filteredGroups.length === 0 ? (
          <p className="px-2.5 py-2 text-xs text-muted-foreground">No matches</p>
        ) : (
          filteredGroups.map((g) => (
            <div key={g.groupLabel}>
              <p className="px-2.5 pt-2 pb-1 text-[10px] font-heading font-semibold uppercase tracking-wider text-muted-foreground/70">
                {g.groupLabel}
              </p>
              {g.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { onChange(item.label); setOpen(false); setSearch(""); }}
                  className={`w-full text-left px-2.5 py-1.5 text-xs hover:bg-muted/50 transition-colors truncate ${item.label === value ? "bg-primary/10 text-primary font-medium" : "text-foreground"}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </div>,
    document.body,
  );

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-1 pl-2 pr-1.5 py-1.5 rounded-lg text-xs bg-background border border-border/70 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
      >
        <span className={`truncate text-left ${value ? "" : "text-muted-foreground"}`}>
          {value || placeholder}
        </span>
        <ChevronDown size={11} className={`shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {panel}
    </div>
  );
}

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

  // VendorCombo renders one labeled header per group (Suppliers/Contractors/
  // Brokers/Other), matching PARTY_TYPE_LABELS' categorization — same
  // grouping the Payment form's own Payee/Party dropdown uses.
  const CATEGORY_ORDER = ["Suppliers", "Contractors", "Brokers", "Other"];
  const supplierGroups = (() => {
    const groups = new Map<string, { id: number; label: string }[]>();
    supplierOptions.forEach((s) => {
      const key = PARTY_TYPE_LABELS[(s.type ?? "").trim()] ?? "Other";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push({ id: s.id, label: s.label });
    });
    return [...groups.keys()]
      .sort((a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b))
      .map((groupLabel) => ({
        groupLabel,
        items: groups.get(groupLabel)!.sort((a, b) => a.label.localeCompare(b.label)),
      }));
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

        {/* Vendor — Supplier/Contractor/Broker combined, grouped by category
            and searchable (see VendorCombo above), unlike the flat native
            <select>s used for the other filters. */}
        <div className="space-y-1">
          <label className="flex items-center gap-1 text-[10px] font-heading uppercase tracking-wider text-muted-foreground">
            <Users size={9} /> Vendor
          </label>
          <VendorCombo
            value={filters.supplier || ""}
            onChange={(val) => onChange("supplier", val)}
            groups={supplierGroups}
            placeholder="All vendors"
          />
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