// The blueprint drawing of a site and crane behind the sign-in page's headline: lilac linework on the dark ground.
// ── Blueprint SVG scene (crane) ───────────────────────────────────────────────
export function CivilScene() {
  return (
    <svg viewBox="0 0 800 420" xmlns="http://www.w3.org/2000/svg" className="w-full h-full" style={{ overflow: "visible" }}>
      <defs>
        <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
          <path d="M 30 0 L 0 0 0 30" fill="none" stroke="rgba(167,139,250,0.18)" strokeWidth="0.8" />
        </pattern>
        <pattern id="gridBig" width="90" height="90" patternUnits="userSpaceOnUse">
          <path d="M 90 0 L 0 0 0 90" fill="none" stroke="rgba(167,139,250,0.28)" strokeWidth="1.2" />
        </pattern>
        <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="softShadow">
          <feDropShadow dx="0" dy="4" stdDeviation="8" floodColor="rgba(124,58,237,0.2)" />
        </filter>
      </defs>
      <rect width="800" height="420" fill="url(#grid)" opacity="0.6" />
      <rect width="800" height="420" fill="url(#gridBig)" opacity="0.8" />
      <line x1="0" y1="370" x2="800" y2="370" stroke="rgba(167,139,250,0.3)" strokeWidth="1.5" strokeDasharray="8 4" />
      {/* Small building left */}
      <g opacity="0.55">
        <rect x="20" y="290" width="60" height="80" fill="none" stroke="rgba(167,139,250,0.5)" strokeWidth="1.2" />
        {[300, 320, 340, 360].map((y) => (
          <g key={y}>
            <rect x="28" y={y} width="10" height="12" fill="none" stroke="rgba(167,139,250,0.4)" strokeWidth="0.8" />
            <rect x="44" y={y} width="10" height="12" fill="none" stroke="rgba(167,139,250,0.4)" strokeWidth="0.8" />
            <rect x="60" y={y} width="10" height="12" fill="none" stroke="rgba(167,139,250,0.4)" strokeWidth="0.8" />
          </g>
        ))}
      </g>
      {/* Medium building */}
      <g opacity="0.6">
        <rect x="100" y="210" width="80" height="160" fill="none" stroke="rgba(167,139,250,0.55)" strokeWidth="1.4" />
        {[220, 240, 260, 280, 300, 320, 340, 360].map((y) => (
          <g key={y}>
            <rect x="108" y={y} width="12" height="14" fill="none" stroke="rgba(167,139,250,0.35)" strokeWidth="0.8" />
            <rect x="126" y={y} width="12" height="14" fill="none" stroke="rgba(167,139,250,0.35)" strokeWidth="0.8" />
            <rect x="144" y={y} width="12" height="14" fill="none" stroke="rgba(167,139,250,0.35)" strokeWidth="0.8" />
            <rect x="162" y={y} width="12" height="14" fill="none" stroke="rgba(167,139,250,0.35)" strokeWidth="0.8" />
          </g>
        ))}
        <line x1="100" y1="210" x2="180" y2="210" stroke="rgba(167,139,250,0.5)" strokeWidth="2" />
        <rect x="120" y="198" width="40" height="12" fill="none" stroke="rgba(167,139,250,0.4)" strokeWidth="1" />
      </g>
      {/* Right building */}
      <g opacity="0.5">
        <rect x="610" y="250" width="70" height="120" fill="none" stroke="rgba(167,139,250,0.5)" strokeWidth="1.2" />
        {[260, 278, 296, 314, 332, 350].map((y) => (
          <g key={y}>
            <rect x="618" y={y} width="10" height="13" fill="none" stroke="rgba(167,139,250,0.35)" strokeWidth="0.8" />
            <rect x="634" y={y} width="10" height="13" fill="none" stroke="rgba(167,139,250,0.35)" strokeWidth="0.8" />
            <rect x="650" y={y} width="10" height="13" fill="none" stroke="rgba(167,139,250,0.35)" strokeWidth="0.8" />
            <rect x="666" y={y} width="10" height="13" fill="none" stroke="rgba(167,139,250,0.35)" strokeWidth="0.8" />
          </g>
        ))}
      </g>
      {/* Far right tall building */}
      <g opacity="0.55">
        <rect x="700" y="200" width="85" height="170" fill="none" stroke="rgba(167,139,250,0.55)" strokeWidth="1.4" />
        {[210, 228, 246, 264, 282, 300, 318, 336, 354].map((y) => (
          <g key={y}>
            <rect x="708" y={y} width="11" height="13" fill="none" stroke="rgba(167,139,250,0.3)" strokeWidth="0.8" />
            <rect x="725" y={y} width="11" height="13" fill="none" stroke="rgba(167,139,250,0.3)" strokeWidth="0.8" />
            <rect x="742" y={y} width="11" height="13" fill="none" stroke="rgba(167,139,250,0.3)" strokeWidth="0.8" />
            <rect x="759" y={y} width="11" height="13" fill="none" stroke="rgba(167,139,250,0.3)" strokeWidth="0.8" />
            <rect x="776" y={y} width="11" height="13" fill="none" stroke="rgba(167,139,250,0.3)" strokeWidth="0.8" />
          </g>
        ))}
        <rect x="720" y="186" width="45" height="14" fill="none" stroke="rgba(167,139,250,0.45)" strokeWidth="1" />
      </g>
      {/* Crane */}
      <g filter="url(#softShadow)">
        <rect x="378" y="80" width="10" height="290" fill="none" stroke="rgba(167,139,250,0.8)" strokeWidth="2" />
        {[80, 120, 160, 200, 240, 280, 320].map((y, i) => (
          <line key={y} x1={i % 2 === 0 ? 378 : 388} y1={y} x2={i % 2 === 0 ? 388 : 378} y2={y + 40} stroke="rgba(167,139,250,0.5)" strokeWidth="1" />
        ))}
        <rect x="388" y="82" width="200" height="8" fill="none" stroke="rgba(167,139,250,0.8)" strokeWidth="1.8" />
        {[0, 40, 80, 120, 160].map((x) => (
          <line key={x} x1={388 + x} y1="82" x2={388 + x + 40} y2="90" stroke="rgba(167,139,250,0.45)" strokeWidth="1" />
        ))}
        <rect x="298" y="82" width="80" height="8" fill="none" stroke="rgba(167,139,250,0.7)" strokeWidth="1.8" />
        <rect x="288" y="78" width="20" height="20" fill="none" stroke="rgba(167,139,250,0.6)" strokeWidth="1.5" />
        <rect x="372" y="68" width="22" height="18" fill="none" stroke="rgba(167,139,250,0.9)" strokeWidth="1.8" />
        <rect x="376" y="72" width="6" height="8" fill="rgba(167,139,250,0.15)" stroke="rgba(167,139,250,0.5)" strokeWidth="0.8" />
        <rect x="384" y="72" width="6" height="8" fill="rgba(167,139,250,0.15)" stroke="rgba(167,139,250,0.5)" strokeWidth="0.8" />
        {/* Dangling wire + load */}
        <line x1="560" y1="90" x2="560" y2="200" stroke="rgba(167,139,250,0.7)" strokeWidth="1.5" strokeDasharray="4 3">
          <animate attributeName="y2" values="200;240;200" dur="4s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.6 1;0.4 0 0.6 1" />
        </line>
        <g>
          <animateTransform attributeName="transform" type="translate" values="0,0;0,40;0,0" dur="4s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.6 1;0.4 0 0.6 1" additive="sum" />
          <rect x="554" y="200" width="12" height="10" fill="none" stroke="rgba(167,139,250,0.8)" strokeWidth="1.5" />
          <path d="M 558 210 Q 560 218 562 210" fill="none" stroke="rgba(167,139,250,0.8)" strokeWidth="1.5" />
        </g>
        {/* Moving trolley */}
        <rect x="549" y="88" width="18" height="10" fill="rgba(167,139,250,0.1)" stroke="rgba(167,139,250,0.7)" strokeWidth="1.2">
          <animate attributeName="x" values="549;440;549" dur="8s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.6 1;0.4 0 0.6 1" />
        </rect>
        {/* Support cables */}
        <line x1="383" y1="82" x2="440" y2="140" stroke="rgba(167,139,250,0.35)" strokeWidth="1" />
        <line x1="383" y1="82" x2="500" y2="140" stroke="rgba(167,139,250,0.3)" strokeWidth="1" />
        <line x1="383" y1="82" x2="340" y2="140" stroke="rgba(167,139,250,0.3)" strokeWidth="1" />
        {/* Base */}
        <rect x="358" y="368" width="50" height="8" fill="none" stroke="rgba(167,139,250,0.7)" strokeWidth="2" />
        <rect x="350" y="374" width="66" height="6" fill="none" stroke="rgba(167,139,250,0.6)" strokeWidth="1.5" />
      </g>
      {/* Scaffold */}
      <g opacity="0.4">
        <line x1="695" y1="200" x2="695" y2="370" stroke="rgba(167,139,250,0.6)" strokeWidth="1.5" />
        <line x1="707" y1="200" x2="707" y2="370" stroke="rgba(167,139,250,0.6)" strokeWidth="1.5" />
        {[200, 230, 260, 290, 320, 350].map((y) => (
          <line key={y} x1="695" y1={y} x2="707" y2={y} stroke="rgba(167,139,250,0.5)" strokeWidth="1.2" />
        ))}
      </g>
      {/* Pulsing markers */}
      {[[220, 185], [560, 60], [650, 230], [80, 260]].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="3" fill="none" stroke="rgba(167,139,250,0.5)" strokeWidth="1">
          <animate attributeName="opacity" values="0.3;0.9;0.3" dur={`${2.5 + i * 0.7}s`} repeatCount="indefinite" />
        </circle>
      ))}
    </svg>
  );
}
