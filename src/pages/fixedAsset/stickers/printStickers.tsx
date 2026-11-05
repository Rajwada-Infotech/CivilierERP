// The printed sticker sheet (opened in a new window and printed) and the same sticker drawn on screen for the preview.
import { toast } from "sonner";
import { code128SVG } from "@/lib/code128";
import type { TaggedFAItemCode } from "@/api/fixedAssetTaggingApi";

// ── Sticker sheet HTML (opened in a new window and printed) ──────────────────
function buildStickerHtml(rows: TaggedFAItemCode[]): string {
  const stickers = rows.map((r) => {
    const svg = code128SVG(r.FAItemCode, { moduleWidth: 1.5, height: 60, quietZone: 8 });
    return `
      <div class="sticker">
        <div class="tab"><span>FIXED ASSET</span></div>
        <div class="body">
          <div class="prop">PROPERTY OF</div>
          ${r.CompanyName ? `<div class="company">${escapeHtml(r.CompanyName)}</div>` : ""}
          <div class="barcode">${svg}</div>
          <div class="code">${escapeHtml(r.FAItemCode)}</div>
          <div class="name">${escapeHtml(r.ItemName || "")}</div>
        </div>
      </div>`;
  }).join("");

  return `<!doctype html><html><head><meta charset="utf-8"><title>Fixed Asset Stickers</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; padding: 8mm; background: #fff; color: #000; }
    .sheet { display: flex; flex-wrap: wrap; gap: 4mm; }
    .sticker {
      display: flex; width: 76mm; height: 30mm; border: 0.4mm solid #bbb;
      border-radius: 1.5mm; overflow: hidden; page-break-inside: avoid; background: #fff;
    }
    .tab {
      width: 11mm; background: #f4c400; display: flex; align-items: center; justify-content: center;
    }
    .tab span {
      writing-mode: vertical-rl; transform: rotate(180deg);
      font-weight: 800; font-size: 8pt; letter-spacing: 1.5px; color: #222;
    }
    .body {
      flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
      padding: 1.5mm 2mm; text-align: center; min-width: 0;
    }
    .prop { font-size: 5.5pt; letter-spacing: 1.5px; color: #444; }
    .company { font-size: 10pt; font-weight: 800; line-height: 1.1; margin: 0.3mm 0 0.8mm; }
    .barcode { width: 100%; height: 9mm; }
    .barcode svg { width: 100%; height: 100%; display: block; }
    .code { font-size: 8.5pt; font-weight: 700; letter-spacing: 0.4px; margin-top: 0.6mm; }
    .name { font-size: 6.5pt; color: #333; margin-top: 0.3mm; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    @media print {
      body { padding: 4mm; }
      .sticker { border-color: #999; }
    }
  </style></head>
  <body><div class="sheet">${stickers}</div>
  <script>window.onload = function () { window.focus(); window.print(); };</script>
  </body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export function printStickers(rows: TaggedFAItemCode[]) {
  if (rows.length === 0) return;
  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) {
    toast.error("The print window was blocked. Allow pop-ups for this site and print again.");
    return;
  }
  w.document.open();
  w.document.write(buildStickerHtml(rows));
  w.document.close();
}

// ── Sticker preview (screen) ────────────────────────────────────────────────
export function StickerPreview({ row }: { row: TaggedFAItemCode }) {
  return (
    <div className="flex w-[300px] h-[118px] rounded-md overflow-hidden border border-border bg-white text-black shrink-0">
      <div className="w-11 bg-[#f4c400] flex items-center justify-center">
        <span className="[writing-mode:vertical-rl] rotate-180 font-extrabold text-[0.625rem] tracking-widest text-neutral-800">
          FIXED ASSET
        </span>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center px-2 py-1.5 text-center min-w-0">
        <span className="text-[0.4375rem] tracking-widest text-neutral-500">PROPERTY OF</span>
        {row.CompanyName && <span className="text-[0.75rem] font-extrabold leading-tight my-0.5 truncate max-w-full">{row.CompanyName}</span>}
        <span
          className="w-full h-8"
          dangerouslySetInnerHTML={{ __html: code128SVG(row.FAItemCode, { moduleWidth: 1.4, height: 40, quietZone: 6 }).replace("<svg ", '<svg style="width:100%;height:100%" ') }}
        />
        <span className="text-[0.625rem] font-bold tracking-wide mt-0.5">{row.FAItemCode}</span>
        <span className="text-[0.5rem] text-neutral-600 truncate max-w-full">{row.ItemName}</span>
      </div>
    </div>
  );
}
