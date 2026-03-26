import React, { useState, useEffect, useCallback } from "react";

interface LoaderProps {
  duration?: number;
  onComplete?: () => void;
}

export default function Loader({ duration = 1000, onComplete }: LoaderProps) {
  const [isVisible, setIsVisible] = useState(true);

  const hide = useCallback(() => {
    setIsVisible(false);
    onComplete?.();
  }, [onComplete]);

  useEffect(() => {
    const timer = setTimeout(hide, duration);
    return () => clearTimeout(timer);
  }, [hide, duration]);

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center backdrop-blur-xl bg-white/5 z-50">
      <img
        src="/loader.gif"
        alt="Loading..."
        className="w-28 h-28 object-contain drop-shadow-lg"
      />
    </div>
  );
}
