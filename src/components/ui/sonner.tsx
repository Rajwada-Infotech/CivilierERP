import type React from "react";
import { useEffect, useState } from "react";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

// Toasts drawn like the rest of the sheet: a square card with an ink border and a hard offset shadow, the kind of
// message written in Sora capitals above it, and a square status mark - solid when done, red when it failed, hatched
// while something is still pending. Colours come from the theme's variables, so every theme (light, dark, BW...) is
// matched without the toaster needing the theme context.
const TOAST_CSS = `
.sheet-toaster [data-sonner-toast][data-styled="true"] {
  border-radius: 0;
  border: 1.5px solid hsl(var(--foreground));
  background: hsl(var(--card));
  color: hsl(var(--foreground));
  box-shadow: 5px 5px 0 hsl(var(--foreground) / 0.14);
  padding: 12px 14px;
  gap: 10px;
  align-items: flex-start;
  font-family: "DM Sans", sans-serif;
}
.sheet-toaster [data-sonner-toast][data-type="error"] { border-left: 5px solid hsl(var(--destructive)); }
.sheet-toaster [data-sonner-toast] [data-icon] {
  width: 10px; height: 10px; margin: 2px 0 0; flex-shrink: 0; align-self: flex-start;
}
.sheet-toaster [data-sonner-toast] [data-content] { gap: 3px; min-width: 0; }
.sheet-toaster [data-sonner-toast] [data-content]::before {
  font-family: "Sora", sans-serif; font-weight: 600; font-size: 9.5px; letter-spacing: 0.14em; text-transform: uppercase;
  color: hsl(var(--muted-foreground)); line-height: 1.2;
}
.sheet-toaster [data-sonner-toast][data-type="success"] [data-content]::before { content: "Done"; }
.sheet-toaster [data-sonner-toast][data-type="error"] [data-content]::before { content: "Error"; color: hsl(var(--destructive)); }
.sheet-toaster [data-sonner-toast][data-type="warning"] [data-content]::before { content: "Check"; }
.sheet-toaster [data-sonner-toast][data-type="info"] [data-content]::before { content: "Note"; }
.sheet-toaster [data-sonner-toast][data-type="loading"] [data-content]::before { content: "Working"; }
.sheet-toaster [data-sonner-toast] [data-title] { font-size: 13px; font-weight: 600; line-height: 1.35; color: hsl(var(--foreground)); }
.sheet-toaster [data-sonner-toast] [data-description] { font-size: 12px; line-height: 1.4; color: hsl(var(--foreground) / 0.72); }
.sheet-toaster[data-sonner-toaster] [data-sonner-toast] [data-close-button] {
  left: auto; right: 0; top: 0; transform: translate(40%, -40%); width: 20px; height: 20px;
  border-radius: 0; border: 1.5px solid hsl(var(--foreground)); background: hsl(var(--card)); color: hsl(var(--foreground));
  box-shadow: none; transition: background-color .15s, color .15s;
}
.sheet-toaster[data-sonner-toaster] [data-sonner-toast] [data-close-button]:hover { background: hsl(var(--foreground)); color: hsl(var(--card)); border-color: hsl(var(--foreground)); }
.sheet-toaster[data-sonner-toaster] [data-sonner-toast] [data-close-button] svg { width: 10px; height: 10px; stroke-width: 2.5; }
.sheet-toaster [data-sonner-toast] [data-button] {
  border-radius: 0; height: 26px; padding: 0 10px; align-self: center;
  font-family: "Sora", sans-serif; font-weight: 600; font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase;
}
.sheet-toaster [data-sonner-toast] [data-button][data-action] { background: hsl(var(--foreground)); color: hsl(var(--card)); }
.sheet-toaster [data-sonner-toast] [data-button][data-cancel] {
  background: transparent; color: hsl(var(--foreground)); border: 1px solid hsl(var(--foreground));
}
.sheet-toaster .toast-mark { display: block; width: 10px; height: 10px; border: 1px solid hsl(var(--foreground)); }
.sheet-toaster .toast-mark.done { background: hsl(var(--primary)); border-color: hsl(var(--primary)); }
.sheet-toaster .toast-mark.stopped { background: hsl(var(--destructive)); border-color: hsl(var(--destructive)); }
.sheet-toaster .toast-mark.waiting {
  background: repeating-linear-gradient(135deg, hsl(var(--foreground)) 0, hsl(var(--foreground)) 1px, transparent 1px, transparent 3px);
}
.sheet-toaster .toast-mark.busy {
  background: repeating-linear-gradient(135deg, hsl(var(--foreground)) 0, hsl(var(--foreground)) 1px, transparent 1px, transparent 3px);
  background-size: 8.5px 8.5px;
  animation: toast-hatch 0.8s linear infinite;
}
@keyframes toast-hatch { to { background-position: 8.5px 0; } }
@media (prefers-reduced-motion: reduce) { .sheet-toaster .toast-mark.busy { animation: none; } }
`;

const Mark = ({ tone }: { tone: "done" | "stopped" | "waiting" | "note" | "busy" }) => (
  <i className={`toast-mark ${tone}`} aria-hidden="true" />
);

// Sonner writes its `theme` prop onto the toaster as data-theme, and the app's palettes are keyed on [data-theme] -
// so the toaster has to carry the page's own theme, or it would always fall back to the light palette.
function usePageTheme(): string {
  const read = () => document.documentElement.getAttribute("data-theme") || "light";
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

const Toaster = ({ className, ...props }: ToasterProps) => {
  const theme = usePageTheme();
  return (
    <>
      <style>{TOAST_CSS}</style>
      <Sonner
        theme={theme as ToasterProps["theme"]}
        className={`toaster group sheet-toaster ${className ?? ""}`}
        icons={{
          success: <Mark tone="done" />,
          error: <Mark tone="stopped" />,
          warning: <Mark tone="waiting" />,
          info: <Mark tone="note" />,
          loading: <Mark tone="busy" />,
        }}
        {...props}
      />
    </>
  );
};

export { Toaster, toast };
