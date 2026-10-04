import * as React from "react";
import { format, isValid, parse } from "date-fns";
import { CalendarIcon, ChevronLeft, ChevronRight, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Drop-in replacement for <input type="date">. Keeps the native contract so
// existing handlers work unchanged: `value` is a "yyyy-MM-dd" string ("" when
// empty) and onChange receives an event-like object whose target.value is
// the same "yyyy-MM-dd" string. With withTime (see DateTimeInput) it mirrors
// <input type="datetime-local"> instead: "yyyy-MM-ddTHH:mm".
const ISO = "yyyy-MM-dd";
const ISO_DT = "yyyy-MM-dd'T'HH:mm";

function toDateTime(v: unknown): Date | undefined {
  if (!v || typeof v !== "string") return undefined;
  const d = parse(v.slice(0, 16), ISO_DT, new Date());
  return isValid(d) ? d : toDate(v);
}

const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

function toDate(v: unknown): Date | undefined {
  if (!v || typeof v !== "string") return undefined;
  const d = parse(v.slice(0, 10), ISO, new Date());
  return isValid(d) ? d : undefined;
}

export type DateInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "defaultValue"
> & {
  value?: string | null;
  defaultValue?: string | null;
  displayFormat?: string;
  clearable?: boolean;
  withTime?: boolean;
};

export const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(
  (
    {
      value,
      defaultValue,
      onChange,
      min,
      max,
      disabled,
      readOnly,
      className,
      withTime = false,
      placeholder = withTime ? "dd/mm/yyyy, --:-- --" : "dd/mm/yyyy",
      displayFormat = withTime ? "dd/MM/yyyy, hh:mm a" : "dd/MM/yyyy",
      clearable = true,
      name,
      id,
      required,
      style,
      onBlur,
      onFocus,
      onKeyDown,
      title,
      autoFocus,
      ...rest
    },
    ref,
  ) => {
    const [open, setOpen] = React.useState(false);
    const controlled = value !== undefined;
    const [inner, setInner] = React.useState<string>(defaultValue ?? "");
    const current = controlled ? (value ?? "") : inner;
    const selected = withTime ? toDateTime(current) : toDate(current);
    const minDate = toDate(min as string);
    const maxDate = toDate(max as string);
    const fmt = withTime ? ISO_DT : ISO;
    const hiddenRef = React.useRef<HTMLInputElement>(null);
    React.useImperativeHandle(ref, () => hiddenRef.current as HTMLInputElement);

    const emit = (next: string) => {
      if (!controlled) setInner(next);
      const el = hiddenRef.current;
      if (el) el.value = next;
      const target = (el ?? { name, value: next }) as HTMLInputElement;
      onChange?.({
        target,
        currentTarget: target,
        type: "change",
        preventDefault: () => {},
        stopPropagation: () => {},
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    };

    const locked = disabled || readOnly;

    // Time parts (12-hour clock) for the datetime mode.
    const h24 = selected?.getHours() ?? 0;
    const hour12 = String(h24 % 12 === 0 ? 12 : h24 % 12);
    const minute = String(selected?.getMinutes() ?? 0).padStart(2, "0");
    const ampm = h24 >= 12 ? "PM" : "AM";
    const setTime = (h: string, m: string, ap: string) => {
      const base = selected ?? new Date();
      const d = new Date(base);
      d.setHours((Number(h) % 12) + (ap === "PM" ? 12 : 0), Number(m), 0, 0);
      emit(format(d, fmt));
    };

    return (
      <Popover open={open && !locked} onOpenChange={(o) => !locked && setOpen(o)}>
        <PopoverTrigger asChild>
          <button
            type="button"
            id={id}
            title={title}
            autoFocus={autoFocus}
            disabled={disabled}
            aria-readonly={readOnly || undefined}
            onBlur={onBlur as unknown as React.FocusEventHandler<HTMLButtonElement>}
            onFocus={onFocus as unknown as React.FocusEventHandler<HTMLButtonElement>}
            onKeyDown={onKeyDown as unknown as React.KeyboardEventHandler<HTMLButtonElement>}
            style={style}
            className={cn(
              "flex h-9 w-full items-center gap-2 rounded-md border border-input bg-background px-3 py-1 text-left text-sm shadow-sm",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
              className,
            )}
          >
            <span className={cn("flex-1 truncate", !selected && "text-muted-foreground")}>
              {selected ? format(selected, displayFormat) : placeholder}
            </span>
            {clearable && selected && !locked && !required ? (
              <X
                className="h-3.5 w-3.5 shrink-0 opacity-50 hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  emit("");
                }}
              />
            ) : (
              <CalendarIcon className="h-4 w-4 shrink-0 opacity-50" />
            )}
          </button>
        </PopoverTrigger>
        <input
          ref={hiddenRef}
          type="hidden"
          name={name}
          value={current}
          readOnly
          {...(rest as React.InputHTMLAttributes<HTMLInputElement>)}
        />
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected ?? maxDate ?? undefined}
            captionLayout="dropdown"
            startMonth={minDate ?? new Date(1950, 0)}
            endMonth={maxDate ?? new Date(new Date().getFullYear() + 20, 11)}
            disabled={[
              ...(minDate ? [{ before: minDate }] : []),
              ...(maxDate ? [{ after: maxDate }] : []),
            ]}
            onSelect={(d) => {
              if (d) {
                if (withTime) {
                  // Keep the chosen time (or "now" for a fresh value).
                  const t = selected ?? new Date();
                  d.setHours(t.getHours(), t.getMinutes(), 0, 0);
                }
                emit(format(d, fmt));
              }
              if (!withTime) setOpen(false);
            }}
            autoFocus
          />
          {withTime && (
            <div className="flex items-center gap-2 border-t border-border p-3">
              <span className="text-xs text-muted-foreground mr-auto">Time</span>
              <Select value={hour12} onValueChange={(v) => setTime(v, minute, ampm)}>
                <SelectTrigger className="h-8 w-[64px]"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-60">
                  {HOURS.map((h) => <SelectItem key={h} value={h}>{h.padStart(2, "0")}</SelectItem>)}
                </SelectContent>
              </Select>
              <span className="text-muted-foreground">:</span>
              <Select value={minute} onValueChange={(v) => setTime(hour12, v, ampm)}>
                <SelectTrigger className="h-8 w-[64px]"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-60">
                  {MINUTES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={ampm} onValueChange={(v) => setTime(hour12, minute, v)}>
                <SelectTrigger className="h-8 w-[68px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="AM">AM</SelectItem>
                  <SelectItem value="PM">PM</SelectItem>
                </SelectContent>
              </Select>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="ml-1 h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                Done
              </button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    );
  },
);
DateInput.displayName = "DateInput";

/** Drop-in replacement for <input type="datetime-local">. */
export const DateTimeInput = React.forwardRef<HTMLInputElement, DateInputProps>(
  (props, ref) => <DateInput ref={ref} {...props} withTime />,
);
DateTimeInput.displayName = "DateTimeInput";

// Drop-in replacement for <input type="month">: value / target.value is a
// "yyyy-MM" string ("" when empty). Honours "yyyy-MM" min / max.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const MonthInput = React.forwardRef<HTMLInputElement, DateInputProps>(
  (
    {
      value,
      defaultValue,
      onChange,
      min,
      max,
      disabled,
      readOnly,
      className,
      placeholder = "mm/yyyy",
      displayFormat = "MMM yyyy",
      clearable = true,
      name,
      id,
      required,
      style,
      onBlur,
      onFocus,
      onKeyDown,
      title,
      autoFocus,
      withTime: _withTime,
      ...rest
    },
    ref,
  ) => {
    const [open, setOpen] = React.useState(false);
    const controlled = value !== undefined;
    const [inner, setInner] = React.useState<string>(defaultValue ?? "");
    const current = controlled ? (value ?? "") : inner;
    const parseYm = (v: unknown) => {
      if (!v || typeof v !== "string") return undefined;
      const d = parse(v.slice(0, 7), "yyyy-MM", new Date());
      return isValid(d) ? d : undefined;
    };
    const selected = parseYm(current);
    const minYm = typeof min === "string" ? min.slice(0, 7) : "";
    const maxYm = typeof max === "string" ? max.slice(0, 7) : "";
    const [viewYear, setViewYear] = React.useState(
      () => (selected ?? new Date()).getFullYear(),
    );
    React.useEffect(() => {
      if (open) setViewYear((selected ?? new Date()).getFullYear());
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);
    const hiddenRef = React.useRef<HTMLInputElement>(null);
    React.useImperativeHandle(ref, () => hiddenRef.current as HTMLInputElement);

    const emit = (next: string) => {
      if (!controlled) setInner(next);
      const el = hiddenRef.current;
      if (el) el.value = next;
      const target = (el ?? { name, value: next }) as HTMLInputElement;
      onChange?.({
        target,
        currentTarget: target,
        type: "change",
        preventDefault: () => {},
        stopPropagation: () => {},
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    };

    const locked = disabled || readOnly;
    const ym = (y: number, m: number) => `${y}-${String(m + 1).padStart(2, "0")}`;
    const outOfRange = (v: string) => (!!minYm && v < minYm) || (!!maxYm && v > maxYm);

    return (
      <Popover open={open && !locked} onOpenChange={(o) => !locked && setOpen(o)}>
        <PopoverTrigger asChild>
          <button
            type="button"
            id={id}
            title={title}
            autoFocus={autoFocus}
            disabled={disabled}
            aria-readonly={readOnly || undefined}
            onBlur={onBlur as unknown as React.FocusEventHandler<HTMLButtonElement>}
            onFocus={onFocus as unknown as React.FocusEventHandler<HTMLButtonElement>}
            onKeyDown={onKeyDown as unknown as React.KeyboardEventHandler<HTMLButtonElement>}
            style={style}
            className={cn(
              "flex h-9 w-full items-center gap-2 rounded-md border border-input bg-background px-3 py-1 text-left text-sm shadow-sm",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
              className,
            )}
          >
            <span className={cn("flex-1 truncate", !selected && "text-muted-foreground")}>
              {selected ? format(selected, displayFormat) : placeholder}
            </span>
            {clearable && selected && !locked && !required ? (
              <X
                className="h-3.5 w-3.5 shrink-0 opacity-50 hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  emit("");
                }}
              />
            ) : (
              <CalendarIcon className="h-4 w-4 shrink-0 opacity-50" />
            )}
          </button>
        </PopoverTrigger>
        <input
          ref={hiddenRef}
          type="hidden"
          name={name}
          value={current}
          readOnly
          {...(rest as React.InputHTMLAttributes<HTMLInputElement>)}
        />
        <PopoverContent className="w-64 p-3" align="start">
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setViewYear((y) => y - 1)}
              disabled={!!minYm && ym(viewYear - 1, 11) < minYm}
              className="rounded-md p-1.5 hover:bg-accent disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-medium">{viewYear}</span>
            <button
              type="button"
              onClick={() => setViewYear((y) => y + 1)}
              disabled={!!maxYm && ym(viewYear + 1, 0) > maxYm}
              className="rounded-md p-1.5 hover:bg-accent disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {MONTHS.map((label, m) => {
              const v = ym(viewYear, m);
              const isSel = current.slice(0, 7) === v;
              return (
                <button
                  key={label}
                  type="button"
                  disabled={outOfRange(v)}
                  onClick={() => {
                    emit(v);
                    setOpen(false);
                  }}
                  className={cn(
                    "h-9 rounded-md text-sm transition-colors disabled:pointer-events-none disabled:opacity-30",
                    isSel
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    );
  },
);
MonthInput.displayName = "MonthInput";

// For inputs whose type is decided at runtime (e.g. type={field.type}):
// renders the shadcn DateInput when type is "date", a plain <input> otherwise.
export const AutoInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ type, ...props }, ref) =>
  type === "date" ? (
    <DateInput ref={ref} {...(props as DateInputProps)} />
  ) : type === "datetime-local" ? (
    <DateTimeInput ref={ref} {...(props as DateInputProps)} />
  ) : type === "month" ? (
    <MonthInput ref={ref} {...(props as DateInputProps)} />
  ) : (
    <input ref={ref} type={type} {...props} />
  ),
);
AutoInput.displayName = "AutoInput";
