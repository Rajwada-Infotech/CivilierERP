// Picking the people who approve at a level.
import React, { useState, useCallback, useRef, useEffect } from "react";
import { type User } from "@/api/userApi";
import { X, Check, Search } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── UserMultiSelect ──────────────────────────────────────────────────────────

export function UserMultiSelect({
  value,
  onChange,
  users,
  placeholder = "Click to choose people…",
}: {
  value: number[];
  onChange: (ids: number[]) => void;
  users: User[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const updatePosition = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const DROPDOWN_HEIGHT = 320;
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const spaceAbove = rect.top - 8;
      const openUpward =
        spaceBelow < DROPDOWN_HEIGHT && spaceAbove > spaceBelow;

      if (openUpward) {
        setDropdownStyle({
          position: "fixed",
          bottom: window.innerHeight - rect.top + 4,
          left: rect.left,
          width: rect.width,
          zIndex: 9999,
          maxHeight: `${Math.min(DROPDOWN_HEIGHT, spaceAbove)}px`,
        });
      } else {
        setDropdownStyle({
          position: "fixed",
          top: rect.bottom + 4,
          left: rect.left,
          width: rect.width,
          zIndex: 9999,
          maxHeight: `${Math.min(DROPDOWN_HEIGHT, spaceBelow)}px`,
        });
      }
    }
  }, []);

  useEffect(() => {
    if (open) {
      updatePosition();
      setSearch("");
      // Autofocus the search box the moment the dropdown opens — the whole
      // point of adding search is to let someone start typing immediately
      // instead of scrolling a long user list by hand.
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open, updatePosition]);

  function toggle(id: number) {
    onChange(
      value.includes(id) ? value.filter((x) => x !== id) : [...value, id],
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

  const selectedUsers = users.filter((u) => value.includes(u.id));
  const q = search.trim().toLowerCase();
  const filteredUsers = q
    ? users.filter(
        (u) =>
          u.name.toLowerCase().includes(q) ||
          u.role?.toLowerCase().includes(q),
      )
    : users;

  return (
    <div ref={ref} className="relative">
      <div
        ref={triggerRef}
        className={cn(
          "min-h-10 flex flex-wrap gap-1.5 items-center px-3 py-2 border cursor-pointer transition-all",
          " border-foreground/25 hover:border-foreground",
          open && "border-foreground",
        )}
        onClick={() => setOpen((o) => !o)}
      >
        {selectedUsers.length === 0 ? (
          <span className="text-sm text-muted-foreground">{placeholder}</span>
        ) : (
          selectedUsers.map((u) => (
            <span
              key={u.id}
              className="inline-flex items-center gap-1.5 pl-1 pr-2 py-0.5 text-xs font-medium text-foreground border border-foreground/40"
            >
              <span className="w-5 h-5 flex items-center justify-center text-[0.5625rem] font-bold">
                {initials(u.name)}
              </span>
              {u.name.split(" ")[0]}
              <button
                className="ml-0.5 opacity-60 hover:opacity-100 hover: p-0.5"
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(u.id);
                }}
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))
        )}
        <span className="ml-auto text-muted-foreground/50 text-xs pl-1">
          {open ? "▲" : "▼"}
        </span>
      </div>

      {open && (
        <div
          style={dropdownStyle}
          className="border border-foreground/25 bg-popover overflow-hidden"
        >
          <div className="px-3 py-2 border-b border-foreground space-y-2">
            <p className="text-xs text-muted-foreground font-medium">
              {selectedUsers.length === 0
                ? "Select who can approve at this level"
                : `${selectedUsers.length} person${selectedUsers.length > 1 ? "s" : ""} selected — click to add/remove`}
            </p>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                placeholder="Search by name or role…"
                className="w-full h-8 pl-8 pr-2 border border-foreground/25 bg-background text-xs focus:outline-none focus:border-foreground"
              />
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {users.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                No users available
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                No users match "{search}"
              </div>
            ) : (
              filteredUsers.map((u) => {
                const sel = value.includes(u.id);
                return (
                  <div
                    key={u.id}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 cursor-pointer text-sm transition-colors",
                      " hover:bg-primary/5",
                      sel && "",
                    )}
                    onClick={() => toggle(u.id)}
                  >
                    <span
                      className="w-7 h-7 flex items-center justify-center text-[0.625rem] font-bold flex-shrink-0"
                      style={{
                        background: `hsl(${(u.id * 47) % 360} 60% 40% / 0.2)`,
                        color: `hsl(${(u.id * 47) % 360} 60% 55%)`,
                      }}
                    >
                      {initials(u.name)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-foreground truncate">
                        {u.name}
                      </div>
                      <div className="text-[0.6875rem] text-muted-foreground">
                        {u.role}
                      </div>
                    </div>
                    <div
                      className={cn(
                        "w-5 h-5 border-2 flex items-center justify-center flex-shrink-0 transition-all",
                        sel ? "border-foreground bg-foreground" : "border-foreground/25",
                      )}
                    >
                      {sel && <Check className="w-3 h-3 text-card" />}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
