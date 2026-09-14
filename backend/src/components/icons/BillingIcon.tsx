import React from "react";
import { cn } from "@/lib/utils";

interface BillingIconProps {
  className?: string;
  size?: number;
}

export const BillingIcon: React.FC<BillingIconProps> = ({ 
  className, 
  size = 20 
}) => (
  <svg 
    viewBox="0 0 24 24" 
    fill="none" 
    className={cn("w-6 h-6", className)}
    width={size}
    height={size}
  >
    {/* Invoice background */}
    <rect 
      x="4" y="4" 
      width="16" height="16" 
      rx="2" 
      className="fill-current opacity-20 stroke-current stroke-2" 
    />
    {/* Fold */}
    <path 
      d="M16 6L20 4V16L16 14V6Z" 
      className="fill-current opacity-10 stroke-current stroke-1" 
    />
    {/* Lines */}
    <path d="M6 8H14M6 11H14M6 14H12" className="stroke-current stroke-1" />
    {/* Bold B */}
    <text 
      x="9" y="19" 
      fontFamily="inherit" 
      fontWeight="bold" 
      fontSize="12" 
      fill="currentColor"
      textAnchor="middle"
    >
      B
    </text>
  </svg>
);

