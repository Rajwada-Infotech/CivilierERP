// A small square thumbnail of a profile picture, made in the browser, for
// lists (Users, Activity Browser) — a few KB instead of the full upload.
// Centre-cropped to a square and drawn at 2x the largest list size (56 px),
// so it stays sharp on high-density screens. Returns null if the picture
// can't be read (the caller just keeps the full one).
export async function makeAvatarThumb(dataUri: string, size = 112): Promise<string | null> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = dataUri;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    if (!side) return null;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#fff"; // transparent PNGs get a plain background in JPEG
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
    return canvas.toDataURL("image/jpeg", 0.82);
  } catch {
    return null;
  }
}
