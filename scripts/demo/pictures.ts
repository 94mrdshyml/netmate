// Small flat-colour pictures for the demo posts, drawn here so the seed needs no files and no network.
// DEV AND TEST ONLY (docs/PRD.md, "Demo data").

import { deflateSync } from "node:zlib";

export type Scene = "hills" | "skyline" | "sunset" | "mountains" | "stilllife" | "stripes";
export const SCENES: Scene[] = ["hills", "skyline", "sunset", "mountains", "stilllife", "stripes"];

type Rgb = [number, number, number];
type Palette = [Rgb, Rgb, Rgb, Rgb, Rgb, Rgb];

const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) c = TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

/** A tiny pixel board: flat shapes only, no gradients. */
class Board {
  readonly pixels: Uint8Array;
  constructor(
    readonly width: number,
    readonly height: number,
    background: Rgb,
  ) {
    this.pixels = new Uint8Array(width * height * 3);
    this.rect(0, 0, width, height, background);
  }

  private set(x: number, y: number, [r, g, b]: Rgb) {
    const i = (y * this.width + x) * 3;
    this.pixels[i] = r;
    this.pixels[i + 1] = g;
    this.pixels[i + 2] = b;
  }

  rect(x: number, y: number, w: number, h: number, color: Rgb) {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width, Math.ceil(x + w));
    const y1 = Math.min(this.height, Math.ceil(y + h));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.set(xx, yy, color);
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, color: Rgb) {
    const x0 = Math.max(0, Math.floor(cx - rx));
    const x1 = Math.min(this.width - 1, Math.ceil(cx + rx));
    const y0 = Math.max(0, Math.floor(cy - ry));
    const y1 = Math.min(this.height - 1, Math.ceil(cy + ry));
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const dx = (xx - cx) / rx;
        const dy = (yy - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(xx, yy, color);
      }
    }
  }

  triangle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, color: Rgb) {
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const x1 = Math.min(this.width - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const y1 = Math.min(this.height - 1, Math.ceil(Math.max(ay, by, cy)));
    const side = (px: number, py: number, qx: number, qy: number, x: number, y: number) => (x - qx) * (py - qy) - (px - qx) * (y - qy);
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const d1 = side(ax, ay, bx, by, xx, yy);
        const d2 = side(bx, by, cx, cy, xx, yy);
        const d3 = side(cx, cy, ax, ay, xx, yy);
        const neg = d1 < 0 || d2 < 0 || d3 < 0;
        const pos = d1 > 0 || d2 > 0 || d3 > 0;
        if (!(neg && pos)) this.set(xx, yy, color);
      }
    }
  }

  png(): Buffer {
    const stride = 1 + this.width * 3;
    const raw = Buffer.alloc(stride * this.height);
    for (let y = 0; y < this.height; y++) {
      raw[y * stride] = 0;
      raw.set(this.pixels.subarray(y * this.width * 3, (y + 1) * this.width * 3), y * stride + 1);
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(this.width, 0);
    header.writeUInt32BE(this.height, 4);
    header.set([8, 2, 0, 0, 0], 8);
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  }
}

// Each palette is [sky, sun or moon, far, middle, near, accent]. A picture takes one by its number.
const PALETTES: Palette[] = [
  [[196, 224, 240], [255, 222, 120], [140, 188, 160], [88, 150, 112], [52, 108, 80], [226, 120, 90]],
  [[250, 214, 186], [255, 244, 214], [214, 150, 140], [160, 104, 120], [96, 70, 100], [250, 180, 80]],
  [[30, 40, 78], [244, 240, 214], [52, 66, 112], [38, 50, 92], [22, 30, 64], [250, 214, 120]],
  [[220, 232, 210], [250, 236, 160], [168, 196, 160], [116, 160, 132], [70, 112, 96], [214, 96, 96]],
  [[238, 226, 210], [250, 200, 120], [200, 170, 140], [156, 120, 100], [104, 78, 70], [90, 140, 150]],
  [[206, 218, 244], [255, 250, 232], [150, 164, 214], [104, 118, 176], [66, 78, 134], [240, 170, 110]],
];

