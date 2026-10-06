// DM Sans for every printed / PDF document (Purchase Order, GRN, Vehicle In/Out,
// Material Issue, Material Request, Payments, ...), matching the app's own font.
// The TTFs are self-hosted in /public/fonts so a print window or a downloaded
// PDF never depends on Google Fonts being reachable (OFL licence: DMSans-OFL.txt).

/** Absolute, so it also resolves from a blob: print window. */
export const FONT_BASE = typeof location !== "undefined" ? `${location.origin}/fonts` : "/fonts";

/** @font-face rules to drop at the top of a print window's <style>. */
export const DM_SANS_FACE_CSS = `@font-face { font-family: 'DM Sans'; font-weight: 400; src: url('${FONT_BASE}/DMSans-Regular.ttf') format('truetype'); }
@font-face { font-family: 'DM Sans'; font-weight: 500 900; src: url('${FONT_BASE}/DMSans-Bold.ttf') format('truetype'); }
`;

/** Print once the popup's fonts have loaded, so it doesn't print in the fallback face. */
export function printWhenFontsReady(win: Window) {
  win.onload = async () => {
    try {
      await win.document.fonts.ready;
    } catch {
      /* print with whatever loaded */
    }
    win.focus();
    win.print();
  };
}

async function fontBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  } catch {
    return null;
  }
}

/** Embeds DM Sans (regular + bold) into a jsPDF doc. Returns the font name to
 *  use — "DMSans", or "helvetica" if the font files couldn't be fetched. */
export async function embedDmSans(doc: {
  addFileToVFS: (name: string, data: string) => void;
  addFont: (file: string, name: string, style: string) => void;
}): Promise<string> {
  const [regular, bold] = await Promise.all([
    fontBase64(`${FONT_BASE}/DMSans-Regular.ttf`),
    fontBase64(`${FONT_BASE}/DMSans-Bold.ttf`),
  ]);
  if (!regular || !bold) return "helvetica";
  doc.addFileToVFS("DMSans-Regular.ttf", regular);
  doc.addFont("DMSans-Regular.ttf", "DMSans", "normal");
  doc.addFileToVFS("DMSans-Bold.ttf", bold);
  doc.addFont("DMSans-Bold.ttf", "DMSans", "bold");
  return "DMSans";
}
