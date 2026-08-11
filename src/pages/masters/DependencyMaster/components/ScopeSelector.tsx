import { Building, Layers, CalendarDays, DoorOpen, BedDouble } from "lucide-react";
import type { useScopeCascade } from "../hooks/useScopeCascade";

interface Props {
  cascade: ReturnType<typeof useScopeCascade>;
  disabled?: boolean;
}

function Field({
  label,
  icon: Icon,
  value,
  onChange,
  options,
  disabled,
  loading,
  placeholder,
}: {
  label: string;
  icon: React.ElementType;
  value: string;
  onChange: (v: string) => void;
  options: { id: string | number; label: string }[];
  disabled: boolean;
  loading: boolean;
  placeholder: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 flex-1 min-w-[130px]">
      <span className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60 flex items-center gap-1">
        <Icon size={9} /> {label}
      </span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={`h-9 px-2.5 rounded-lg text-xs border focus:outline-none focus:ring-2 focus:ring-primary/30 appearance-none ${
          disabled
            ? "border-border bg-muted/40 text-muted-foreground cursor-not-allowed opacity-60"
            : "border-border bg-background text-foreground"
        }`}
      >
        <option value="">{loading ? "Loading…" : disabled ? "—" : placeholder}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// Step 1 — Task Scope Selection. One compact row, cascading, single
// selection per level; each level stays disabled until its parent is set.
export function ScopeSelector({ cascade, disabled }: Props) {
  const { selection, setProject, setTower, setFloor, setFlat, setRoom, options, loading } = cascade;

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field
        label="Project"
        icon={Building}
        value={selection.projectId ? String(selection.projectId) : ""}
        onChange={(v) => setProject(v ? Number(v) : null)}
        options={options.projects}
        disabled={!!disabled}
        loading={loading.projects}
        placeholder="Select Project…"
      />
      <Field
        label="Tower"
        icon={Layers}
        value={selection.towerId ? String(selection.towerId) : ""}
        onChange={(v) => setTower(v ? Number(v) : null)}
        options={options.towers}
        disabled={!!disabled || !selection.projectId}
        loading={loading.towers}
        placeholder="Select Tower…"
      />
      <Field
        label="Floor"
        icon={CalendarDays}
        value={selection.floor ?? ""}
        onChange={(v) => setFloor(v || null)}
        options={options.floors.map((f) => ({ id: f, label: f }))}
        disabled={!!disabled || !selection.towerId}
        loading={loading.floors}
        placeholder="Select Floor…"
      />
      <Field
        label="Flat"
        icon={DoorOpen}
        value={selection.flatId ? String(selection.flatId) : ""}
        onChange={(v) => setFlat(v ? Number(v) : null)}
        options={options.flats}
        disabled={!!disabled || !selection.floor}
        loading={loading.flats}
        placeholder="Select Flat…"
      />
      <Field
        label="Room"
        icon={BedDouble}
        value={selection.roomId ? String(selection.roomId) : ""}
        onChange={(v) => setRoom(v ? Number(v) : null)}
        options={options.rooms}
        disabled={!!disabled || !selection.flatId}
        loading={loading.rooms}
        placeholder="Select Room…"
      />
    </div>
  );
}