/** A picture of the given scene, `width` by `height`, coloured by palette number `n`. Always the same bytes for the same input. */
export function scenePicture(scene: Scene, n: number, width = 960, height = 640): Buffer {
  const [sky, sun, far, mid, near, accent] = PALETTES[Math.abs(n) % PALETTES.length]!;
  const w = width;
  const h = height;
  const b = new Board(w, h, sky);
  switch (scene) {
    case "hills": {
      b.ellipse(w * 0.76, h * 0.26, h * 0.11, h * 0.11, sun);
      b.ellipse(w * 0.25, h * 0.95, w * 0.5, h * 0.42, far);
      b.ellipse(w * 0.8, h * 1.0, w * 0.55, h * 0.4, mid);
      b.ellipse(w * 0.45, h * 1.12, w * 0.6, h * 0.38, near);
      for (const [tx, ty] of [[0.2, 0.72], [0.62, 0.76], [0.86, 0.7]] as const) {
        b.rect(w * tx - 4, h * ty, 8, h * 0.1, accent);
        b.ellipse(w * tx, h * ty, h * 0.05, h * 0.07, near);
      }
      break;
    }
    case "skyline": {
      b.ellipse(w * 0.78, h * 0.2, h * 0.08, h * 0.08, sun);
      const widths = [0.12, 0.09, 0.14, 0.1, 0.13, 0.08, 0.12, 0.11, 0.11];
      const heights = [0.45, 0.62, 0.38, 0.7, 0.5, 0.58, 0.42, 0.66, 0.36];
      let x = 0;
      widths.forEach((bw, i) => {
        const top = h * (1 - heights[i]!);
        const color = i % 2 === 0 ? mid : near;
        b.rect(x * w, top, bw * w + 1, h - top, color);
        for (let wy = top + 16; wy < h - 20; wy += 28) {
          for (let wx = x * w + 10; wx < (x + bw) * w - 14; wx += 22) if ((Math.floor(wy / 28) + Math.floor(wx / 22) + i) % 3 !== 0) b.rect(wx, wy, 8, 12, accent);
        }
        x += bw;
      });
      break;
    }
    case "sunset": {
      const horizon = h * 0.62;
      // The sun is a full circle, then the sea covers its lower half.
      b.ellipse(w * 0.5, horizon, h * 0.2, h * 0.2, sun);
      b.rect(0, horizon, w, h - horizon, mid);
      for (let i = 0; i < 6; i++) b.rect(w * (0.32 + i * 0.01), horizon + 14 + i * 26, w * (0.36 - i * 0.02), 8, i % 2 ? far : sun);
      b.rect(0, h * 0.9, w, h * 0.1, near);
      break;
    }
    case "mountains": {
      b.ellipse(w * 0.2, h * 0.22, h * 0.07, h * 0.07, sun);
      b.triangle(w * 0.1, h * 0.85, w * 0.42, h * 0.3, w * 0.74, h * 0.85, far);
      b.triangle(w * 0.4, h * 0.85, w * 0.7, h * 0.2, w * 1.0, h * 0.85, mid);
      b.triangle(w * 0.62, h * 0.38, w * 0.7, h * 0.2, w * 0.78, h * 0.38, sun);
      b.rect(0, h * 0.82, w, h * 0.18, near);
      b.triangle(w * 0.08, h * 0.9, w * 0.14, h * 0.7, w * 0.2, h * 0.9, accent);
      break;
    }
    case "stilllife": {
      b.rect(0, h * 0.64, w, h * 0.36, far);
      b.rect(0, h * 0.62, w, 6, mid);
      b.rect(w * 0.22, h * 0.42, w * 0.2, h * 0.22, near);
      b.ellipse(w * 0.32, h * 0.42, w * 0.1, h * 0.03, mid);
      b.rect(w * 0.42, h * 0.48, w * 0.05, h * 0.1, near);
      b.ellipse(w * 0.64, h * 0.66, w * 0.07, h * 0.05, accent);
      b.ellipse(w * 0.74, h * 0.68, w * 0.06, h * 0.045, sun);
      b.rect(w * 0.8, h * 0.52, w * 0.1, h * 0.12, near);
      for (const [lx, ly, a] of [[0.85, 0.44, 0], [0.82, 0.46, -1], [0.88, 0.46, 1]] as const) b.ellipse(w * (lx + a * 0.02), h * ly, w * 0.02, h * 0.07, mid);
      break;
    }
    case "stripes": {
      const colors = [sky, far, mid, near, accent, sun];
      const bands = 8;
      for (let i = 0; i < bands; i++) b.rect((w / bands) * i, 0, w / bands + 1, h, colors[(i + n) % colors.length]!);
      b.ellipse(w * 0.5, h * 0.5, h * 0.28, h * 0.28, sun);
      b.ellipse(w * 0.5, h * 0.5, h * 0.14, h * 0.14, near);
      break;
    }
  }
  return b.png();
}
