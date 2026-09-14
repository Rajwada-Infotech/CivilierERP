import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

const Maintenance = () => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();

  const handleGoBack = () => {
    if (currentUser) {
      navigate(-1);
    } else {
      navigate("/");
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center overflow-hidden relative">
      {/* Subtle grid background */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#27272a_1px,transparent_1px),linear-gradient(to_bottom,#27272a_1px,transparent_1px)] bg-[size:40px_40px] opacity-20" />

      <div className="relative z-10 text-center px-6 max-w-md">
        {/* Robot image - Smaller size */}
        <div className="relative mb-6 flex justify-center">
          <div className="absolute inset-0 bg-primary/10 blur-3xl rounded-full animate-glow-pulse" />
          <img
            src="/maintenance-robot.png"
            alt="Robot digging"
            className="relative z-10 w-48 md:w-56 select-none"
            style={{
              animation: "dig 0.55s ease-in-out infinite alternate",
              transformOrigin: "bottom center",
            }}
          />
        </div>

        {/* Do Not Cross tape */}
        <div className="mb-8 flex justify-center animate-fade-in">
          <svg
            viewBox="0 0 340 54"
            width="340"
            height="54"
            xmlns="http://www.w3.org/2000/svg"
            style={{ filter: "drop-shadow(0 4px 12px rgba(0,0,0,0.5))" }}
          >
            <rect x="0" y="10" width="340" height="34" rx="4" fill="#f59e0b" />
            <clipPath id="tapeClip">
              <rect x="0" y="10" width="340" height="34" rx="4" />
            </clipPath>
            <g clipPath="url(#tapeClip)">
              {Array.from({ length: 20 }).map((_, i) => (
                <polygon
                  key={i}
                  points={`${i * 34 - 20},10 ${i * 34},10 ${i * 34 - 34},44 ${i * 34 - 54},44`}
                  fill="#1a1a1a"
                  opacity="0.85"
                />
              ))}
            </g>
            <text
              x="170"
              y="33"
              textAnchor="middle"
              fontFamily="'Sora', sans-serif"
              fontWeight="800"
              fontSize="14"
              letterSpacing="4"
              fill="white"
            >
              DO NOT CROSS
            </text>
            <rect x="8" y="0" width="8" height="54" rx="3" fill="#78716c" />
            <rect x="324" y="0" width="8" height="54" rx="3" fill="#78716c" />
          </svg>
        </div>

        <div className="space-y-4 animate-slide-up">
          <p className="text-3xl font-medium text-foreground">
            Under Maintenance
          </p>
          <p className="text-muted-foreground text-lg">
            Our robot is hard at work. Be back before your chai gets cold.
          </p>
        </div>

        {/* Button */}
        <div className="mt-12">
          <button
            onClick={handleGoBack}
            className="group inline-flex items-center gap-3 px-8 py-3.5 bg-primary text-primary-foreground font-semibold rounded-2xl text-lg transition-all duration-300 hover:scale-105 active:scale-95 shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30"
          >
            {currentUser ? "Take me back" : "Go to Login"}
            <span className="group-hover:rotate-45 transition-transform duration-300">
              →
            </span>
          </button>
        </div>

        <p className="mt-16 text-xs text-muted-foreground tracking-widest font-mono">
          SCHEDULED • MAINTENANCE
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

      {/* Dig animation keyframe */}
      <style>{`
        @keyframes dig {
          from {
            transform: rotate(-4deg) translateY(0px);
          }
          to {
            transform: rotate(4deg) translateY(6px);
          }
        }
      `}</style>
    </div>
  );
};

export default Maintenance;
