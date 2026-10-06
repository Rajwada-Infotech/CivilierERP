import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-[60] bg-black/90 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

interface DialogContentProps extends React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> {
  /** Pass true to hide the built-in close (×) button — use when the dialog
   *  already renders its own close button in the header to avoid duplicates. */
  hideCloseButton?: boolean;
  /** Module accent. "crm" gives the CRM module's dark + orange dialog look —
   *  the `.crm-dialog` class in src/index.css restyles the surface and every
   *  form field inside. Undefined = the plain neutral dialog every other
   *  module uses. */
  accent?: "crm";
  /** Pass true when this Dialog can be opened from INSIDE another
   *  hand-rolled full-screen overlay that hardcodes a z-index above this
   *  component's default z-[60] (e.g. ActivityDetailModal's z-[70] backdrop,
   *  its z-[80] confirm dialog, its z-[90] photo lightbox). Without this,
   *  the outer overlay paints on top of both this Dialog's own overlay AND
   *  its content, since they tie/lose on z-index — the dialog is still
   *  there and still interactive, it's just invisible under the darker
   *  overlay sitting above it ("blacks out the screen"). z-[95] clears
   *  every known overlay in this app except the toast layer (z-[99]+),
   *  which must stay on top of every dialog. */
  elevated?: boolean;
}

// One close control per dialog: the pinned × in the top-right corner.
// • A dialog that draws its own × button → the built-in × is hidden.
// • A footer button that only says "Close" (duplicating the ×) is hidden;
//   Cancel / Save / Delete etc. are untouched. If that leaves its bar with
//   nothing else in it, the bar is hidden too.
export function dedupeCloseControls(el: HTMLElement, anchor: HTMLElement | null) {
  const builtIn = anchor?.querySelector<HTMLElement>(".dlg-close") ?? null;
  const isXIcon = (b: Element) =>
    !!b.querySelector("svg.lucide-x, svg.lucide-circle-x, svg.lucide-x-circle") &&
    !(b.textContent || "").replace(/close/i, "").trim();
  const buttons = Array.from(el.querySelectorAll<HTMLElement>("button")).filter((b) => !anchor?.contains(b));
  // Only an × in the dialog's top-right corner counts as its own close button
  // (not the little × on tag chips, file rows, search clears, etc.).
  const box = el.getBoundingClientRect();
  const inCorner = (b: Element) => {
    const r = b.getBoundingClientRect();
    return r.width > 0 && r.top - box.top < 96 && box.right - r.right < 140;
  };
  const ownX = buttons.find((b) => isXIcon(b) && inCorner(b));
  if (builtIn) builtIn.toggleAttribute("data-dup-close", !!ownX);
  const hasX = !!ownX || (!!builtIn && !builtIn.hasAttribute("data-dup-close"));
  el.querySelectorAll("[data-dup-close-bar]").forEach((x) => x.removeAttribute("data-dup-close-bar"));
  buttons.forEach((b) => {
    const dup = hasX && /^close$/i.test((b.textContent || "").trim()) && !b.querySelector("svg.lucide-x, svg.lucide-circle-x, svg.lucide-x-circle");
    b.toggleAttribute("data-dup-close", dup);
    if (!dup) return;
    // The footer block this Close lived in (a direct child of the dialog):
    // if nothing clickable is left in it, hide the whole bar — any status
    // text there ("Locked for viewing") already shows at the top.
    let bar: HTMLElement | null = b;
    while (bar && bar.parentElement !== el) bar = bar.parentElement;
    if (!bar) return;
    const others = Array.from(bar.querySelectorAll("button, a, input, select, textarea")).filter((x) => !x.hasAttribute("data-dup-close"));
    if (others.length === 0) bar.setAttribute("data-dup-close-bar", "");
  });
}

