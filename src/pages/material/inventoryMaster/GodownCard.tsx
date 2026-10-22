import { useState } from "react";
import { Warehouse, Trash2, Pencil, MapPin, Building2, Tag, MoreVertical, Archive } from "lucide-react";
import { type Godown } from "@/api/godownsApi";
import { BodyPortal } from "@/components/ui/body-portal";

// ─── Godown Card ──────────────────────────────────────────────────────────────
export function GodownCard({
  godown,
  onEdit,
  onDelete,
  onView,
  canEdit = true,
  canDelete = true,
}: {
  godown: Godown;
  onEdit: (g: Godown) => void;
  onDelete: (g: Godown) => void;
  onView: (g: Godown) => void;
  canEdit?: boolean;
  canDelete?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      className="group relative rounded-2xl border border-border bg-card hover:border-emerald-500/40 hover:shadow-lg hover:shadow-emerald-500/5 transition-all duration-200 overflow-hidden cursor-pointer"
      onClick={(e) => {
        // Don't trigger when clicking the kebab menu
        if ((e.target as HTMLElement).closest("[data-menu]")) return;
        onView(godown);
      }}
    >
      {/* Top accent bar */}
      <div className="h-1 w-full bg-gradient-to-r from-emerald-500/40 to-emerald-400/40 group-hover:from-emerald-500 group-hover:to-emerald-400 transition-all duration-300" />

      <div className="p-5">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 bg-muted">
              <Warehouse size={19} className="text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-heading font-bold text-foreground break-words [overflow-wrap:anywhere]" title={godown.GodownName}>
                  {godown.GodownName}
                </p>
                {!godown.IsActive && (
                  <span className="text-[0.5625rem] bg-muted text-muted-foreground px-2 py-0.5 rounded-full font-medium uppercase tracking-wide">
                    Inactive
                  </span>
                )}
              </div>
              {godown.GodownCode && (
                <p className="text-[0.6875rem] font-mono text-muted-foreground mt-0.5">
                  {godown.GodownCode}
                </p>
              )}
            </div>
          </div>

          {/* Menu */}
          <div className="relative shrink-0" data-menu>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((o) => !o);
              }}
              className="p-1.5 rounded-lg hover:bg-muted transition-colors opacity-0 group-hover:opacity-100"
            >
              <MoreVertical size={14} className="text-muted-foreground" />
            </button>
            {menuOpen && (
              <>
                <BodyPortal><div
                  className="fixed inset-0 z-10"
                  onClick={() => setMenuOpen(false)}
                /></BodyPortal>
                <div className="absolute right-0 top-full mt-1 z-20 bg-card border border-border rounded-xl shadow-xl py-1 min-w-[140px]">
                  {canEdit && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpen(false);
                      onEdit(godown);
                    }}
                    className="w-full px-3 py-2 text-left text-xs flex items-center gap-2 hover:bg-muted transition-colors text-foreground"
                  >
                    <Pencil size={11} /> Edit
                  </button>
                  )}
                  {canDelete && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpen(false);
                      onDelete(godown);
                    }}
                    className="w-full px-3 py-2 text-left text-xs flex items-center gap-2 hover:bg-red-500/10 transition-colors text-red-500"
                  >
                    <Trash2 size={11} /> Delete
                  </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Meta pills */}
        <div className="flex flex-wrap gap-1.5">
          {godown.ShortDesc && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-muted text-[0.6875rem] text-muted-foreground">
              <Tag size={9} /> {godown.ShortDesc}
            </span>
          )}
          {godown.EnterpriseName && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500/10 text-[0.6875rem] text-emerald-600">
              <Building2 size={9} /> {godown.EnterpriseName}
            </span>
          )}
          {godown.ProjectName && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-violet-500/10 text-[0.6875rem] text-violet-600">
              <Archive size={9} /> {godown.ProjectName}
            </span>
          )}
          {godown.Location && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-orange-500/10 text-[0.6875rem] text-orange-600">
              <MapPin size={9} /> {godown.Location}
            </span>
          )}
        </div>

        {/* Description */}
        {godown.Description && (
          <p className="mt-3 text-[0.6875rem] text-muted-foreground leading-relaxed line-clamp-2 border-t border-border pt-3">
            {godown.Description}
          </p>
        )}
      </div>
    </div>
  );
}
