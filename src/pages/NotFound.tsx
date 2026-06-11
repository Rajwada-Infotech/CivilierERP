import { useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";

const NotFound = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser } = useAuth();

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname,
    );
  }, [location.pathname]);

  const handleGoBack = () => {
    if (currentUser) {
      navigate(-1);
    } else {
      navigate("/");
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center overflow-hidden relative font-sans select-none">
      {/* Blueprint grid — tight engineering paper */}
      <svg
        className="absolute inset-0 w-full h-full opacity-[0.07] pointer-events-none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern
            id="smallGrid"
            width="20"
            height="20"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 20 0 L 0 0 0 20"
              fill="none"
              stroke="hsl(239,84%,67%)"
              strokeWidth="0.4"
            />
          </pattern>
          <pattern
            id="bigGrid"
            width="100"
            height="100"
            patternUnits="userSpaceOnUse"
          >
            <rect width="100" height="100" fill="url(#smallGrid)" />
            <path
              d="M 100 0 L 0 0 0 100"
              fill="none"
              stroke="hsl(239,84%,67%)"
              strokeWidth="0.8"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#bigGrid)" />
      </svg>

      {/* Faint radial glow behind center */}
      <div
        className="absolute pointer-events-none"
        style={{
          width: 600,
          height: 600,
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          background:
            "radial-gradient(ellipse at center, hsl(239 84% 67% / 0.08) 0%, transparent 70%)",
          borderRadius: "50%",
        }}
      />

      <div className="relative z-10 flex flex-col items-center gap-10 px-6 max-w-xl w-full">
        {/* Drawing sheet header strip */}
        <div className="w-full flex items-center justify-between border border-border/50 px-4 py-2 rounded-md bg-card/40 backdrop-blur-sm">
          <span className="font-mono text-[10px] text-muted-foreground tracking-widest uppercase">
            Civilier ERP
          </span>
          <span className="font-mono text-[10px] text-muted-foreground tracking-widest uppercase">
            DWG-000 · REV 0
          </span>
          <span className="font-mono text-[10px] text-muted-foreground tracking-widest uppercase">
            Error Sheet
          </span>
        </div>

        {/* 404 with dimension lines */}
        <div
          className="relative flex items-center justify-center w-full"
          style={{ height: 180 }}
        >
          {/* Left dimension line */}
          <div
            className="absolute flex flex-col items-center"
            style={{ left: "8%", top: 0, bottom: 0 }}
          >
            <div
              className="w-px flex-1 bg-primary/40"
              style={{ animationDelay: "0s" }}
            />
            <div className="w-3 h-px bg-primary/60" />
            <div
              className="font-mono text-[9px] text-primary/60 my-1 tracking-widest"
              style={{ writingMode: "vertical-rl" }}
            >
              HEIGHT: ??
            </div>
            <div className="w-3 h-px bg-primary/60" />
            <div className="w-px flex-1 bg-primary/40" />
          </div>

          {/* Right dimension line */}
          <div
            className="absolute flex flex-col items-center"
            style={{ right: "8%", top: 0, bottom: 0 }}
          >
            <div className="w-px flex-1 bg-primary/40" />
            <div className="w-3 h-px bg-primary/60" />
            <div
              className="font-mono text-[9px] text-primary/60 my-1 tracking-widest"
              style={{ writingMode: "vertical-rl" }}
            >
              ROUTE: NULL
            </div>
            <div className="w-3 h-px bg-primary/60" />
            <div className="w-px flex-1 bg-primary/40" />
          </div>

          {/* Top dimension line */}
          <div
            className="absolute flex items-center"
            style={{ top: 10, left: "16%", right: "16%" }}
          >
            <div className="h-px flex-1 bg-primary/40" />
            <span className="font-mono text-[9px] text-primary/60 mx-2 tracking-widest whitespace-nowrap">
              404.00mm
            </span>
            <div className="h-px flex-1 bg-primary/40" />
          </div>

          {/* The 404 itself */}
          <h1
            className="text-[120px] md:text-[150px] font-black tracking-[-0.04em] leading-none"
            style={{
              fontFamily: "'Sora', sans-serif",
              color: "hsl(var(--foreground))",
              textShadow: "0 0 80px hsl(239 84% 67% / 0.25)",
              letterSpacing: "-0.05em",
            }}
          >
            404
          </h1>

          {/* Bottom dimension arrow line */}
          <div
            className="absolute flex items-center"
            style={{ bottom: 10, left: "16%", right: "16%" }}
          >
            <div className="h-px flex-1 bg-primary/40" />
            <span className="font-mono text-[9px] text-primary/60 mx-2 tracking-widest whitespace-nowrap">
              NOT FOUND
            </span>
            <div className="h-px flex-1 bg-primary/40" />
          </div>
        </div>

        {/* Message block — styled like a drawing note box */}
        <div className="w-full border border-border/60 rounded-md bg-card/50 backdrop-blur-sm p-5 space-y-2">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-primary" />
            <span className="font-mono text-[10px] text-muted-foreground tracking-widest uppercase">
              Navigation Error · Site Notice
            </span>
          </div>
          <p className="text-foreground font-semibold text-xl leading-snug">
            This page doesn't exist in the project.
          </p>
          <p className="text-muted-foreground text-sm leading-relaxed">
            The route{" "}
            <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded text-primary">
              {location.pathname}
            </code>{" "}
            wasn't found. It may have been removed, renamed, or you may not have
            access.
          </p>
        </div>

        {/* Action */}
        <button
          onClick={handleGoBack}
          className="group inline-flex items-center gap-3 px-7 py-3 font-semibold rounded-xl text-base transition-all duration-200 hover:scale-[1.03] active:scale-[0.97]"
          style={{
            background: "hsl(239 84% 67%)",
            color: "#fff",
            boxShadow: "0 4px 24px hsl(239 84% 67% / 0.28)",
            fontFamily: "'DM Sans', sans-serif",
          }}
        >
          <span
            className="text-white/70 group-hover:text-white transition-colors duration-200"
            style={{ fontSize: 18, lineHeight: 1 }}
          >
            ←
          </span>
          {currentUser ? "Back to Dashboard" : "Go to Login"}
        </button>

        {/* Drawing sheet footer */}
        <div className="w-full flex items-center justify-between border-t border-border/30 pt-3">
          <span className="font-mono text-[9px] text-muted-foreground/50 tracking-widest uppercase">
            Scale: N/A
          </span>
          <span className="font-mono text-[9px] text-muted-foreground/50 tracking-widest uppercase">
            Checked: System
          </span>
          <span className="font-mono text-[9px] text-muted-foreground/50 tracking-widest uppercase">
            Status: Error
          </span>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
