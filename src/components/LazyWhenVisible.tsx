import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Renders `children` only once the spot has scrolled (nearly) into view. Until then it holds the space with an
 * empty box of `minHeight`, so nothing below it jumps when the content arrives. For heavy panels that sit
 * below the first screen: their layout, animations and data crunching no longer compete with what the
 * person is actually looking at while the page loads.
 *
 * Without IntersectionObserver (old browsers, tests) the children render straight away.
 */
export function LazyWhenVisible({
  children,
  minHeight = 320,
  rootMargin = "400px",
  className,
}: {
  children: ReactNode;
  minHeight?: number;
  /** How far before it is visible to start rendering. */
  rootMargin?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible, rootMargin]);

  if (visible) return <>{children}</>;
  return <div ref={ref} className={className} style={{ minHeight }} aria-hidden="true" />;
}
