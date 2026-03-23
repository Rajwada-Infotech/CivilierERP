import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { BarChart3, CheckCircle2, Menu, X, Scale, ChevronDown, ChevronUp, FileText } from "lucide-react";
import { useModule } from "@/contexts/ModuleContext";

export const MobileNav: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [queryOpen, setQueryOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { moduleLabel } = useModule();

  const isAdminPage = location.pathname.startsWith("/admin");

  const go = (path: string) => { navigate(path); setOpen(false); };

  const navItems = [
    { label: "Dashboard", icon: BarChart3, path: "/" },
    { label: "Tasks",     icon: CheckCircle2, path: "/tasks" },
  ];

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-50 w-12 h-12 rounded-full gradient-accent text-primary-foreground flex items-center justify-center shadow-lg md:hidden"
      >
        <Menu size={20} />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="absolute bottom-0 left-0 right-0 rounded-t-2xl bg-card border-t border-border p-4 animate-slide-up">
            <div className="flex items-center justify-between mb-4">
              <span className="font-heading text-sm font-semibold text-foreground">Navigation</span>
              <button onClick={() => setOpen(false)} className="p-1 rounded-md hover:bg-muted text-muted-foreground">
                <X size={18} />
              </button>
            </div>

            {isAdminPage ? (
              <p className="text-xs text-muted-foreground text-center py-4 font-heading">Admin Module — no sub-navigation</p>
            ) : (
              <div className="space-y-1">
                {/* Dashboard + Tasks */}
                {navItems.map(item => (
                  <button
                    key={item.path}
                    onClick={() => go(item.path)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${location.pathname === item.path ? "bg-primary/15 text-primary font-medium" : "text-foreground hover:bg-muted"}`}
                  >
                    <item.icon size={18} /> {item.label}
                  </button>
                ))}

                {/* Query group */}
                <div>
                  <button
                    onClick={() => setQueryOpen(p => !p)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-foreground hover:bg-muted transition-all"
                  >
                    <Scale size={18} />
                    <span className="flex-1 text-left">Query</span>
                    {queryOpen ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
                  </button>
                  {queryOpen && (
                    <div className="ml-4 pl-3 border-l border-border mt-0.5 space-y-0.5">
                      <button
                        onClick={() => go("/transactions")}
                        className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all ${location.pathname === "/transactions" ? "bg-primary/15 text-primary font-medium" : "text-foreground hover:bg-muted"}`}
                      >
                        <FileText size={15} /> Trial Balance
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="mt-4 px-2 py-1.5 rounded-md bg-muted text-xs font-heading text-muted-foreground text-center">
              {isAdminPage ? "Admin Module" : moduleLabel}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
