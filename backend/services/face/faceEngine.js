"use strict";
/**
 * Server-side face pipeline (pure JS + WASM, runs in the Alpine image):
 *   JPEG → YuNet face detector (5 landmarks) → quality checks → 5-point alignment to 112×112 → SFace (MobileFaceNet)
 *   → 128-d L2-normalised embedding.
 * Models: backend/models/face (OpenCV zoo: YuNet MIT, SFace Apache-2.0). Loaded once, lazily.
 * The photo and the embedding only live in memory here; nothing biometric is logged.
 */
const path = require("path");
const jpeg = require("jpeg-js");
const ort = require("onnxruntime-web");

ort.env.wasm.numThreads = 1;
ort.env.logLevel = "error";

const MODEL_DIR = process.env.FACE_MODEL_DIR || path.join(__dirname, "../../models/face");
const DET_FILE = "face_detection_yunet_2023mar.onnx";
const REC_FILE = "face_recognition_sface_2021dec.onnx";
const MODEL_VERSION = "yunet-2023mar+sface-2021dec";
const DET_SIZE = 640;
const MAX_PHOTO_BYTES = 1_500_000;

class FaceQualityError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

let sessions = null;
async function load() {
  if (!sessions) {
    sessions = Promise.all([
      ort.InferenceSession.create(path.join(MODEL_DIR, DET_FILE)),
      ort.InferenceSession.create(path.join(MODEL_DIR, REC_FILE)),
    ]).then(([det, rec]) => ({ det, rec })).catch((e) => { sessions = null; throw e; });
  }
  return sessions;
}

// ── Image helpers ────────────────────────────────────────────────────────────
function decodeDataUrl(dataUrl) {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!m) throw new FaceQualityError("A live JPEG photo is required.", "format");
  const buf = Buffer.from(m[1], "base64");
  if (buf.length > MAX_PHOTO_BYTES) throw new FaceQualityError("The photo is too large.", "format");
  try {
    return jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 128, formatAsRGBA: true });
  } catch {
    throw new FaceQualityError("The photo could not be read.", "format");
  }
}

/** Bilinear sample of channel c at (x, y). */
function sample(img, x, y, c) {
  const { width: w, height: h, data } = img;
  if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return 0;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1);
  const fx = x - x0, fy = y - y0;
  const p = (xx, yy) => data[(yy * w + xx) * 4 + c];
  return (p(x0, y0) * (1 - fx) + p(x1, y0) * fx) * (1 - fy) + (p(x0, y1) * (1 - fx) + p(x1, y1) * fx) * fy;
}

// ── Detection (YuNet) ────────────────────────────────────────────────────────
async function detect(img) {
  const { det } = await load();
  const scale = Math.min(DET_SIZE / img.width, DET_SIZE / img.height);
  const input = new Float32Array(3 * DET_SIZE * DET_SIZE);
  const plane = DET_SIZE * DET_SIZE;
  const sw = Math.round(img.width * scale), sh = Math.round(img.height * scale);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const sx = (x + 0.5) / scale - 0.5, sy = (y + 0.5) / scale - 0.5;
      const i = y * DET_SIZE + x;
      input[i] = sample(img, sx, sy, 2);              // B
      input[plane + i] = sample(img, sx, sy, 1);      // G
      input[2 * plane + i] = sample(img, sx, sy, 0);  // R
    }
  }
  const out = await det.run({ input: new ort.Tensor("float32", input, [1, 3, DET_SIZE, DET_SIZE]) });
  const faces = [];
  for (const s of [8, 16, 32]) {
    const cols = DET_SIZE / s, rows = DET_SIZE / s;
    const cls = out[`cls_${s}`].data, obj = out[`obj_${s}`].data, box = out[`bbox_${s}`].data, kps = out[`kps_${s}`].data;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const score = Math.sqrt(Math.min(Math.max(cls[idx], 0), 1) * Math.min(Math.max(obj[idx], 0), 1));
        if (score < 0.6) continue;
        const cx = (c + box[idx * 4]) * s, cy = (r + box[idx * 4 + 1]) * s;
        const w = Math.exp(box[idx * 4 + 2]) * s, h = Math.exp(box[idx * 4 + 3]) * s;
        const pts = [];
        for (let n = 0; n < 5; n++) pts.push([((kps[idx * 10 + 2 * n] + c) * s) / scale, ((kps[idx * 10 + 2 * n + 1] + r) * s) / scale]);
        faces.push({ score, x: (cx - w / 2) / scale, y: (cy - h / 2) / scale, w: w / scale, h: h / scale, pts });
      }
    }
  }
  // Non-maximum suppression
  faces.sort((a, b) => b.score - a.score);
  const keep = [];
  const iou = (a, b) => {
    const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    const inter = ix * iy;
    return inter / (a.w * a.h + b.w * b.h - inter);
  };
  for (const f of faces) if (keep.every((k) => iou(k, f) < 0.3)) keep.push(f);
  return keep;
}

