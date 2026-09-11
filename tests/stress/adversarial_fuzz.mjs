/**
 * Adversarial Fuzzing & Stress Testing Harness for Pure-Rust WebP SIMD WASM Engine
 * Milestone 1 Challenger Verification Suite
 */

import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const SCALAR_WASM_PATH = path.resolve('web/public/wasm/webp_engine_scalar.wasm');
const SIMD_WASM_PATH = path.resolve('web/public/wasm/webp_engine_simd.wasm');

// Error Codes defined in lib.rs
const ERR_SUCCESS = 0;
const ERR_NULL_POINTER = -1;
const ERR_INVALID_DIMENSIONS = -2;
const ERR_INVALID_QUALITY = -3;
const ERR_DIMENSION_OVERFLOW = -4;
const ERR_ENCODING_FAILED = -5;
const ERR_NOT_IMPLEMENTED = -99;

class WasmHarness {
  constructor(name, wasmPath) {
    this.name = name;
    this.wasmPath = wasmPath;
    this.instance = null;
    this.exp = null;
  }

  init() {
    const bytes = fs.readFileSync(this.wasmPath);
    const mod = new WebAssembly.Module(bytes);
    this.instance = new WebAssembly.Instance(mod);
    this.exp = this.instance.exports;
  }

  get mem() {
    return this.exp.memory;
  }

  get memSize() {
    return this.mem.buffer.byteLength;
  }

  readU32(ptr) {
    return new DataView(this.mem.buffer).getUint32(ptr, true);
  }

  encodeLossless(width, height, pixelData = null) {
    const pixelCount = width * height;
    const size = pixelCount * 4;
    let inPtr = 0;
    if (size > 0) {
      inPtr = this.exp.alloc_buffer(size);
      if (pixelData) {
        new Uint8Array(this.mem.buffer, inPtr, size).set(pixelData);
      }
    }
    const outPtrPtr = this.exp.alloc_buffer(4);
    const outLenPtr = this.exp.alloc_buffer(4);

    const code = this.exp.encode_lossless_webp(inPtr, width, height, outPtrPtr, outLenPtr);
    let output = null;
    if (code === ERR_SUCCESS) {
      const outPtr = this.readU32(outPtrPtr);
      const outLen = this.readU32(outLenPtr);
      output = new Uint8Array(this.mem.buffer, outPtr, outLen).slice();
      this.exp.free_buffer(outPtr, outLen);
    }
    this.exp.free_buffer(outPtrPtr, 4);
    this.exp.free_buffer(outLenPtr, 4);
    if (inPtr) {
      this.exp.free_buffer(inPtr, size);
    }
    return { code, output };
  }

  encodeLossy(width, height, quality, pixelData = null) {
    const pixelCount = width * height;
    const size = pixelCount * 4;
    let inPtr = 0;
    if (size > 0) {
      inPtr = this.exp.alloc_buffer(size);
      if (pixelData) {
        new Uint8Array(this.mem.buffer, inPtr, size).set(pixelData);
      }
    }
    const outPtrPtr = this.exp.alloc_buffer(4);
    const outLenPtr = this.exp.alloc_buffer(4);

    const code = this.exp.encode_lossy_webp(inPtr, width, height, quality, outPtrPtr, outLenPtr);
    let output = null;
    if (code === ERR_SUCCESS) {
      const outPtr = this.readU32(outPtrPtr);
      const outLen = this.readU32(outLenPtr);
      output = new Uint8Array(this.mem.buffer, outPtr, outLen).slice();
      this.exp.free_buffer(outPtr, outLen);
    }
    this.exp.free_buffer(outPtrPtr, 4);
    this.exp.free_buffer(outLenPtr, 4);
    if (inPtr) {
      this.exp.free_buffer(inPtr, size);
    }
    return { code, output };
  }
}

function parseWebpHeader(bytes) {
  if (!bytes || bytes.length < 16) return { valid: false, reason: 'too_short' };
  const riff = String.fromCharCode(...bytes.subarray(0, 4));
  const webp = String.fromCharCode(...bytes.subarray(8, 12));
  const chunk = String.fromCharCode(...bytes.subarray(12, 16));
  if (riff !== 'RIFF') return { valid: false, reason: `bad_riff_${riff}` };
  if (webp !== 'WEBP') return { valid: false, reason: `bad_webp_${webp}` };
  const fileSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
  return { valid: true, riff, webp, chunk, fileSize, length: bytes.length };
}

