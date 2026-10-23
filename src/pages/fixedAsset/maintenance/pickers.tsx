// The two searchable pickers of the form: the item, then one of that item's FA Item Codes.
import { useState } from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import type { FAMaintAsset } from "@/api/fixedAssetMaintenanceApi";
import { INP } from "../record/config";

const TRIGGER = `${INP} flex items-center justify-between gap-2 text-left`;
const ITEM = "rounded-none data-[selected=true]:bg-primary/10 data-[selected=true]:text-foreground";

/** Item Selection: the distinct item names among the valid fixed assets of the company and project. */
export function ItemPicker({
  items, value, onSelect, disabled, loading,
}: { items: string[]; value: string; onSelect: (name: string) => void; disabled?: boolean; loading?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" role="combobox" aria-expanded={open} disabled={disabled} className={TRIGGER}>
          <span className={`truncate ${value ? "" : "text-muted-foreground"}`}>{value || "Select item…"}</span>
          <ChevronsUpDown size={14} className="shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0 rounded-none" align="start">
        <Command>
          <CommandInput placeholder="Search item…" />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center py-6 gap-2 text-muted-foreground text-xs">
                <Loader2 size={13} className="animate-spin" /> Loading…
              </div>
            ) : (
              <>
                <CommandEmpty>No valid fixed assets found.</CommandEmpty>
                <CommandGroup>
                  {items.map((it) => (
                    <CommandItem key={it} value={it} onSelect={() => { onSelect(it); setOpen(false); }} className={ITEM}>
                      <Check className={`mr-2 h-4 w-4 ${it === value ? "opacity-100" : "opacity-0"}`} />
                      <span className="text-xs truncate">{it}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** FA Item Code: the codes that belong to the chosen item in this company and project. */
export function CodePicker({
  assets, value, onSelect, disabled,
}: { assets: FAMaintAsset[]; value: string; onSelect: (a: FAMaintAsset) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const selected = assets.find((a) => String(a.AssetId) === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" role="combobox" aria-expanded={open} disabled={disabled} className={TRIGGER}>
          <span className="truncate">
            {selected ? <span className="font-heading tabular-nums">{selected.FAItemCode}</span> : <span className="text-muted-foreground">Select FA Item Code…</span>}
          </span>
          <ChevronsUpDown size={14} className="shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0 rounded-none" align="start">
        <Command>
          <CommandInput placeholder="Search FA Item Code…" />
          <CommandList>
            <CommandEmpty>No FA Item Code found for this item.</CommandEmpty>
            <CommandGroup>
              {assets.map((a) => (
                <CommandItem key={a.AssetId} value={`${a.FAItemCode} ${a.AssetName}`} onSelect={() => { onSelect(a); setOpen(false); }} className={ITEM}>
                  <Check className={`mr-2 h-4 w-4 ${String(a.AssetId) === value ? "opacity-100" : "opacity-0"}`} />
                  <span className="flex flex-col min-w-0">
                    <span className="font-heading tabular-nums text-xs font-semibold truncate">{a.FAItemCode}</span>
                    <span className="text-xs truncate">{a.AssetName}{a.AssetCategory ? ` (${a.AssetCategory})` : ""}</span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