// ── Quality checks ───────────────────────────────────────────────────────────
function quality(img, faces) {
  const strong = faces.filter((f) => f.score >= 0.8);
  if (!strong.length) throw new FaceQualityError("No face found. Look straight at the camera in good light.", "no_face");
  if (strong.length > 1) throw new FaceQualityError("More than one face is in the picture. Only you should be in the frame.", "multiple");
  const f = strong[0];
  const minSide = Math.min(img.width, img.height);
  if (f.w < 80 || f.w < minSide * 0.18) throw new FaceQualityError("Your face is too small or too far. Move closer to the camera.", "small");
  if (f.x < -f.w * 0.1 || f.y < -f.h * 0.1 || f.x + f.w > img.width * 1.02 || f.y + f.h > img.height * 1.02) {
    throw new FaceQualityError("Your face is cut off. Keep the whole face inside the frame.", "cut");
  }
  const [le, re, nose] = f.pts;
  const eyeDx = re[0] - le[0], eyeDy = re[1] - le[1];
  const eyeDist = Math.hypot(eyeDx, eyeDy);
  const roll = Math.abs((Math.atan2(eyeDy, eyeDx) * 180) / Math.PI);
  if (Math.min(roll, 180 - roll) > 20) throw new FaceQualityError("Your head is tilted. Keep it straight.", "tilt");
  const yaw = (nose[0] - (le[0] + re[0]) / 2) / (eyeDist || 1);
  if (Math.abs(yaw) > 0.35) throw new FaceQualityError("Turn your face straight towards the camera.", "turned");
  // Light and sharpness, measured on the face box in grey.
  const x0 = Math.max(0, Math.floor(f.x)), y0 = Math.max(0, Math.floor(f.y));
  const x1 = Math.min(img.width - 1, Math.ceil(f.x + f.w)), y1 = Math.min(img.height - 1, Math.ceil(f.y + f.h));
  const step = Math.max(1, Math.floor((x1 - x0) / 96));
  const g = (x, y) => { const i = (y * img.width + x) * 4; return 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]; };
  let sum = 0, n = 0, lap = 0, lap2 = 0, m = 0;
  for (let y = y0 + step; y < y1 - step; y += step) {
    for (let x = x0 + step; x < x1 - step; x += step) {
      const v = g(x, y);
      sum += v; n++;
      const l = 4 * v - g(x - step, y) - g(x + step, y) - g(x, y - step) - g(x, y + step);
      lap += l; lap2 += l * l; m++;
    }
  }
  const mean = n ? sum / n : 0;
  if (mean < 50) throw new FaceQualityError("It's too dark. Move to better light.", "dark");
  if (mean > 215) throw new FaceQualityError("Too much light on your face. Avoid direct light behind or on the camera.", "bright");
  const sharp = m ? lap2 / m - (lap / m) ** 2 : 0;
  if (sharp < 25) throw new FaceQualityError("The picture is blurry. Hold the camera still.", "blur");
  return { face: f, brightness: mean, sharpness: sharp, quality: Math.min(1, f.score) };
}

// ── Alignment + embedding (SFace / MobileFaceNet) ───────────────────────────
// ArcFace 112×112 reference points: left eye, right eye, nose, left mouth, right mouth.
const REF = [[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]];

/** Least-squares similarity transform mapping points p → q: returns [a, b, tx, ty] with x' = a·x − b·y + tx, y' = b·x + a·y + ty. */
function similarity(p, q) {
  const n = p.length;
  const pm = [0, 0], qm = [0, 0];
  for (let i = 0; i < n; i++) { pm[0] += p[i][0] / n; pm[1] += p[i][1] / n; qm[0] += q[i][0] / n; qm[1] += q[i][1] / n; }
  let num1 = 0, num2 = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const px = p[i][0] - pm[0], py = p[i][1] - pm[1], qx = q[i][0] - qm[0], qy = q[i][1] - qm[1];
    num1 += px * qx + py * qy; num2 += px * qy - py * qx; den += px * px + py * py;
  }
  const a = num1 / den, b = num2 / den;
  return [a, b, qm[0] - (a * pm[0] - b * pm[1]), qm[1] - (b * pm[0] + a * pm[1])];
}

async function embed(img, face) {
  const { rec } = await load();
  const [a, b, tx, ty] = similarity(REF, face.pts); // 112-template coords → source image coords
  const S = 112, plane = S * S;
  const input = new Float32Array(3 * plane);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const sx = a * x - b * y + tx, sy = b * x + a * y + ty;
      const i = y * S + x;
      input[i] = sample(img, sx, sy, 0);             // R
      input[plane + i] = sample(img, sx, sy, 1);     // G
      input[2 * plane + i] = sample(img, sx, sy, 2); // B
    }
  }
  const out = await rec.run({ data: new ort.Tensor("float32", input, [1, 3, S, S]) });
  const v = Float32Array.from(out.fc1.data);
  const norm = Math.hypot(...v) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  input.fill(0);
  return v;
}

/** Photo (JPEG data URL) → { embedding, quality } or throws FaceQualityError with a message for the employee. */
async function analyse(dataUrl) {
  const img = decodeDataUrl(dataUrl);
  const faces = await detect(img);
  const q = quality(img, faces);
  const embedding = await embed(img, q.face);
  img.data.fill(0);
  return { embedding, quality: q.quality };
}

const cosine = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const matchThreshold = () => Number(process.env.FACE_MATCH_THRESHOLD) || 0.4;

module.exports = { analyse, cosine, matchThreshold, FaceQualityError, MODEL_VERSION, load };
