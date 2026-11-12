# CivilierERP design guide — the drawing sheet

Every web page is moving onto one look: **the drawing sheet** — ink on paper, ruled boxes, square corners. Modules
already on it: Finance, Material (PO, GRN …), Legal, Follow-Up, Fixed Asset, Admin, HR & Payroll, CRM dashboards.
Follow this guide for any new page and when "wrapping" (restyling) an old one.

## 1. Colours

Only the sheet's four colours, always through theme tokens (they switch for dark mode by themselves — never add
`dark:` colour variants):

| Use | Token | Tailwind |
|---|---|---|
| Ink — text, rules, main buttons, totals | `hsl(var(--foreground))` | `text-foreground`, `border-foreground`, `bg-foreground` |
| Blue — done / good / the selected thing | `hsl(var(--primary))` | `text-primary`, `bg-primary/10` |
| Red — stopped / needs attention / errors | `hsl(var(--destructive))` | `text-destructive`, `bg-destructive/10` |
| Graphite — secondary text, inactive | `hsl(var(--muted-foreground))` | `text-muted-foreground` |

- No module colour inside a page. A module's colour (orchid for HR, walnut for Legal …) appears only as its mark in the
  sidebar and top bar.
- No raw palette classes (`emerald-500`, `amber-100`, `slate-600` …) and no hex colours in page code.
- Tints are washes behind text: `bg-primary/10`, `bg-destructive/10`, `bg-foreground/5`. Never a solid fill under the
  same-coloured text.
- Text on an ink fill is `text-card` (not `text-white` — ink is light in dark mode).
- No gradients, shadows, blur or glass.

## 2. Shape and type

- Square corners everywhere (`rounded-none`). The only round things are loading spinners.
- Rules: the outer box is a 1px ink line (`border: 1px solid hsl(var(--foreground))`); dividers inside it are lighter
  (`border-foreground/15`–`/20`).
- Labels and section heads: small capitals in the heading face —
  `font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground` (label),
  `font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground` (head).
- Every figure (amounts, counts, dates in tables) in the heading face with tabular numbers: `font-heading tabular-nums`.
- No emojis or decorative symbols (✓ ★ 👋) in pages, toasts or labels. Icons only where they carry meaning (a button's
  action), never as decoration tiles.

## 3. Buttons — sizes (taken from the PO and GRN pages)

Use the shared keys, not hand-written button classes:

```ts
import { KEY_INK, KEY_LINE, KEY_RED, KEY_RED_SOLID } from "@/components/sheet/sheetParts";
```

- `KEY_INK` — the main action (filled ink). `KEY_LINE` — every other action (ink outline). `KEY_RED` / `KEY_RED_SOLID` —
  delete and other destructive actions.
- The keys carry the type (0.625rem semibold capitals, 0.1em tracking), square corners and the disabled look.
  **Add the size where the button is used:**

| Where | Size | Example |
|---|---|---|
| Page actions (top-right of a list, a form's Save / Reset bar) | **`h-9`** — main action `px-4`, others `px-3`; a form's Save `px-5`, Reset `px-4` | GRN: Template / Import CSV `KEY_LINE h-9 px-3`, New GRN `KEY_INK h-9 px-4`; PO save bar Reset `KEY_LINE h-9 px-4`, Save `KEY_INK h-9 px-5` |
| Inside a header bar or a table row | **`h-8 px-3`** | PO form header: Back / Print `KEY_LINE h-8 px-3`, Edit `KEY_INK h-8 px-3` |
| Dialog footer | **`h-9`** — Cancel / secondary `px-4`, confirm / main `px-5` | PO amend dialog: `KEY_LINE h-9 px-4` + `KEY_INK h-9 px-5` |
| Icon-only row actions (edit, delete, view) | **`w-7 h-7`** square, outline on hover | MasterPage row actions |

- Icons in a key: 12–13px (`size={12}` in an `h-8` key, `size={13}` in an `h-9` key), before the label.
- On phones a footer's keys may stretch: add `flex-1 sm:flex-none`.

## 4. Page structure

- **Working pages** (lists, forms) sit in the module's shell, which is a `SheetShell` — `eyebrow="CivilierERP · <Module>"`,
  a title, a one-line subtitle, the page's own actions on the right. HR: `HrPayrollShell`; Legal: `LegalShell`;
  Follow-Up: `FollowupShell`; others use `SheetShell` from `@/components/sheet/Sheet` directly.
- `MasterPage`, `ExportMenu` and the shared pickers draw themselves in the sheet style on their own when they are
  inside a sheet (`useInSheet`) — no extra work for simple masters. A shared component used on both kinds of page
  should do the same: `const sheet = useInSheet(ref)` and pick the sheet classes when it is true.
- A worded `status` column in `MasterPage` (Pending / Approved / Paid / Present …) shows its own word as a `SheetMark`;
  only an on/off value reads Active / Inactive.
- **Dashboards** follow the Fixed Asset / HR dashboards: a title block (date, read at, Re-read), then lettered sections
  (`<Detail tag="A" title="Right now">` …): A figures (each opens its page; red when something is missing), B needs
  attention (only the lines that apply), then breakdowns and lists, and a last "Go to" section with every page of
  the module. Read from data the module's pages already load where possible.
- **Status** on a sheet is a `SheetMark` (a small square + a word in capitals): solid = settled, hatched = waiting,
  half = under way, red = stopped, empty = draft. Use `statusTone()` for the usual words.
- **Stat rows**: `SheetStats` (or the module's equivalent, e.g. `HrStatStrip`) — ruled cells, label above, figure below.
- **Tabs** as ruled cells in one box, the active one with an ink underline and a faint blue wash.

## 5. Names

- Menu and page names are what people call the thing, short, Title Case in menus: "Employees", "Salary Structures",
  "Team Attendance" — not "Employee Master", "HR Attendance Management".
- Setup records (the people / structures / masters a module runs on) go in the module's **Setup** menu; day-to-day work
  stays in the sidebar.
- The page title, its breadcrumb and its menu entry use the same name.

## 6. Wrapping an old page — checklist

1. Put it in the module's sheet shell.
2. Every tab, dialog, drawer and embedded shared component on the page — not just the first screen.
3. Grep the page for leftovers and clear them all: `rounded-(lg|xl|2xl|full)`, `shadow`, `backdrop-blur`,
   `bg-gradient`, `gradient-accent`, `btn-module`, raw palette colours (`emerald-`, `amber-`, `slate-` …), hex colours,
   `text-white` on ink, `${ACCENT}xx`-style colour strings, emojis.
4. Buttons to the sizes in §3 using the shared keys.
5. Figures in `font-heading tabular-nums`.
6. Check module-scoped CSS in `src/index.css` (`[data-module="…"] main …`) — remove anything that re-tints or rounds the
   page.
7. `npx tsc --noEmit -p tsconfig.json` — 0 errors.
