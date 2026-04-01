import React from "react";

export const LogoIcon = ({ size = 32 }: { size?: number }) => (
  <img
    src="/Civilier.png"
    alt="CivilierERP"
    width={size}
    height={size}
    className="object-contain"
    loading="eager"
    decoding="sync"
  />
);

export const LogoFull = ({ className }: { className?: string }) => (
  <div className={`flex items-center gap-2 ${className || ""}`}>
    <LogoIcon size={32} />
    <div className="flex flex-col leading-none">
      <span className="font-heading font-bold text-lg gradient-text">
        CivilierERP
      </span>
      <span className="text-[10px] text-muted-foreground/60 font-mono tracking-wider select-none">
        v2.1.4
      </span>
    </div>
  </div>
);
