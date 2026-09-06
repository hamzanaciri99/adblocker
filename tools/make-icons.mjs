// Generate the extension icons.
//
// A tiny PNG encoder beats committing binaries we cannot diff, and keeps the
// repo buildable with nothing but Node.

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const SIZES = [16, 32, 48, 128];
const SUPERSAMPLE = 4;

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crcInput = Buffer.concat([head.subarray(4), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([head, data, tail]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;   // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// A prohibition sign: readable at 16px, neutral enough not to look like a brand.
const RING = [0xe9, 0xe9, 0xef];
const DISC = [0x22, 0x23, 0x2b];

function sample(x, y, size) {
  const cx = size / 2;
  const cy = size / 2;
  const dx = x - cx;
  const dy = y - cy;
  const dist = Math.hypot(dx, dy);
  const outer = size * 0.46;
  const inner = size * 0.33;

  if (dist > outer) return null;
  if (dist > inner) return RING;

  // The diagonal stroke, rotated 45 degrees through the centre.
  const along = (dx + dy) / Math.SQRT2;
  if (Math.abs(along) < size * 0.065) return RING;
  return DISC;
}

mkdirSync('assets/icons', { recursive: true });

for (const size of SIZES) {
  const buf = Buffer.alloc(size * size * 4);
  const step = 1 / SUPERSAMPLE;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0, hits = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const colour = sample(x + (sx + 0.5) * step, y + (sy + 0.5) * step, size);
          hits++;
          if (colour) { r += colour[0]; g += colour[1]; b += colour[2]; a += 255; }
        }
      }
      const i = (y * size + x) * 4;
      const covered = a / 255;
      buf[i] = covered ? Math.round(r / covered) : 0;
      buf[i + 1] = covered ? Math.round(g / covered) : 0;
      buf[i + 2] = covered ? Math.round(b / covered) : 0;
      buf[i + 3] = Math.round(a / hits);
    }
  }

  writeFileSync(`assets/icons/icon-${size}.png`, encodePng(size, buf));
}

console.log(`wrote ${SIZES.length} icons`);
