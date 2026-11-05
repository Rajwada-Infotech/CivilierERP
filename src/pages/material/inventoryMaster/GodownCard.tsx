import { useState } from "react";
import { Trash2, Pencil, MapPin, Building2, Tag, MoreVertical, Archive } from "lucide-react";
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
      className="group relative border border-foreground/30 bg-card hover:border-foreground/40 transition-all duration-200 overflow-hidden cursor-pointer"
      onClick={(e) => {
        // Don't trigger when clicking the kebab menu
        if ((e.target as HTMLElement).closest("[data-menu]")) return;
        onView(godown);
      }}
    >
      <div className="p-5">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-heading font-bold text-foreground break-words [overflow-wrap:anywhere]" title={godown.GodownName}>
                  {godown.GodownName}
                </p>
                {!godown.IsActive && (
                  <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 border border-foreground/40 text-muted-foreground">
                    Inactive
                  </span>
                )}
              </div>
              {godown.GodownCode && (
                <p className="text-[0.6875rem] font-heading text-muted-foreground mt-0.5">
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
              className="p-1.5 hover:bg-primary/5 transition-colors sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100"
            >
              <MoreVertical size={14} className="text-muted-foreground" />
            </button>
            {menuOpen && (
              <>
                <BodyPortal><div
                  className="fixed inset-0 z-10"
                  onClick={() => setMenuOpen(false)}
                /></BodyPortal>
                <div className="absolute right-0 top-full mt-1 z-20 bg-card border border-foreground/30 py-1 min-w-[140px]">
                  {canEdit && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpen(false);
                      onEdit(godown);
                    }}
                    className="w-full px-3 py-2 text-left text-xs flex items-center gap-2 hover:bg-primary/5 transition-colors text-foreground"
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
                    className="w-full px-3 py-2 text-left text-xs flex items-center gap-2 hover:bg-destructive/10 transition-colors text-destructive"
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
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-card text-[0.6875rem] text-muted-foreground">
              <Tag size={9} /> {godown.ShortDesc}
            </span>
          )}
          {godown.EnterpriseName && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-card text-[0.6875rem] text-foreground">
              <Building2 size={9} /> {godown.EnterpriseName}
            </span>
          )}
          {godown.ProjectName && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-card text-[0.6875rem] text-foreground">
              <Archive size={9} /> {godown.ProjectName}
            </span>
          )}
          {godown.Location && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-card text-[0.6875rem] text-foreground">
              <MapPin size={9} /> {godown.Location}
            </span>
          )}
        </div>

        {/* Description */}
        {godown.Description && (
          <p className="mt-3 text-[0.6875rem] text-muted-foreground leading-relaxed line-clamp-2 border-t border-foreground/30 pt-3">
            {godown.Description}
          </p>
        )}
      </div>
    </div>
  );
}
