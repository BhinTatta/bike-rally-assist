/**
 * Generates the two binary assets the app needs, so nothing opaque is
 * committed without a way to recreate it:
 *
 *   assets/keepalive.wav - a two-second, near-silent loop. Bluetooth headsets
 *                          power down their receiver after a few seconds of
 *                          silence and then clip the first word of the next
 *                          call; holding this stream open stops that. It is
 *                          dithered noise rather than digital silence, because
 *                          some headsets treat pure silence as no stream.
 *   assets/icon.png      - the launcher icon: a yellow hairpin on near-black.
 *
 * Run with: node tools/make-assets.mjs
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, "..", "apps", "mobile", "assets");
mkdirSync(assets, { recursive: true });

// ---------------------------------------------------------------- keepalive
function makeWav({ seconds = 2, rate = 16000, amplitude = 25 } = {}) {
  const samples = seconds * rate;
  const data = Buffer.alloc(samples * 2);
  // A deterministic LCG, so rebuilding the asset gives an identical file.
  let seed = 12345;
  for (let i = 0; i < samples; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const noise = ((seed % 2001) - 1000) / 1000; // -1..1
    // ~ -62 dBFS: below the threshold of hearing at any sane volume, but a
    // real signal as far as the headset is concerned.
    data.writeInt16LE(Math.round(noise * amplitude), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

writeFileSync(join(assets, "keepalive.wav"), makeWav());

// --------------------------------------------------------------------- icon
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Encode RGBA pixels as a PNG. */
function makePng(width, height, pixels) {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Distance from a point to a line segment, in pixels. */
function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function makeIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const s = size / 512; // the shape below is designed at 512 px
  const stroke = 34 * s;

  // A hairpin: up the left leg, round the top, back down the right leg.
  const path = [];
  const legBottom = 430 * s;
  const legTop = 210 * s;
  const leftX = 180 * s;
  const rightX = 332 * s;
  path.push([leftX, legBottom, leftX, legTop]);
  const radius = (rightX - leftX) / 2;
  const cx = (leftX + rightX) / 2;
  for (let i = 0; i < 24; i++) {
    const a0 = Math.PI + (Math.PI * i) / 24;
    const a1 = Math.PI + (Math.PI * (i + 1)) / 24;
    path.push([
      cx + radius * Math.cos(a0),
      legTop + radius * Math.sin(a0),
      cx + radius * Math.cos(a1),
      legTop + radius * Math.sin(a1),
    ]);
  }
  path.push([rightX, legTop, rightX, legBottom]);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let nearest = Infinity;
      for (const [ax, ay, bx, by] of path) {
        nearest = Math.min(nearest, distanceToSegment(x + 0.5, y + 0.5, ax, ay, bx, by));
      }
      // Antialias across one pixel at the stroke edge.
      const coverage = Math.max(0, Math.min(1, stroke / 2 - nearest + 0.5));
      const i = (y * size + x) * 4;
      // #0b0d10 background, #ffd400 stroke.
      pixels[i] = Math.round(0x0b + (0xff - 0x0b) * coverage);
      pixels[i + 1] = Math.round(0x0d + (0xd4 - 0x0d) * coverage);
      pixels[i + 2] = Math.round(0x10 + (0x00 - 0x10) * coverage);
      pixels[i + 3] = 255;
    }
  }
  return makePng(size, size, pixels);
}

writeFileSync(join(assets, "icon.png"), makeIcon(512));
console.log("Wrote apps/mobile/assets/keepalive.wav and icon.png");
