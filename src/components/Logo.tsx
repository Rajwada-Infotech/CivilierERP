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
    <span className="font-heading font-bold text-lg gradient-text">
      CivilierERP
    </span>
  </div>
);
