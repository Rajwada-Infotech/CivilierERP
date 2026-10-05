// DM Sans for server-generated PDFs (matches the app and the browser-side
// print/PDF documents). The TTFs live in backend/assets/fonts (OFL licence:
// DMSans-OFL.txt). Falls back to the built-in Helvetica family if a font file
// is missing or unreadable, so a deploy without the assets still renders.
const fs = require("fs");
const path = require("path");

const FONT_DIR = path.join(__dirname, "..", "assets", "fonts");
const REGULAR = path.join(FONT_DIR, "DMSans-Regular.ttf");
const BOLD = path.join(FONT_DIR, "DMSans-Bold.ttf");

const HELVETICA = { regular: "Helvetica", bold: "Helvetica-Bold", italic: "Helvetica-Oblique" };

/** Registers DM Sans on a PDFKit document and returns the font names to use. */
function dmSansFonts(doc) {
  try {
    if (!fs.existsSync(REGULAR) || !fs.existsSync(BOLD)) return HELVETICA;
    doc.registerFont("DMSans", REGULAR);
    doc.registerFont("DMSans-Bold", BOLD);
    // No italic cut is bundled — DM Sans Regular stands in for it.
    return { regular: "DMSans", bold: "DMSans-Bold", italic: "DMSans" };
  } catch {
    return HELVETICA;
  }
}

module.exports = { dmSansFonts, HELVETICA };
