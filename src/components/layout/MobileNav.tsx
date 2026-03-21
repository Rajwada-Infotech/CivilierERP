import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { BarChart3, CreditCard, Menu, X } from "lucide-react";
import { useModule } from "@/contexts/ModuleContext";

const navItems = [
  { label: "Dashboard", icon: BarChart3, path: "/" },
  { label: "Transactions", icon: CreditCard, path: "/transactions" },
];

export const MobileNav: React.FC = () => {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { moduleLabel } = useModule();

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
            <div className="space-y-1">
              {navItems.map((item) => {
                const active = location.pathname === item.path;
                return (
                  <button
                    key={item.path}
                    onClick={() => { navigate(item.path); setOpen(false); }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${active ? "bg-primary/15 text-primary font-medium" : "text-foreground hover:bg-muted"}`}
                  >
                    <item.icon size={18} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-4 px-2 py-1.5 rounded-md bg-muted text-xs font-heading text-muted-foreground text-center">
              {moduleLabel}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
