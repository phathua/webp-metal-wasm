import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Standard CRC32 calculation for PNG chunks
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function makePngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);

  const crcTarget = Buffer.concat([typeBuf, data]);
  const crcVal = crc32(crcTarget);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crcVal, 0);

  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

export function createPng(width, height, rgbaBuffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth: 8
  ihdr[9] = 6; // color type: 6 (RGBA)
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const ihdrChunk = makePngChunk('IHDR', ihdr);

  // Scanlines with filter byte 0 (None)
  const rowStride = width * 4;
  const rawScanlines = Buffer.alloc((1 + rowStride) * height);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + rowStride);
    rawScanlines[rowOffset] = 0; // Filter: None
    rgbaBuffer.copy(rawScanlines, rowOffset + 1, y * rowStride, (y + 1) * rowStride);
  }

  const compressed = zlib.deflateSync(rawScanlines);
  const idatChunk = makePngChunk('IDAT', compressed);
  const iendChunk = makePngChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

export function generateAllFixtures(outputDir = __dirname) {
  fs.mkdirSync(outputDir, { recursive: true });

  const metadata = {};

  // 1. Solid Red 1x1
  {
    const w = 1, h = 1;
    const rgba = Buffer.from([255, 0, 0, 255]);
    const png = createPng(w, h, rgba);
    const outPath = path.join(outputDir, 'solid_1x1.png');
    fs.writeFileSync(outPath, png);
    metadata['solid_1x1'] = {
      file: 'solid_1x1.png',
      width: w,
      height: h,
      hasAlpha: false,
      rawRgba: Array.from(rgba)
    };
  }

  // 2. Transparent 1x1
  {
    const w = 1, h = 1;
    const rgba = Buffer.from([0, 0, 0, 0]);
    const png = createPng(w, h, rgba);
    const outPath = path.join(outputDir, 'transparent_1x1.png');
    fs.writeFileSync(outPath, png);
    metadata['transparent_1x1'] = {
      file: 'transparent_1x1.png',
      width: w,
      height: h,
      hasAlpha: true,
      rawRgba: Array.from(rgba)
    };
  }

  // 3. Alpha Gradient 64x64
  {
    const w = 64, h = 64;
    const rgba = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        rgba[idx] = Math.floor((x / w) * 255); // R
        rgba[idx + 1] = Math.floor((y / h) * 255); // G
        rgba[idx + 2] = 128; // B
        rgba[idx + 3] = Math.floor(((x + y) / (w + h)) * 255); // A
      }
    }
    const png = createPng(w, h, rgba);
    const outPath = path.join(outputDir, 'alpha_gradient_64x64.png');
    fs.writeFileSync(outPath, png);
    metadata['alpha_gradient_64x64'] = {
      file: 'alpha_gradient_64x64.png',
      width: w,
      height: h,
      hasAlpha: true,
      samplePixel: [rgba[0], rgba[1], rgba[2], rgba[3]]
    };
  }

  // 4. Photo Sample 128x128 (High frequency color pattern simulating photo)
  {
    const w = 128, h = 128;
    const rgba = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        rgba[idx] = Math.floor(Math.sin(x * 0.1) * 127 + 128);
        rgba[idx + 1] = Math.floor(Math.cos(y * 0.1) * 127 + 128);
        rgba[idx + 2] = Math.floor(Math.sin((x + y) * 0.05) * 127 + 128);
        rgba[idx + 3] = 255;
      }
    }
    const png = createPng(w, h, rgba);
    const outPath = path.join(outputDir, 'photo_sample_128x128.png');
    fs.writeFileSync(outPath, png);
    metadata['photo_sample_128x128'] = {
      file: 'photo_sample_128x128.png',
      width: w,
      height: h,
      hasAlpha: false
    };
  }

  // 5. Corrupt Truncated WebP/RIFF
  {
    const corrupt = Buffer.from('RIFF\x20\x00\x00\x00WEBPVP8 '); // Truncated header
    const outPath = path.join(outputDir, 'corrupt_truncated.bin');
    fs.writeFileSync(outPath, corrupt);
    metadata['corrupt_truncated'] = {
      file: 'corrupt_truncated.bin',
      bytes: corrupt.length
    };
  }

  // 6. Corrupt Random High-Entropy Noise
  {
    const randomBytes = Buffer.alloc(1024);
    for (let i = 0; i < randomBytes.length; i++) {
      randomBytes[i] = Math.floor(Math.random() * 256);
    }
    const outPath = path.join(outputDir, 'corrupt_random.bin');
    fs.writeFileSync(outPath, randomBytes);
    metadata['corrupt_random'] = {
      file: 'corrupt_random.bin',
      bytes: randomBytes.length
    };
  }

  // 7. Mock EXIF Metadata Container
  {
    // Minimal TIFF / EXIF header with Orientation = 6 (Rotate 90 CW)
    const exifHeader = Buffer.from([
      0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
      0x49, 0x49, 0x2A, 0x00,             // Little endian TIFF
      0x08, 0x00, 0x00, 0x00,             // Offset to 0th IFD
      0x01, 0x00,                         // Number of IFD entries = 1
      0x12, 0x01,                         // Tag: Orientation (0x0112)
      0x03, 0x00,                         // Type: SHORT (3)
      0x01, 0x00, 0x00, 0x00,             // Count: 1
      0x06, 0x00, 0x00, 0x00,             // Value: 6 (Rotate 90 CW)
      0x00, 0x00, 0x00, 0x00              // Next IFD offset = 0
    ]);
    const outPath = path.join(outputDir, 'exif_rotated_mock.bin');
    fs.writeFileSync(outPath, exifHeader);
    metadata['exif_rotated_mock'] = {
      file: 'exif_rotated_mock.bin',
      orientation: 6
    };
  }

  // Write metadata json
  fs.writeFileSync(path.join(outputDir, 'fixtures.json'), JSON.stringify(metadata, null, 2));
  console.log(`Generated ${Object.keys(metadata).length} fixtures in ${outputDir}`);
  return metadata;
}

// Auto-run if executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generateAllFixtures();
}
