import { useQuery } from "@tanstack/react-query";
import { getTransferableFaCodes } from "@/api/interCompanyTransferApi";

// ─── FA Item Code picker ──────────────────────────────────────────────────────
// A Fixed Asset unit has its own FA Item Code and depreciation, so an inter-
// company transfer says exactly which units move. Selecting codes sets the
// line's quantity. On approval the old codes become "Transferred" and the
// receiving company gets fresh FA Inventory entries with brand-new FA Codes.
export function FaCodePicker({
  projectId,
  itemId,
  selected,
  takenElsewhere,
  onChange,
}: {
  projectId: number | undefined;
  itemId: string;
  selected: number[];
  takenElsewhere: Set<number>;
  onChange: (ids: number[]) => void;
}) {
  const { data: codes = [], isLoading, isError } = useQuery({
    queryKey: ["ict-fa-codes", projectId, itemId],
    queryFn: () => getTransferableFaCodes(projectId!, itemId),
    enabled: !!projectId && !!itemId,
    staleTime: 15_000,
  });

  const toggle = (id: number) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <div className="ml-10 mr-3 -mt-1 mb-1 border border-dashed border-foreground/40 bg-card px-3 py-2.5">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <p className="text-[0.625rem] font-semibold uppercase tracking-wider text-foreground">
          Fixed Asset — select the FA Item Code of each unit being transferred
        </p>
        <span
          className={`text-[0.625rem] font-semibold px-2 py-0.5 ${
            selected.length > 0 ? "bg-card text-foreground" : "bg-card text-foreground"
          }`}
        >
          {selected.length} selected
        </span>
      </div>
      {!projectId ? (
        <p className="text-[0.6875rem] text-muted-foreground">Pick the source godown first.</p>
      ) : isLoading ? (
        <p className="text-[0.6875rem] text-muted-foreground">Loading FA Item Codes…</p>
      ) : isError ? (
        <p className="text-[0.6875rem] text-destructive">Couldn't load the FA Item Codes.</p>
      ) : codes.length === 0 ? (
        <p className="text-[0.6875rem] text-foreground">
          No active FA Item Codes for this item in the sending project — tag the stock in FA Inventory first, or the codes are already on another transfer.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {codes.map((c) => {
            const on = selected.includes(c.TagId);
            const blocked = !on && takenElsewhere.has(c.TagId);
            return (
              <button
                key={c.TagId}
                type="button"
                disabled={blocked}
                onClick={() => toggle(c.TagId)}
                title={[
                  c.RecordDocNo ? `Fixed Asset Record ${c.RecordDocNo}` : "No Fixed Asset Record yet",
                  c.Custodian ? `Held by ${c.Custodian}` : "",
                  blocked ? "Selected on another line" : "",
                ].filter(Boolean).join(" · ")}
                className={`px-2 py-1 border text-[0.6875rem] font-heading transition-colors ${
                  on
                    ? "border-foreground/40 bg-card text-foreground font-semibold"
                    : blocked
                      ? "border-foreground/30 bg-card text-muted-foreground/50 cursor-not-allowed"
                      : "border-foreground/30 bg-card text-foreground hover:border-foreground/40"
                }`}
              >
                {on ? "✓ " : ""}{c.FAItemCode}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
