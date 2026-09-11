#!/usr/bin/env node
/**
 * Empirical Challenger Verification Oracle for Milestone 1
 *
 * Rigorously tests:
 * 1. Lossless (VP8L) Bit-Exact Reproduction across complex alpha patterns
 * 2. Lossy (VP8) Monotonic Compression Scaling & Ratios at Q=10, 30, 50, 80, 95
 * 3. Standard WebP Decoder Conformance (Google libwebp via Pillow & Browser createImageBitmap via Obscura)
 * 4. Dual-Module bitstream integrity (Scalar & SIMD)
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BrowserClient } from './e2e/browser-client.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const SCALAR_WASM_PATH = path.join(ROOT_DIR, 'web', 'public', 'wasm', 'webp_engine_scalar.wasm');
const SIMD_WASM_PATH = path.join(ROOT_DIR, 'web', 'public', 'wasm', 'webp_engine_simd.wasm');
const PYTHON_PATH = 'D:\\DevEnv\\Python\\python.exe';
const TEMP_WEBP_PATH = path.join(__dirname, 'temp_oracle_test.webp');

// Helper to instantiate WASM
function initWasm(wasmPath) {
  const bytes = fs.readFileSync(wasmPath);
  const mod = new WebAssembly.Module(bytes);
  const instance = new WebAssembly.Instance(mod);
  return {
    rawBytes: bytes,
    instance,
    exports: instance.exports,
    memory: instance.exports.memory
  };
}

function wasmEncodeLossless(wasm, width, height, rgbaBuffer) {
  const { alloc_buffer, free_buffer, encode_lossless_webp, memory } = wasm.exports;
  const inLen = width * height * 4;
  const inPtr = alloc_buffer(inLen);
  const metaPtr = alloc_buffer(8);

  const mem8 = new Uint8Array(memory.buffer);
  mem8.set(rgbaBuffer, inPtr);

  const status = encode_lossless_webp(inPtr, width, height, metaPtr, metaPtr + 4);
  const dv = new DataView(memory.buffer);
  const outPtr = dv.getUint32(metaPtr, true);
  const outLen = dv.getUint32(metaPtr + 4, true);

  let outBytes = null;
  if (status === 0 && outPtr !== 0 && outLen > 0) {
    outBytes = Buffer.from(new Uint8Array(memory.buffer, outPtr, outLen));
  }

  free_buffer(inPtr, inLen);
  free_buffer(metaPtr, 8);
  if (status === 0 && outPtr !== 0 && outLen > 0) {
    free_buffer(outPtr, outLen);
  }

  return { status, bytes: outBytes };
}

function wasmEncodeLossy(wasm, width, height, quality, rgbaBuffer) {
  const { alloc_buffer, free_buffer, encode_lossy_webp, memory } = wasm.exports;
  const inLen = width * height * 4;
  const inPtr = alloc_buffer(inLen);
  const metaPtr = alloc_buffer(8);

  const mem8 = new Uint8Array(memory.buffer);
  mem8.set(rgbaBuffer, inPtr);

  const status = encode_lossy_webp(inPtr, width, height, quality, metaPtr, metaPtr + 4);
  const dv = new DataView(memory.buffer);
  const outPtr = dv.getUint32(metaPtr, true);
  const outLen = dv.getUint32(metaPtr + 4, true);

  let outBytes = null;
  if (status === 0 && outPtr !== 0 && outLen > 0) {
    outBytes = Buffer.from(new Uint8Array(memory.buffer, outPtr, outLen));
  }

  free_buffer(inPtr, inLen);
  free_buffer(metaPtr, 8);
  if (status === 0 && outPtr !== 0 && outLen > 0) {
    free_buffer(outPtr, outLen);
  }

  return { status, bytes: outBytes };
}

// Decode WebP with Python Pillow (Google libwebp) and compare with input RGBA
function decodeAndCompareWithPillow(webpBytes, origRgba, width, height) {
  fs.writeFileSync(TEMP_WEBP_PATH, webpBytes);

  const pyCode = `
import sys, os
from PIL import Image
try:
    im = Image.open('${TEMP_WEBP_PATH.replace(/\\/g, '/')}')
    w, h = im.size
    mode = im.mode
    im_rgba = im.convert('RGBA')
    raw_bytes = im_rgba.tobytes()
    sys.stdout.buffer.write(b'OK:' + len(raw_bytes).to_bytes(4, 'big') + raw_bytes)
except Exception as e:
    sys.stderr.write(f'ERROR: {str(e)}')
    sys.exit(1)
`;

  const res = spawnSync(PYTHON_PATH, ['-c', pyCode], { maxBuffer: 32 * 1024 * 1024 });
  if (fs.existsSync(TEMP_WEBP_PATH)) {
    fs.unlinkSync(TEMP_WEBP_PATH);
  }

  if (res.status !== 0) {
    return {
      success: false,
      error: res.stderr.toString() || 'Pillow decoding failed'
    };
  }

  const outBuf = res.stdout;
  if (!outBuf.subarray(0, 3).equals(Buffer.from('OK:'))) {
    return { success: false, error: 'Unexpected Python stdout' };
  }

  const byteLen = outBuf.readUInt32BE(3);
  const decodedPixels = outBuf.subarray(7, 7 + byteLen);

  if (origRgba) {
    let mismatches = 0;
    let maxDiff = 0;
    const totalPixels = width * height;
    for (let i = 0; i < decodedPixels.length; i++) {
      const diff = Math.abs(decodedPixels[i] - origRgba[i]);
      if (diff > 0) {
        mismatches++;
        if (diff > maxDiff) maxDiff = diff;
      }
    }

    return {
      success: true,
      decodedLen: decodedPixels.length,
      totalPixels,
      mismatches,
      maxDiff,
      exactMatchRate: ((decodedPixels.length - mismatches) / decodedPixels.length) * 100
    };
  }

  return {
    success: true,
    decodedLen: decodedPixels.length
  };
}

// Generate test RGBA patterns
function generatePatterns() {
  const patterns = {};

  // Pattern 1: Translucent gradient (64x64)
  {
    const w = 64, h = 64;
    const buf = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        buf[idx] = (x * 4) % 256;             // R
        buf[idx + 1] = (y * 4) % 256;         // G
        buf[idx + 2] = ((x + y) * 2) % 256;   // B
        buf[idx + 3] = Math.round((x * 255) / (w - 1)); // Alpha: smooth 0 to 255
      }
    }
    patterns.translucentGradient = { w, h, buf, name: 'Translucent Gradient (64x64, Alpha 0->255)' };
  }

  // Pattern 2: Checkerboard alpha (32x32)
  {
    const w = 32, h = 32;
    const buf = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const isCheck = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0;
        buf[idx] = isCheck ? 200 : 30;
        buf[idx + 1] = isCheck ? 50 : 220;
        buf[idx + 2] = isCheck ? 120 : 80;
        buf[idx + 3] = isCheck ? 37 : 219; // Semi-transparent values
      }
    }
    patterns.checkerboardAlpha = { w, h, buf, name: 'Checkerboard Alpha (32x32, A=37 vs A=219)' };
  }

  // Pattern 3: Completely transparent pixels with non-zero RGB (32x32)
  {
    const w = 32, h = 32;
    const buf = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        if (x % 2 === 0) {
          // Completely transparent (A=0) but with rich RGB color
          buf[idx] = 255;
          buf[idx + 1] = 128;
          buf[idx + 2] = 64;
          buf[idx + 3] = 0;
        } else {
          // Fully opaque (A=255) with dark color
          buf[idx] = 10;
          buf[idx + 1] = 20;
          buf[idx + 2] = 30;
          buf[idx + 3] = 255;
        }
      }
    }
    patterns.transparentWithRgb = { w, h, buf, name: 'Transparent Pixels with Non-Zero RGB (A=0, RGB!=0)' };
  }

  // Pattern 4: High-Entropy Pseudo-Random Noise (48x48)
  {
    const w = 48, h = 48;
    const buf = new Uint8Array(w * h * 4);
    let seed = 123456789;
    function prng() {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed >> 16;
    }
    for (let i = 0; i < buf.length; i++) {
      buf[i] = prng() % 256;
    }
    patterns.pseudoRandomNoise = { w, h, buf, name: 'High-Entropy Pseudo-Random Noise (48x48)' };
  }

  // Pattern 5: Odd & Prime Dimensions (17x31)
  {
    const w = 17, h = 31;
    const buf = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        buf[idx] = (x * 15) % 256;
        buf[idx + 1] = (y * 8) % 256;
        buf[idx + 2] = 180;
        buf[idx + 3] = ((x + y) * 11) % 256;
      }
    }
    patterns.oddDimensions = { w, h, buf, name: 'Odd & Prime Dimensions (17x31)' };
  }

  // Pattern 6: Single Pixel (1x1)
  {
    const w = 1, h = 1;
    const buf = new Uint8Array([42, 137, 219, 99]);
    patterns.singlePixel = { w, h, buf, name: 'Single Pixel Boundary (1x1 RGBA)' };
  }

  return patterns;
}

// Load photo fixture pixels
function loadPhotoFixture() {
  const photoPath = path.join(ROOT_DIR, 'tests', 'fixtures', 'photo_sample_128x128.png');
  const pyCode = `
import sys
from PIL import Image
im = Image.open('${photoPath.replace(/\\/g, '/')}')
im = im.convert('RGBA')
sys.stdout.buffer.write(im.tobytes())
`;
  const res = spawnSync(PYTHON_PATH, ['-c', pyCode], { maxBuffer: 16 * 1024 * 1024 });
  if (res.status !== 0) {
    throw new Error('Failed to load photo fixture: ' + res.stderr.toString());
  }
  return {
    w: 128,
    h: 128,
    buf: new Uint8Array(res.stdout),
    name: 'Real-World Continuous-Tone Photo (128x128)'
  };
}

// Bitstream RIFF/WebP validation
function validateRiffHeader(bytes, expectedChunk) {
  if (bytes.length < 16) return { valid: false, reason: 'Buffer < 16 bytes' };
  const riff = bytes.subarray(0, 4).toString('ascii');
  const size = bytes.readUInt32LE(4);
  const webp = bytes.subarray(8, 12).toString('ascii');
  const chunk = bytes.subarray(12, 16).toString('ascii');

  if (riff !== 'RIFF') return { valid: false, reason: `RIFF magic mismatch: got ${riff}` };
  if (webp !== 'WEBP') return { valid: false, reason: `WEBP magic mismatch: got ${webp}` };
  if (expectedChunk && chunk !== expectedChunk) {
    return { valid: false, reason: `Chunk mismatch: expected ${expectedChunk}, got ${chunk}` };
  }
  if (size !== bytes.length - 8) {
    return { valid: false, reason: `RIFF length mismatch: header says ${size}, actual ${bytes.length - 8}` };
  }

  // VP8L signature check: byte 20 must be 0x2F
  if (expectedChunk === 'VP8L') {
    const sig = bytes[20];
    if (sig !== 0x2f) {
      return { valid: false, reason: `VP8L signature byte mismatch: expected 0x2F, got 0x${sig.toString(16)}` };
    }
  }

  return { valid: true, riff, size, webp, chunk };
}

async function runChallengerTests() {
  console.log('========================================================================');
  console.log('       EMPIRICAL CHALLENGER VERIFICATION HARNESS (MILESTONE 1)          ');
  console.log('========================================================================\n');

  const report = {
    timestamp: new Date().toISOString(),
    binaryAudit: {},
    losslessTests: [],
    lossyTests: [],
    lossyEdgeTests: [],
    browserTests: [],
    allPassed: true
  };

  // 1. WASM Binary Audit
  console.log('--- SECTION 1: WASM Binary Size & Budget Audit ---');
  const modules = [
    { name: 'Scalar Module', path: SCALAR_WASM_PATH, wasm: initWasm(SCALAR_WASM_PATH) },
    { name: 'SIMD Module', path: SIMD_WASM_PATH, wasm: initWasm(SIMD_WASM_PATH) }
  ];

  for (const m of modules) {
    const rawSize = m.wasm.rawBytes.length;
    const gzipSize = zlib.gzipSync(m.wasm.rawBytes).length;
    const rawBudgetOk = rawSize < 300 * 1024;
    const gzipBudgetOk = gzipSize < 80 * 1024;
    console.log(`[${m.name}] Raw Size: ${rawSize} B (${(rawSize / 1024).toFixed(2)} KB) [< 300KB: ${rawBudgetOk ? 'PASS' : 'FAIL'}]`);
    console.log(`[${m.name}] Gzip Size: ${gzipSize} B (${(gzipSize / 1024).toFixed(2)} KB) [< 80KB: ${gzipBudgetOk ? 'PASS' : 'FAIL'}]`);

    report.binaryAudit[m.name] = { rawSize, gzipSize, rawBudgetOk, gzipBudgetOk };
    if (!rawBudgetOk || !gzipBudgetOk) report.allPassed = false;
  }
  console.log('');

  // Generate synthetic patterns
  const patterns = generatePatterns();
  const photoFixture = loadPhotoFixture();

  // 2. Lossless (VP8L) Bit-Exact Verification
  console.log('--- SECTION 2: Lossless (VP8L) Bit-Exact Reproduction & Header Verification ---');
  for (const m of modules) {
    console.log(`\nTesting on [${m.name}]:`);
    for (const [key, pat] of Object.entries(patterns)) {
      const { status, bytes } = wasmEncodeLossless(m.wasm, pat.w, pat.h, pat.buf);
      if (status !== 0 || !bytes) {
        console.error(`  [FAIL] ${pat.name}: Encoding failed with status ${status}`);
        report.losslessTests.push({ module: m.name, pattern: pat.name, status, passed: false });
        report.allPassed = false;
        continue;
      }

      // Check header
      const headerCheck = validateRiffHeader(bytes, 'VP8L');
      if (!headerCheck.valid) {
        console.error(`  [FAIL] ${pat.name}: Header invalid: ${headerCheck.reason}`);
        report.losslessTests.push({ module: m.name, pattern: pat.name, headerCheck, passed: false });
        report.allPassed = false;
        continue;
      }

      // Decode with Pillow libwebp and check bit-exact equality
      const cmp = decodeAndCompareWithPillow(bytes, pat.buf, pat.w, pat.h);
      if (!cmp.success || cmp.mismatches > 0 || cmp.maxDiff > 0) {
        console.error(`  [FAIL] ${pat.name}: Distortion detected! Mismatches: ${cmp.mismatches}, MaxDiff: ${cmp.maxDiff}`);
        report.losslessTests.push({ module: m.name, pattern: pat.name, cmp, passed: false });
        report.allPassed = false;
      } else {
        const rawBytes = pat.w * pat.h * 4;
        const reduction = ((1 - bytes.length / rawBytes) * 100).toFixed(1);
        console.log(`  [PASS] ${pat.name}: 100% BIT-EXACT (0 distortion, MaxDiff=0). Size: ${bytes.length} B vs Raw ${rawBytes} B (${reduction}% reduction).`);
        report.losslessTests.push({
          module: m.name,
          pattern: pat.name,
          rawBytes,
          compressedBytes: bytes.length,
          mismatches: 0,
          maxDiff: 0,
          exactMatchRate: 100.0,
          passed: true
        });
      }
    }
  }
  console.log('');

  // 3. Lossy (VP8) Compression & Monotonicity Verification
  console.log('--- SECTION 3: Lossy (VP8) Monotonicity & Compression Scaling ---');
  const lossyQualities = [10.0, 30.0, 50.0, 80.0, 95.0];
  const lossyTargets = [
    photoFixture,
    patterns.translucentGradient,
    patterns.checkerboardAlpha
  ];

  for (const m of modules) {
    console.log(`\nTesting on [${m.name}]:`);
    for (const target of lossyTargets) {
      console.log(`  Image: ${target.name}`);
      const rawBytes = target.w * target.h * 4;
      const results = [];
      let strictlyMonotonic = true;

      for (const q of lossyQualities) {
        const { status, bytes } = wasmEncodeLossy(m.wasm, target.w, target.h, q, target.buf);
        if (status !== 0 || !bytes) {
          console.error(`    [FAIL] Q=${q}: Encoding failed with status ${status}`);
          strictlyMonotonic = false;
          break;
        }

        // Validate decoding with libwebp
        const dec = decodeAndCompareWithPillow(bytes, null, target.w, target.h);
        if (!dec.success) {
          console.error(`    [FAIL] Q=${q}: libwebp decoding failed: ${dec.error}`);
          strictlyMonotonic = false;
          break;
        }

        const reduction = ((1 - bytes.length / rawBytes) * 100).toFixed(2);
        const header = validateRiffHeader(bytes, null);
        results.push({ quality: q, size: bytes.length, reduction, chunk: header.chunk });
        console.log(`    Q=${String(q).padEnd(4)} -> WebP Size: ${String(bytes.length).padStart(6)} B | Reduction: ${reduction}% | Chunk: ${header.chunk}`);
      }

      // Verify monotonicity: size at q_i <= size at q_{i+1}
      for (let i = 0; i < results.length - 1; i++) {
        if (results[i].size > results[i + 1].size) {
          strictlyMonotonic = false;
          console.error(`    [FAIL] Non-monotonic scaling: Q=${results[i].quality} (${results[i].size}B) > Q=${results[i + 1].quality} (${results[i + 1].size}B)`);
        }
      }

      // Check compression ratio range (at Q=80, expect 40%-80%+ reduction)
      const q80 = results.find(r => r.quality === 80.0);
      const ratioAcceptable = q80 && parseFloat(q80.reduction) >= 35.0; // Allow 35%+ on small textures, usually 70-85%

      const targetPassed = strictlyMonotonic && ratioAcceptable;
      if (targetPassed) {
        console.log(`    -> Monotonicity: PASS | Compression Scaling: PASS\n`);
      } else {
        console.error(`    -> Monotonicity or Compression Scaling: FAIL\n`);
        report.allPassed = false;
      }

      report.lossyTests.push({
        module: m.name,
        target: target.name,
        results,
        strictlyMonotonic,
        ratioAcceptable,
        passed: targetPassed
      });
    }
  }

  // 4. Edge Quality & Error Boundary Validation
  console.log('--- SECTION 4: Lossy Edge Quality & Error Boundaries ---');
  const edgeCases = [
    { q: 1.0, shouldSucceed: true, label: 'Minimum Quality Q=1.0' },
    { q: 100.0, shouldSucceed: true, label: 'Maximum Quality Q=100.0' },
    { q: 0.9, shouldSucceed: false, expectedCode: -3, label: 'Below Minimum Q=0.9 (ERR_INVALID_QUALITY -3)' },
    { q: 100.1, shouldSucceed: false, expectedCode: -3, label: 'Above Maximum Q=100.1 (ERR_INVALID_QUALITY -3)' },
    { q: NaN, shouldSucceed: false, expectedCode: -3, label: 'Invalid NaN (ERR_INVALID_QUALITY -3)' }
  ];

  const primaryWasm = modules[1].wasm; // SIMD
  for (const ec of edgeCases) {
    const { status, bytes } = wasmEncodeLossy(primaryWasm, 16, 16, ec.q, patterns.translucentGradient.buf.subarray(0, 16 * 16 * 4));
    let passed = false;
    if (ec.shouldSucceed) {
      passed = status === 0 && bytes && bytes.length > 0;
      console.log(`  [${passed ? 'PASS' : 'FAIL'}] ${ec.label}: status=${status}, size=${bytes ? bytes.length : 0}`);
    } else {
      passed = status === ec.expectedCode;
      console.log(`  [${passed ? 'PASS' : 'FAIL'}] ${ec.label}: returned code=${status} (expected ${ec.expectedCode})`);
    }
    if (!passed) report.allPassed = false;
    report.lossyEdgeTests.push({ label: ec.label, passed });
  }
  console.log('');

  // 5. Standard WebP Decoder Conformance: Browser (Obscura)
  console.log('--- SECTION 5: Standard WebP Decoder Conformance (Browser createImageBitmap) ---');
  let browserClient = null;
  try {
    browserClient = new BrowserClient({ browser: 'chrome-headless-shell' });
    await browserClient.launch();
    console.log(`  [OK] Browser online: ${browserClient.activeBrowser}`);

    // Test Lossless sample
    const sampleLossless = wasmEncodeLossless(primaryWasm, patterns.translucentGradient.w, patterns.translucentGradient.h, patterns.translucentGradient.buf);
    const b64Lossless = sampleLossless.bytes.toString('base64');
    const resLossless = await browserClient.evaluate(`
      (async () => {
        const bin = atob('${b64Lossless}');
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        const blob = new Blob([u8], { type: 'image/webp' });
        const bmp = await createImageBitmap(blob);
        return { width: bmp.width, height: bmp.height, ok: bmp.width === 64 && bmp.height === 64 };
      })()
    `);

    console.log(`  [${resLossless.ok ? 'PASS' : 'FAIL'}] Browser Lossless VP8L Decode: Decoded ${resLossless.width}x${resLossless.height} ImageBitmap`);
    if (!resLossless.ok) report.allPassed = false;
    report.browserTests.push({ test: 'Lossless VP8L createImageBitmap', result: resLossless });

    // Test Lossy sample
    const sampleLossy = wasmEncodeLossy(primaryWasm, photoFixture.w, photoFixture.h, 75.0, photoFixture.buf);
    const b64Lossy = sampleLossy.bytes.toString('base64');
    const resLossy = await browserClient.evaluate(`
      (async () => {
        try {
          const bin = atob('${b64Lossy}');
          const u8 = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
          const blob = new Blob([u8], { type: 'image/webp' });
          const bmp = await createImageBitmap(blob);
          return { width: bmp.width, height: bmp.height, ok: bmp.width === 128 && bmp.height === 128 };
        } catch (err) {
          return { width: 0, height: 0, ok: false, error: err.toString() };
        }
      })()
    `);

    console.log(`  [${resLossy.ok ? 'PASS' : 'FAIL'}] Browser Lossy VP8 Decode: ${resLossy.ok ? 'Decoded ' + resLossy.width + 'x' + resLossy.height + ' ImageBitmap' : resLossy.error}`);
    if (!resLossy.ok) report.allPassed = false;
    report.browserTests.push({ test: 'Lossy VP8 createImageBitmap', result: resLossy });

  } catch (err) {
    console.error(`  [FAIL] Browser testing error: ${err.message}`);
    report.allPassed = false;
  } finally {
    if (browserClient) {
      await browserClient.close();
    }
  }

  // Verdict
  console.log('\n========================================================================');
  console.log(` FINAL EMPIRICAL VERDICT: ${report.allPassed ? 'APPROVE' : 'REJECT'}`);
  console.log('========================================================================\n');

  // Save report JSON to challenger folder
  fs.writeFileSync(path.join(ROOT_DIR, '.agents', 'challenger_m1_2', 'oracle_results.json'), JSON.stringify(report, null, 2));

  process.exit(report.allPassed ? 0 : 1);
}

runChallengerTests().catch(err => {
  console.error('Fatal error in challenger test runner:', err);
  process.exit(1);
});