async function runTestSuite(moduleName, wasmPath) {
  console.log(`\n======================================================`);
  console.log(`  STARTING FUZZ & STRESS SUITE: ${moduleName}`);
  console.log(`  Binary: ${wasmPath} (${fs.statSync(wasmPath).size} bytes)`);
  console.log(`======================================================\n`);

  const harness = new WasmHarness(moduleName, wasmPath);
  harness.init();

  let passed = 0;
  let failed = 0;
  const failures = [];

  function assert(condition, name, details = '') {
    if (condition) {
      passed++;
      console.log(`  [PASS] ${name}`);
    } else {
      failed++;
      console.error(`  [FAIL] ${name} — ${details}`);
      failures.push({ name, details });
    }
  }

  // ==========================================
  // SECTION 1: Zero & Edge Dimensions (0x0, 0x10, 10x0)
  // ==========================================
  console.log(`--- [Section 1] Zero & Edge Dimensions ---`);
  {
    const dummy = harness.exp.alloc_buffer(64);
    const outP = harness.exp.alloc_buffer(4);
    const outL = harness.exp.alloc_buffer(4);

    const z1 = harness.exp.encode_lossless_webp(dummy, 0, 0, outP, outL);
    assert(z1 === ERR_INVALID_DIMENSIONS, 'Lossless 0x0 returns ERR_INVALID_DIMENSIONS', `Got ${z1}`);

    const z2 = harness.exp.encode_lossless_webp(dummy, 0, 10, outP, outL);
    assert(z2 === ERR_INVALID_DIMENSIONS, 'Lossless 0x10 returns ERR_INVALID_DIMENSIONS', `Got ${z2}`);

    const z3 = harness.exp.encode_lossless_webp(dummy, 10, 0, outP, outL);
    assert(z3 === ERR_INVALID_DIMENSIONS, 'Lossless 10x0 returns ERR_INVALID_DIMENSIONS', `Got ${z3}`);

    const z4 = harness.exp.encode_lossy_webp(dummy, 0, 0, 80, outP, outL);
    assert(z4 === ERR_INVALID_DIMENSIONS, 'Lossy 0x0 returns ERR_INVALID_DIMENSIONS', `Got ${z4}`);

    const z5 = harness.exp.encode_lossy_webp(dummy, 0, 10, 80, outP, outL);
    assert(z5 === ERR_INVALID_DIMENSIONS, 'Lossy 0x10 returns ERR_INVALID_DIMENSIONS', `Got ${z5}`);

    const z6 = harness.exp.encode_lossy_webp(dummy, 10, 0, 80, outP, outL);
    assert(z6 === ERR_INVALID_DIMENSIONS, 'Lossy 10x0 returns ERR_INVALID_DIMENSIONS', `Got ${z6}`);

    // If in_ptr is null with 0 dimensions, returns ERR_NULL_POINTER
    const z7 = harness.exp.encode_lossless_webp(0, 0, 0, outP, outL);
    assert(z7 === ERR_NULL_POINTER, 'Null in_ptr with 0x0 returns ERR_NULL_POINTER', `Got ${z7}`);

    harness.exp.free_buffer(dummy, 64);
    harness.exp.free_buffer(outP, 4);
    harness.exp.free_buffer(outL, 4);
  }

  // ==========================================
  // SECTION 2: Minimal Dimensions (1x1) & Odd Ratios
  // ==========================================
  console.log(`\n--- [Section 2] Minimal Dimensions (1x1) & Odd Boundaries ---`);
  {
    const l1 = harness.encodeLossless(1, 1);
    assert(l1.code === ERR_SUCCESS, 'Lossless 1x1 encodes successfully', `Got ${l1.code}`);
    const h1 = parseWebpHeader(l1.output);
    assert(h1.valid && h1.chunk === 'VP8L', 'Lossless 1x1 generates valid VP8L header');

    const ly1 = harness.encodeLossy(1, 1, 80);
    assert(ly1.code === ERR_SUCCESS, 'Lossy 1x1 encodes successfully', `Got ${ly1.code}`);
    const hy1 = parseWebpHeader(ly1.output);
    assert(hy1.valid && (hy1.chunk === 'VP8 ' || hy1.chunk === 'VP8X'), 'Lossy 1x1 generates valid VP8/VP8X header');

    // Odd dimensions that challenge block boundaries (VP8 16x16 macroblocks, YUV subsampling)
    for (const [w, h] of [[3, 5], [7, 13], [15, 15], [33, 47], [127, 63]]) {
      const oddL = harness.encodeLossless(w, h);
      assert(oddL.code === ERR_SUCCESS, `Lossless ${w}x${h} encodes successfully`, `Got ${oddL.code}`);
      const oddLy = harness.encodeLossy(w, h, 75);
      assert(oddLy.code === ERR_SUCCESS, `Lossy ${w}x${h} encodes successfully`, `Got ${oddLy.code}`);
    }
  }

  // ==========================================
  // SECTION 3: Extreme Aspect Ratios (1x4096, 4096x1, etc.)
  // ==========================================
  console.log(`\n--- [Section 3] Extreme Aspect Ratios ---`);
  {
    const ex1 = harness.encodeLossless(1, 4096);
    assert(ex1.code === ERR_SUCCESS, 'Lossless 1x4096 succeeds', `Got ${ex1.code}`);
    assert(parseWebpHeader(ex1.output).valid, 'Lossless 1x4096 header valid');

    const ex2 = harness.encodeLossless(4096, 1);
    assert(ex2.code === ERR_SUCCESS, 'Lossless 4096x1 succeeds', `Got ${ex2.code}`);
    assert(parseWebpHeader(ex2.output).valid, 'Lossless 4096x1 header valid');

    const ex3 = harness.encodeLossy(1, 4096, 80);
    assert(ex3.code === ERR_SUCCESS, 'Lossy 1x4096 succeeds', `Got ${ex3.code}`);
    assert(parseWebpHeader(ex3.output).valid, 'Lossy 1x4096 header valid');

    const ex4 = harness.encodeLossy(4096, 1, 80);
    assert(ex4.code === ERR_SUCCESS, 'Lossy 4096x1 succeeds', `Got ${ex4.code}`);
    assert(parseWebpHeader(ex4.output).valid, 'Lossy 4096x1 header valid');
  }

  // ==========================================
  // SECTION 4: Integer Overflows & Dimension Bounds
  // ==========================================
  console.log(`\n--- [Section 4] Integer Overflows & Dimension Bounds ---`);
  {
    const dummy = harness.exp.alloc_buffer(64);
    const outP = harness.exp.alloc_buffer(4);
    const outL = harness.exp.alloc_buffer(4);

    // u32::MAX dimensions (4294967295)
    const MAX_U32 = 4294967295;
    const ov1 = harness.exp.encode_lossless_webp(dummy, MAX_U32, MAX_U32, outP, outL);
    assert(ov1 === ERR_DIMENSION_OVERFLOW, 'Lossless u32::MAX x u32::MAX returns ERR_DIMENSION_OVERFLOW', `Got ${ov1}`);

    const ov2 = harness.exp.encode_lossless_webp(dummy, MAX_U32, 1, outP, outL);
    assert(ov2 === ERR_DIMENSION_OVERFLOW, 'Lossless u32::MAX x 1 returns ERR_DIMENSION_OVERFLOW', `Got ${ov2}`);

    const ov3 = harness.exp.encode_lossless_webp(dummy, 1, MAX_U32, outP, outL);
    assert(ov3 === ERR_DIMENSION_OVERFLOW, 'Lossless 1 x u32::MAX returns ERR_DIMENSION_OVERFLOW', `Got ${ov3}`);

    // 65536 x 65536: product = 2^32 (overflows 32-bit usize on wasm32)
    const ov4 = harness.exp.encode_lossless_webp(dummy, 65536, 65536, outP, outL);
    assert(ov4 === ERR_DIMENSION_OVERFLOW, 'Lossless 65536 x 65536 returns ERR_DIMENSION_OVERFLOW', `Got ${ov4}`);

    // 32768 x 32768: pixel_count = 2^30, * 4 = 2^32 (overflows 32-bit usize on wasm32)
    const ov5 = harness.exp.encode_lossless_webp(dummy, 32768, 32768, outP, outL);
    assert(ov5 === ERR_DIMENSION_OVERFLOW, 'Lossless 32768 x 32768 (* 4 = 2^32) returns ERR_DIMENSION_OVERFLOW', `Got ${ov5}`);

    // Lossy equivalents
    const ov6 = harness.exp.encode_lossy_webp(dummy, MAX_U32, 2, 80, outP, outL);
    assert(ov6 === ERR_DIMENSION_OVERFLOW, 'Lossy u32::MAX x 2 returns ERR_DIMENSION_OVERFLOW', `Got ${ov6}`);

    const ov7 = harness.exp.encode_lossy_webp(dummy, 32768, 32768, 80, outP, outL);
    assert(ov7 === ERR_DIMENSION_OVERFLOW, 'Lossy 32768 x 32768 returns ERR_DIMENSION_OVERFLOW', `Got ${ov7}`);

    harness.exp.free_buffer(dummy, 64);
    harness.exp.free_buffer(outP, 4);
    harness.exp.free_buffer(outL, 4);
  }

  // ==========================================
  // SECTION 5: Quality Out-of-Bounds & Special Floats
  // ==========================================
  console.log(`\n--- [Section 5] Quality Out-of-Bounds & Special Floats ---`);
  {
    const dummy = harness.exp.alloc_buffer(64);
    const outP = harness.exp.alloc_buffer(4);
    const outL = harness.exp.alloc_buffer(4);

    const invalidQualities = [
      [-100.0, 'Quality -100.0'],
      [-10.0, 'Quality -10.0'],
      [-0.001, 'Quality -0.001'],
      [0.0, 'Quality 0.0'],
      [0.999, 'Quality 0.999'],
      [100.001, 'Quality 100.001'],
      [101.0, 'Quality 101.0'],
      [200.0, 'Quality 200.0'],
      [NaN, 'Quality NaN'],
      [Infinity, 'Quality +Infinity'],
      [-Infinity, 'Quality -Infinity']
    ];

    for (const [q, label] of invalidQualities) {
      const code = harness.exp.encode_lossy_webp(dummy, 4, 4, q, outP, outL);
      assert(code === ERR_INVALID_QUALITY, `${label} returns ERR_INVALID_QUALITY`, `Got ${code}`);
    }

    // Boundary valid qualities: 1.0, 50.0, 100.0
    const validQualities = [1.0, 50.0, 100.0];
    for (const q of validQualities) {
      const code = harness.exp.encode_lossy_webp(dummy, 4, 4, q, outP, outL);
      assert(code === ERR_SUCCESS, `Valid Quality ${q} returns ERR_SUCCESS`, `Got ${code}`);
      const outPtr = harness.readU32(outP);
      const outLen = harness.readU32(outL);
      harness.exp.free_buffer(outPtr, outLen);
    }

    harness.exp.free_buffer(dummy, 64);
    harness.exp.free_buffer(outP, 4);
    harness.exp.free_buffer(outL, 4);
  }

  // ==========================================
  // SECTION 6: Null Pointers & Memory Robustness
  // ==========================================
  console.log(`\n--- [Section 6] Null Pointers & Memory Robustness ---`);
  {
    const dummy = harness.exp.alloc_buffer(64);
    const outP = harness.exp.alloc_buffer(4);
    const outL = harness.exp.alloc_buffer(4);

    assert(harness.exp.encode_lossless_webp(0, 4, 4, outP, outL) === ERR_NULL_POINTER, 'Null in_ptr returns ERR_NULL_POINTER');
    assert(harness.exp.encode_lossless_webp(dummy, 4, 4, 0, outL) === ERR_NULL_POINTER, 'Null out_ptr returns ERR_NULL_POINTER');
    assert(harness.exp.encode_lossless_webp(dummy, 4, 4, outP, 0) === ERR_NULL_POINTER, 'Null out_len returns ERR_NULL_POINTER');

    assert(harness.exp.encode_lossy_webp(0, 4, 4, 80, outP, outL) === ERR_NULL_POINTER, 'Lossy Null in_ptr returns ERR_NULL_POINTER');
    assert(harness.exp.encode_lossy_webp(dummy, 4, 4, 80, 0, outL) === ERR_NULL_POINTER, 'Lossy Null out_ptr returns ERR_NULL_POINTER');
    assert(harness.exp.encode_lossy_webp(dummy, 4, 4, 80, outP, 0) === ERR_NULL_POINTER, 'Lossy Null out_len returns ERR_NULL_POINTER');

    // alloc_buffer(0) must return 0 (null)
    const zeroAlloc = harness.exp.alloc_buffer(0);
    assert(zeroAlloc === 0, 'alloc_buffer(0) returns null (0)');

    // free_buffer safe no-ops
    harness.exp.free_buffer(0, 0);
    assert(true, 'free_buffer(0, 0) does not panic');
    harness.exp.free_buffer(0, 1024);
    assert(true, 'free_buffer(0, 1024) with null ptr does not panic');

    // WebM stub error contracts
    assert(harness.exp.create_webm_video(0, 100, 10, 10, 30, outP, outL) === ERR_NULL_POINTER, 'create_webm_video null ptr');
    assert(harness.exp.create_webm_video(dummy, 64, 0, 10, 30, outP, outL) === ERR_INVALID_DIMENSIONS, 'create_webm_video zero width');
    assert(harness.exp.create_webm_video(dummy, 64, 10, 10, 0, outP, outL) === ERR_INVALID_DIMENSIONS, 'create_webm_video zero fps');
    assert(harness.exp.create_webm_video(dummy, 64, 10, 10, 30, outP, outL) === ERR_NOT_IMPLEMENTED, 'create_webm_video returns ERR_NOT_IMPLEMENTED');

    harness.exp.free_buffer(dummy, 64);
    harness.exp.free_buffer(outP, 4);
    harness.exp.free_buffer(outL, 4);
  }

  // ==========================================
  // SECTION 7: Rapid Alloc/Free Heap Churn (1000 cycles)
  // ==========================================
  console.log(`\n--- [Section 7] Rapid Alloc/Free Heap Churn (1000 cycles) ---`);
  {
    const initialMem = harness.memSize;
    let allocSuccess = true;
    for (let i = 0; i < 1000; i++) {
      // Allocate random sizes between 16 bytes and 256KB
      const s = 16 + Math.floor(Math.random() * 262144);
      const ptr = harness.exp.alloc_buffer(s);
      if (ptr === 0) {
        allocSuccess = false;
        break;
      }
      // Touch memory (write first and last byte)
      const u8 = new Uint8Array(harness.mem.buffer, ptr, s);
      u8[0] = 0xAA;
      u8[s - 1] = 0x55;
      harness.exp.free_buffer(ptr, s);
    }
    assert(allocSuccess, '1000 random-sized alloc/touch/free cycles completed without heap failure');
    console.log(`  Initial memory: ${initialMem} bytes, Post-churn memory: ${harness.memSize} bytes`);
  }

  // ==========================================
  // SECTION 8: 500+ Iterations Endurance & Memory Leak Test
  // ==========================================
  console.log(`\n--- [Section 8] 500+ Iterations Endurance & Memory Leak Test ---`);
  {
    const ITERATIONS = 550;
    const memSnapshots = [];
    const initialWasmMem = harness.memSize;
    const initialRss = process.memoryUsage().rss;

    const testDimensions = [
      [16, 16],
      [32, 32],
      [64, 64],
      [48, 32],
      [33, 47],
      [128, 64],
      [80, 80]
    ];

    let allEncodesValid = true;
    let firstWebpHash = null;
    let lastWebpHash = null;

    const tStart = performance.now();

    for (let i = 0; i < ITERATIONS; i++) {
      const [w, h] = testDimensions[i % testDimensions.length];
      const isLossless = (i % 2 === 0);
      const quality = 50 + (i % 50);

      // Generate synthetic pixel pattern (deterministic)
      const size = w * h * 4;
      const pixels = new Uint8Array(size);
      for (let p = 0; p < size; p += 4) {
        pixels[p] = (p * 3) & 0xFF;
        pixels[p + 1] = (p * 7) & 0xFF;
        pixels[p + 2] = (p * 11) & 0xFF;
        pixels[p + 3] = (p & 1) ? 255 : 128; // mixed alpha
      }

      const res = isLossless
        ? harness.encodeLossless(w, h, pixels)
        : harness.encodeLossy(w, h, quality, pixels);

      if (res.code !== ERR_SUCCESS) {
        allEncodesValid = false;
        console.error(`Iteration ${i} failed with code ${res.code}`);
        break;
      }

      const header = parseWebpHeader(res.output);
      if (!header.valid) {
        allEncodesValid = false;
        console.error(`Iteration ${i} generated invalid WebP header`);
        break;
      }

      // Check deterministic output reproducibility
      if (i === 0) {
        firstWebpHash = res.output.length;
      }
      if (i === 546) {
        // Same dimension (16x16) and mode (lossless) as i=0 since 546 % 14 === 0
        lastWebpHash = res.output.length;
      }

      // Record snapshot every 50 iterations
      if (i % 50 === 0 || i === ITERATIONS - 1) {
        memSnapshots.push({
          iter: i,
          wasmMems: harness.memSize,
          rssMb: (process.memoryUsage().rss / (1024 * 1024)).toFixed(2)
        });
      }
    }

    const tEnd = performance.now();
    const duration = tEnd - tStart;
    const finalWasmMem = harness.memSize;
    const finalRss = process.memoryUsage().rss;

    assert(allEncodesValid, `All ${ITERATIONS} encode iterations succeeded with valid WebP containers`);
    console.log(`  Duration: ${duration.toFixed(1)} ms (~${(duration / ITERATIONS).toFixed(2)} ms/frame)`);
    console.log(`  Initial WASM Linear Memory: ${initialWasmMem} bytes (${(initialWasmMem / 1024 / 1024).toFixed(1)} MB)`);
    console.log(`  Final WASM Linear Memory:   ${finalWasmMem} bytes (${(finalWasmMem / 1024 / 1024).toFixed(1)} MB)`);
    console.log(`  Memory growth during 550 iterations: ${finalWasmMem - initialWasmMem} bytes`);
    console.log(`  Node RSS before: ${(initialRss / 1024 / 1024).toFixed(2)} MB, after: ${(finalRss / 1024 / 1024).toFixed(2)} MB`);

    // Memory leak assessment: WASM linear memory MUST NOT grow continuously across 550 small encodes
    const wasmMemGrewUnbounded = (finalWasmMem > initialWasmMem * 2);
    assert(!wasmMemGrewUnbounded, 'WASM linear memory remained stable with zero unbounded growth across 550 iterations');

    // Reproducibility check
    if (firstWebpHash && lastWebpHash) {
      assert(firstWebpHash === lastWebpHash, `Deterministic output length maintained (${firstWebpHash} bytes)`);
    }
  }

  // ==========================================
  // FINAL MODULE SUMMARY
  // ==========================================
  console.log(`\n------------------------------------------------------`);
  console.log(`  SUMMARY FOR ${moduleName}:`);
  console.log(`  TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log(`------------------------------------------------------\n`);

  return { moduleName, total: passed + failed, passed, failed, failures };
}

async function main() {
  console.log('=== WebP SIMD WASM Engine Challenger Fuzz & Stress Harness ===\n');

  const scalarResults = await runTestSuite('webp_engine_scalar.wasm', SCALAR_WASM_PATH);
  const simdResults = await runTestSuite('webp_engine_simd.wasm', SIMD_WASM_PATH);

  console.log('\n======================================================');
  console.log('                 FINAL CHALLENGE VERDICT               ');
  console.log('======================================================');
  console.log(`Scalar: ${scalarResults.passed}/${scalarResults.total} passed`);
  console.log(`SIMD:   ${simdResults.passed}/${simdResults.total} passed`);

  const totalFailures = scalarResults.failed + simdResults.failed;
  if (totalFailures === 0) {
    console.log('\n>>> EMPIRICAL VERDICT: APPROVE <<<');
    process.exit(0);
  } else {
    console.log(`\n>>> EMPIRICAL VERDICT: REJECT (${totalFailures} failures) <<<`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Harness fatal error:', err);
  process.exit(1);
});
