import React from "react";
import { useGracefulLogout } from "@/hooks/useGracefulLogout";
import { useAuth } from "@/contexts/AuthContext";
import { LogoFull } from "@/components/Logo";
import { ThemeSwitcher } from "@/components/navbar/ThemeSwitcher";
import { LogOut, User } from "lucide-react";
import { IdleLogoutWatcher } from "@/components/IdleLogoutWatcher";

export function CustomerLayout({ children }: { children: React.ReactNode }) {
  const { currentUser } = useAuth();
  const { handleLogout, overlay } = useGracefulLogout();

  return (
    <div className="min-h-screen bg-background">
      {/* Minimal navbar - no module switcher, no ERP chrome */}
      <header className="fixed top-0 left-0 right-0 z-50 h-14 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center justify-between h-full px-4 max-w-3xl mx-auto">
          <LogoFull className="h-7 w-auto" />
          <div className="flex items-center gap-2">
            <ThemeSwitcher />
            <span className="hidden sm:inline flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-muted-foreground">
              <User size={14} className="inline mr-1" />
              {currentUser?.name?.split(" ")[0] ?? ""}
            </span>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-destructive/10 hover:text-destructive transition-colors text-sm text-muted-foreground"
            >
              <LogOut size={14} />
              <span className="hidden sm:inline text-xs font-medium">Sign out</span>
            </button>
          </div>
        </div>
      </header>
      <main className="pt-14">
        {children}
      </main>
      {overlay}
      <IdleLogoutWatcher />
    </div>
  );
}