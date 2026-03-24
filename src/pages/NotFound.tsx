import { useLocation } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname,
    );
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center overflow-hidden relative">
      {/* Subtle grid background */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#27272a_1px,transparent_1px),linear-gradient(to_bottom,#27272a_1px,transparent_1px)] bg-[size:40px_40px] opacity-20" />

      <div className="relative z-10 text-center px-6 max-w-md">
        {/* Floating 404 */}
        <div className="relative mb-8">
          <h1
            className="text-[160px] md:text-[200px] font-black tracking-[-0.05em] text-foreground leading-none animate-float select-none"
            style={{ textShadow: "0 0 60px hsl(var(--primary) / 0.4)" }}
          >
            404
          </h1>
          <div className="absolute inset-0 bg-primary/10 blur-3xl rounded-full animate-glow-pulse" />
        </div>

        <div className="space-y-4 animate-slide-up">
          <p className="text-3xl font-medium text-foreground">
            Lost in the void?
          </p>
          <p className="text-muted-foreground text-lg">
            The page you're looking for has been abducted by aliens.
          </p>
        </div>

        {/* Cool Button */}
        <div className="mt-12">
          <a
            href="/"
            className="group inline-flex items-center gap-3 px-8 py-3.5 bg-primary text-primary-foreground font-semibold rounded-2xl text-lg transition-all duration-300 hover:scale-105 active:scale-95 shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30"
          >
            Beam me back home
            <span className="group-hover:rotate-45 transition-transform duration-300">
              →
            </span>
          </a>
        </div>

        <p className="mt-16 text-xs text-muted-foreground tracking-widest font-mono">
          ERROR • NOT_FOUND
        </p>
      </div>

      {/* Twinkling stars */}
      <div className="absolute inset-0 pointer-events-none">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="absolute w-0.5 h-0.5 bg-foreground rounded-full animate-twinkle"
            style={{
              left: `${12 + i * 10}%`,
              top: `${15 + (i % 4) * 18}%`,
              animationDelay: `${i * 0.3}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
};

export default NotFound;
