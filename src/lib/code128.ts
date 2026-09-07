// Dependency-free Code 128 (subset B) barcode encoder → inline SVG string.
// Used by the Fixed Asset sticker-print page. Kept in sync with the mobile
// copy at mobile-Fixed-Asset/src/utils/code128.ts.

// 107 bar/space module patterns, values 0-106. "1" = one black module,
// "0" = one white module. Index 106 is the Stop pattern (already includes
// the 2-module termination bar).
const PATTERNS = [
  "11011001100","11001101100","11001100110","10010011000","10010001100","10001001100",
  "10011001000","10011000100","10001100100","11001001000","11001000100","11000100100",
  "10110011100","10011011100","10011001110","10111001100","10011101100","10011100110",
  "11001110010","11001011100","11001001110","11011100100","11001110100","11101101110",
  "11101001100","11100101100","11100100110","11101100100","11100110100","11100110010",
  "11011011000","11011000110","11000110110","10100011000","10001011000","10001000110",
  "10110001000","10001101000","10001100010","11010001000","11000101000","11000100010",
  "10110111000","10110001110","10001101110","10111011000","10111000110","10001110110",
  "11101110110","11010001110","11000101110","11011101000","11011100010","11011101110",
  "11101011000","11101000110","11100010110","11101101000","11101100010","11100011010",
  "11101111010","11001000010","11110001010","10100110000","10100001100","10010110000",
  "10010000110","10000101100","10000100110","10110010000","10110000100","10011010000",
  "10011000010","10000110100","10000110010","11000010010","11001010000","11110111010",
  "11000010100","10001111010","10100111100","10010111100","10010011110","10111100100",
  "10011110100","10011110010","11110100100","11110010100","11110010010","11011011110",
  "11011110110","11110110110","10101111000","10100011110","10001011110","10111101000",
  "10111100010","11110101000","11110100010","10111011110","10111101110","11101011110",
  "11110101110","11010000100","11010010000","11010011100","1100011101011",
];

const START_B = 104;
const STOP = 106;

function encode(text: string): string {
  const codes: number[] = [START_B];
  let sum = START_B;
  for (let i = 0; i < text.length; i++) {
    let v = text.charCodeAt(i) - 32;
    if (v < 0 || v > 94) v = "?".charCodeAt(0) - 32; // clamp out-of-range chars
    codes.push(v);
    sum += v * (i + 1);
  }
  codes.push(sum % 103);
  codes.push(STOP);
  return codes.map((c) => PATTERNS[c]).join("");
}

export interface BarcodeOpts {
  /** px width of one module (default 1.6) */
  moduleWidth?: number;
  /** bar height in px (default 46) */
  height?: number;
  /** white quiet-zone modules on each side (default 10) */
  quietZone?: number;
}

/** Returns a standalone `<svg>` string rendering `text` as a Code 128-B barcode. */
export function code128SVG(text: string, opts: BarcodeOpts = {}): string {
  const mw = opts.moduleWidth ?? 1.6;
  const h = opts.height ?? 46;
  const qz = opts.quietZone ?? 10;
  const modules = encode(text);

  let x = qz;
  const rects: string[] = [];
  for (let i = 0; i < modules.length; ) {
    let run = 1;
    while (i + run < modules.length && modules[i + run] === modules[i]) run++;
    if (modules[i] === "1") rects.push(`<rect x="${(x * mw).toFixed(2)}" y="0" width="${(run * mw).toFixed(2)}" height="${h}"/>`);
    x += run;
    i += run;
  }
  const totalW = (modules.length + qz * 2) * mw;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW.toFixed(2)} ${h}" ` +
    `width="${totalW.toFixed(2)}" height="${h}" preserveAspectRatio="none" fill="#000">` +
    rects.join("") +
    `</svg>`
  );
}

/** Same barcode as a data: URI, for use in an <img src>. */
export function code128DataUri(text: string, opts?: BarcodeOpts): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(code128SVG(text, opts))}`;
}
