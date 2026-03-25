import React from "react";

export default function Loader() {
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