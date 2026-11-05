// The searchable pickers the Assignment form uses: a person (assigned or responsible) and an unassigned FA Item Code.
import React, { useState } from "react";
import { ChevronsUpDown, Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import type { TransferUser } from "@/api/assetTransferApi";
import type { AssignableAsset } from "@/api/fixedAssetAssignmentApi";
import { INP } from "../record/config";

const initials = (name: string) => name.split(" ").map((n) => n[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

/** A person's photo, or their initials in a ruled square. */
export function UserMark({ name, avatarUrl, size = 24 }: { name: string; avatarUrl?: string | null; size?: number }) {
  if (avatarUrl) return <img src={avatarUrl} alt="" width={size} height={size} className="object-cover shrink-0" style={{ width: size, height: size, border: "1px solid hsl(var(--foreground))" }} />;
  return (
    <span className="inline-flex items-center justify-center font-heading font-bold shrink-0 bg-card text-foreground"
      style={{ width: size, height: size, fontSize: size * 0.38, border: "1px solid hsl(var(--foreground))" }}>
      {initials(name) || "?"}
    </span>
  );
}

const Trigger = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(({ children, ...p }, ref) => (
  <button ref={ref} type="button" role="combobox" {...p} className={`${INP} flex items-center justify-between gap-2 text-left`}>
    <span className="flex items-center gap-2 min-w-0">{children}</span>
    <ChevronsUpDown size={14} className="shrink-0 opacity-50" />
  </button>
));
Trigger.displayName = "Trigger";

export function UserPicker({ users, value, onChange, placeholder, disabled }: { users: TransferUser[]; value: string; onChange: (id: string) => void; placeholder: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const picked = users.find((u) => String(u.id) === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <Trigger aria-expanded={open} disabled={disabled}>
          {picked ? <><UserMark name={picked.name} avatarUrl={picked.avatar_url} size={20} /><span className="truncate">{picked.name}</span></> : <span className="text-muted-foreground truncate">{placeholder}</span>}
        </Trigger>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0 rounded-none" align="start">
        <Command>
          <CommandInput placeholder={placeholder} />
          <CommandList>
            <CommandEmpty>No one by that name.</CommandEmpty>
            <CommandGroup>
              {users.map((u) => (
                <CommandItem key={u.id} value={`${u.name} ${u.id}`} onSelect={() => { onChange(String(u.id)); setOpen(false); }}
                  className="rounded-none gap-2 data-[selected=true]:bg-primary/10 data-[selected=true]:text-foreground">
                  <UserMark name={u.name} avatarUrl={u.avatar_url} size={20} />
                  <span className={`truncate ${String(u.id) === value ? "font-semibold" : ""}`}>{u.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function AssetPicker({ assets, value, onSelect, loading }: { assets: AssignableAsset[]; value: string; onSelect: (a: AssignableAsset) => void; loading?: boolean }) {
  const [open, setOpen] = useState(false);
  const picked = assets.find((a) => String(a.AssetId) === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Trigger aria-expanded={open}>
          {picked ? (
            <span className="truncate"><span className="font-heading tabular-nums">{picked.FAItemCode}</span> · {picked.AssetName}</span>
          ) : <span className="text-muted-foreground">Search FA Item Code…</span>}
        </Trigger>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0 rounded-none" align="start">
        <Command>
          <CommandInput placeholder="Search FA Item Code or asset…" />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center py-6 gap-2 text-muted-foreground text-xs"><Loader2 size={13} className="animate-spin" /> Loading…</div>
            ) : (
              <>
                <CommandEmpty>No unassigned FA Item Code here.</CommandEmpty>
                <CommandGroup>
                  {assets.map((a) => (
                    <CommandItem key={a.AssetId} value={`${a.FAItemCode} ${a.AssetName}`} onSelect={() => { onSelect(a); setOpen(false); }}
                      className="rounded-none data-[selected=true]:bg-primary/10 data-[selected=true]:text-foreground">
                      <span className="flex flex-col min-w-0">
                        <span className="font-heading tabular-nums text-xs font-semibold truncate">{a.FAItemCode}</span>
                        <span className="text-xs truncate">{a.AssetName}{a.AssetCategory ? ` (${a.AssetCategory})` : ""}</span>
                        <span className="text-[0.6875rem] text-muted-foreground truncate">{[a.ProjectName, a.CompanyName].filter(Boolean).join(" · ")}</span>
                      </span>
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
