import React, { useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { LogOut } from "lucide-react";

// ─── Logout Overlay ───────────────────────────────────────────────────────────
// Rendered via portal so it sits above everything regardless of stacking context
function LogoutOverlay({ visible }: { visible: boolean }) {
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-4 bg-background"
      style={{
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "all" : "none",
        transition: "opacity 350ms ease",
      }}
    >
      {/* Animated ring */}
      <div className="relative flex items-center justify-center w-16 h-16">
        <span className="absolute inset-0 rounded-full border-4 border-muted animate-ping opacity-30" />
        <span className="absolute inset-0 rounded-full border-4 border-primary/30" />
        <LogOut size={28} className="text-primary" />
      </div>
      <p className="text-sm font-medium text-muted-foreground tracking-wide">
        Signing out…
      </p>
    </div>,
    document.body,
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useGracefulLogout() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = useCallback(async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);

    // Small delay so the overlay has time to fade in before we nuke the tree
    await new Promise((r) => setTimeout(r, 800));

    await logout();
    navigate("/login", { replace: true });

    // Reset in case component somehow stays mounted
    setIsLoggingOut(false);
  }, [isLoggingOut, logout, navigate]);

  const overlay = <LogoutOverlay visible={isLoggingOut} />;

  return { handleLogout, isLoggingOut, overlay };
}
