import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker, type DropdownProps } from "react-day-picker";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

// captionLayout="dropdown"'s default Dropdown renders a real native <select>
// — its popup option list is the browser's own unstylable native UI (always
// light, regardless of the app's dark theme), which reads as broken sitting
// inside a themed calendar. Swap in the app's own Select (Radix, fully
// themeable) instead, translating its onValueChange back into the plain
// change event react-day-picker's Dropdown props expect.
function ThemedDropdown({ options, value, onChange, disabled }: DropdownProps) {
  const selected = options?.find((o) => String(o.value) === String(value));
  return (
    <Select
      value={value != null ? String(value) : undefined}
      disabled={disabled}
      onValueChange={(val) => {
        onChange?.({
          target: { value: val },
        } as React.ChangeEvent<HTMLSelectElement>);
      }}
    >
      <SelectTrigger className="h-7 w-auto gap-1 border-none bg-transparent px-2 text-sm font-medium hover:bg-accent focus:ring-0 focus:ring-offset-0">
        <SelectValue>{selected?.label}</SelectValue>
      </SelectTrigger>
      {/* The calendar itself usually sits inside a Popover (see DateField)
          whose own content shares this same base z-[70] — without a higher
          z-index here, DOM-mount-order alone decides which one paints on
          top, and it isn't always this one. */}
      <SelectContent className="max-h-64 z-[80]">
        {options?.map((o) => (
          <SelectItem key={o.value} value={String(o.value)} disabled={o.disabled} className="text-xs">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = "dropdown",
  startMonth,
  endMonth,
  ...props
}: CalendarProps) {
  // captionLayout="dropdown" is documented to auto-default startMonth/endMonth
  // (100 years back / end of this year) when they're omitted — but that
  // default lives inside react-day-picker's own prop-merging and, at least
  // as observed here, wasn't actually populating the Month/Year options
  // (rendered as an empty dropdown). Set them explicitly instead of relying
  // on that internal resolution, so ThemedDropdown's `options` is always a
  // real array. +15 years covers any real due-date/forward-dated field.
  const today = new Date();
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      captionLayout={captionLayout}
      startMonth={startMonth ?? new Date(today.getFullYear() - 100, 0, 1)}
      endMonth={endMonth ?? new Date(today.getFullYear() + 15, 11, 31)}
      className={cn("p-3", className)}
      classNames={{
        // ── Layout ────────────────────────────────────────────────────────────
        months: "flex flex-col sm:flex-row gap-4",
        month: "flex flex-col gap-4",
        month_caption: "flex justify-center pt-1 relative items-center",
        caption_label: "text-sm font-medium",
        // Wraps the Month + Year ThemedDropdown pair (captionLayout="dropdown")
        // — picking either is one click/tap instead of swiping the prev/next
        // arrows one step at a time.
        dropdowns: "flex items-center gap-1",

        // ── Navigation ────────────────────────────────────────────────────────
        nav: "flex items-center gap-1",
        button_previous: cn(
          buttonVariants({ variant: "outline" }),
          "absolute left-1 h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100",
        ),
        button_next: cn(
          buttonVariants({ variant: "outline" }),
          "absolute right-1 h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100",
        ),

        // ── Grid ──────────────────────────────────────────────────────────────
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday:
          "text-muted-foreground w-9 font-normal text-[0.8rem] text-center flex-1",
        week: "flex w-full mt-2",

        // ── Day cells ─────────────────────────────────────────────────────────
        day: cn(
          "relative h-9 w-9 flex-1 text-center text-sm p-0",
          // range highlight on the cell wrapper
          "[&:has([aria-selected].day-range-end)]:rounded-r-md",
          "[&:has([aria-selected].day-outside)]:bg-accent/50",
          "[&:has([aria-selected])]:bg-accent",
          "first:[&:has([aria-selected])]:rounded-l-md",
          "last:[&:has([aria-selected])]:rounded-r-md",
          "focus-within:relative focus-within:z-20",
        ),
        day_button: cn(
          buttonVariants({ variant: "ghost" }),
          "h-9 w-full p-0 font-normal aria-selected:opacity-100",
        ),

        // ── Day states ────────────────────────────────────────────────────────
        selected:
          "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground rounded-md",
        // Outline only — avoids visually merging with the "selected" fill,
        // since --accent and --primary share the same hue in this theme.
        today:
          "rounded-md ring-1 ring-inset ring-primary/50 aria-selected:ring-0",
        outside:
          "day-outside text-muted-foreground opacity-50 aria-selected:bg-accent/50 aria-selected:text-muted-foreground aria-selected:opacity-30",
        disabled: "text-muted-foreground opacity-50",
        range_start: "day-range-start",
        range_end: "day-range-end",
        range_middle:
          "aria-selected:bg-accent aria-selected:text-accent-foreground",
        hidden: "invisible",

        // allow callers to inject extra classes
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === "left" ? (
            <ChevronLeft className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          ),
        // Themed Month/Year <select> replacements — see ThemedDropdown above.
        Dropdown: ThemedDropdown,
      }}
      {...props}
    />
  );
}

Calendar.displayName = "Calendar";

export { Calendar };