// Pinned dialog chrome: when a dialog's content is taller than the screen,
// its header (first block — title, Edit, etc.), its footer (last block, if
// it's a short row of buttons) and the × button stay in place while only the
// middle scrolls. Detected at runtime so every dialog benefits without
// per-call-site changes; styles in index.css (.dlg-sticky).
// `el` is the mounted dialog box (state set by a callback ref), so this runs
// each time the dialog actually opens — DialogContent itself renders while
// closed, when there's no box yet.
function usePinnedChrome(el: HTMLElement | null, anchorRef: React.RefObject<HTMLElement>) {
  React.useLayoutEffect(() => {
    if (!el) return;
    const apply = () => {
      dedupeCloseControls(el, anchorRef.current);
      const cs = getComputedStyle(el);
      el.style.setProperty("--dlg-pt", cs.paddingTop);
      el.style.setProperty("--dlg-pb", cs.paddingBottom);
      el.style.setProperty("--dlg-pl", cs.paddingLeft);
      el.style.setProperty("--dlg-pr", cs.paddingRight);
      if (anchorRef.current) anchorRef.current.style.marginBottom = `-${cs.rowGap === "normal" ? "0px" : cs.rowGap}`;
      const flow = Array.from(el.children).filter(
        (c): c is HTMLElement =>
          c instanceof HTMLElement && c !== anchorRef.current && getComputedStyle(c).position !== "absolute" && getComputedStyle(c).display !== "none",
      );
      flow.forEach((c) => { c.removeAttribute("data-dlg-head"); c.removeAttribute("data-dlg-foot"); });
      // Only pin when the dialog actually scrolls — short dialogs keep their
      // exact original look.
      const scrolls = el.scrollHeight > el.clientHeight + 1;
      if (scrolls && flow.length >= 2) {
        const head = flow[0];
        if (head.offsetHeight < el.clientHeight * 0.35) head.setAttribute("data-dlg-head", "");
        const foot = flow[flow.length - 1];
        if (foot !== head && foot.querySelector("button, a") && foot.offsetHeight <= 96) foot.setAttribute("data-dlg-foot", "");
      }
    };
    apply();
    const mo = new MutationObserver(() => requestAnimationFrame(apply));
    mo.observe(el, { childList: true, subtree: true });
    const ro = new ResizeObserver(() => apply());
    ro.observe(el);
    Array.from(el.children).forEach((c) => ro.observe(c));
    return () => { mo.disconnect(); ro.disconnect(); };
  }, [el, anchorRef]);
}

const ACCENT_CLASS: Record<NonNullable<DialogContentProps["accent"]>, string> = {
  crm: "crm-dialog",
};

// Recursively checks whether a React node tree already contains an element
// of the given type — used below to detect whether the caller supplied its
// own DialogTitle/DialogDescription (commonly nested inside a DialogHeader,
// so a shallow check on direct children isn't enough) before injecting a
// screen-reader-only fallback. Radix requires both to exist for
// aria-labelledby/aria-describedby to resolve; a huge fraction of this
// codebase's ~110 DialogContent call sites only ever supplied a Title (or
// neither), which is what threw the console warnings — this fixes all of
// them from one place instead of hand-editing every call site.
function containsType(node: React.ReactNode, type: unknown, depth = 0): boolean {
  if (depth > 6 || node == null || typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
    return false;
  }
  if (Array.isArray(node)) return node.some((n) => containsType(n, type, depth + 1));
  if (!React.isValidElement(node)) return false;
  if (node.type === type) return true;
  const childChildren = (node.props as { children?: React.ReactNode })?.children;
  return childChildren !== undefined && containsType(childChildren, type, depth + 1);
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, hideCloseButton = false, accent, elevated = false, ...props }, ref) => {
  const [contentEl, setContentEl] = React.useState<HTMLDivElement | null>(null);
  const anchorRef = React.useRef<HTMLDivElement>(null);
  const setRefs = React.useCallback(
    (node: HTMLDivElement | null) => {
      setContentEl(node);
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
    },
    [ref],
  );
  usePinnedChrome(contentEl, anchorRef);
  const hasTitle = containsType(children, DialogTitle);
  const hasDescription = containsType(children, DialogDescription);
  return (
    <DialogPortal>
      <DialogOverlay className={elevated ? "z-[95]" : undefined} />
      <DialogPrimitive.Content
        ref={setRefs}
        className={cn(
          "dlg-sticky",
          "fixed left-[50%] top-[50%] z-[60] grid w-[calc(100%-2rem)] sm:w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-4 sm:p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg max-h-[90dvh] overflow-y-auto overflow-x-hidden thin-scroll",
          elevated && "z-[95]",
          accent && ACCENT_CLASS[accent],
          className,
        )}
        {...props}
      >
        {/* Screen-reader-only fallbacks — never rendered visibly, and never
            duplicated when the caller already provides its own. */}
        {!hasTitle && <DialogTitle className="sr-only">Dialog</DialogTitle>}
        {!hasDescription && <DialogDescription className="sr-only">Dialog content</DialogDescription>}
        {/* Zero-height sticky anchor so the × stays in the top-right corner
            while the content scrolls (see .dlg-close-anchor in index.css). */}
        <div ref={anchorRef} className="dlg-close-anchor" aria-hidden={hideCloseButton || undefined}>
          {!hideCloseButton && (
            <DialogPrimitive.Close className="dlg-close rounded-sm opacity-70 ring-offset-background transition-opacity data-[state=open]:bg-accent data-[state=open]:text-muted-foreground hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          )}
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className,
    )}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className,
    )}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};