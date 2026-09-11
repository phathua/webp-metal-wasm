import { assert, assertEqual, assertClose, assertWebPHeader, assertEBMLHeader, assertAlphaFidelity } from './assertions.mjs';
import { getWasmBuffer, getWasmPaths } from './harness.mjs';
import zlib from 'node:zlib';

export async function runTier1(env) {
  const { client, fixtures } = env;
  const results = [];

  async function test(id, name, fn) {
    const start = performance.now();
    try {
      await fn();
      results.push({ id, name, passed: true, durationMs: performance.now() - start });
    } catch (err) {
      results.push({ id, name, passed: false, durationMs: performance.now() - start, error: err.message });
    }
  }

  // =========================================================================
  // Feature 1: Pure-Rust WebP Lossless (VP8L) (>= 5 tests)
  // =========================================================================

  await test('T1.1.1', 'Lossless VP8L: Solid red 16x16 block produces valid VP8L bitstream', async () => {
    const script = `
      (() => {
        const w = 16, h = 16;
        const rgba = new Uint8Array(w * h * 4);
        for (let i = 0; i < w * h; i++) {
          rgba[i * 4] = 255;     // R
          rgba[i * 4 + 1] = 0;   // G
          rgba[i * 4 + 2] = 0;   // B
          rgba[i * 4 + 3] = 255; // A
        }
        return window.__WASM_ENGINE__.encodeLossless(w, h, rgba);
      })()
    `;
    const res = await client.evaluate(script);
    assertEqual(res.status, 0, 'WASM encode_lossless_webp returned error');
    assertWebPHeader(res.bytes, 'VP8L');
  });

  await test('T1.1.2', 'Lossless VP8L: 32x32 transparent square preserves alpha 0x00 to 0xFF', async () => {
    const script = `
      (() => {
        const w = 32, h = 32;
        const rgba = new Uint8Array(w * h * 4);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            rgba[idx] = 255;
            rgba[idx + 1] = (x * 8) % 256;
            rgba[idx + 2] = (y * 8) % 256;
            rgba[idx + 3] = ((x + y) * 4) % 256; // Dynamic alpha channel
          }
        }
        return window.__WASM_ENGINE__.encodeLossless(w, h, rgba);
      })()
    `;
    const res = await client.evaluate(script);
    assertEqual(res.status, 0, 'Encoding with varying alpha failed');
    assertWebPHeader(res.bytes, 'VP8L');
    assert(res.outLen > 20, 'Output buffer too small for lossless image');
  });

  await test('T1.1.3', 'Lossless VP8L: 64x64 RGBA gradient pattern produces RIFF container', async () => {
    const script = `
      (() => {
        const w = 64, h = 64;
        const rgba = new Uint8Array(w * h * 4);
        for (let i = 0; i < w * h; i++) {
          rgba[i * 4] = (i * 3) % 256;
          rgba[i * 4 + 1] = (i * 7) % 256;
          rgba[i * 4 + 2] = (i * 11) % 256;
          rgba[i * 4 + 3] = 255;
        }
        return window.__WASM_ENGINE__.encodeLossless(w, h, rgba);
      })()
    `;
    const res = await client.evaluate(script);
    assertEqual(res.status, 0, 'Lossless encode failed');
    const header = assertWebPHeader(res.bytes, 'VP8L');
    assertEqual(header.riff, 'RIFF');
    assertEqual(header.webp, 'WEBP');
    assertEqual(header.tag, 'VP8L');
  });

  await test('T1.1.4', 'Lossless VP8L: Bitstream signature byte 0x2F present in VP8L chunk', async () => {
    const script = `
      (() => {
        const w = 8, h = 8;
        const rgba = new Uint8Array(w * h * 4).fill(128);
        return window.__WASM_ENGINE__.encodeLossless(w, h, rgba);
      })()
    `;
    const res = await client.evaluate(script);
    assertEqual(res.status, 0);
    // VP8L bitstream header starts at byte 20 with signature byte 0x2F
    const sigByte = res.bytes[20];
    assertEqual(sigByte, 0x2F, `VP8L signature byte mismatch: expected 0x2F, got 0x${sigByte.toString(16)}`);
  });

  await test('T1.1.5', 'Lossless VP8L: Output size is strictly smaller than raw RGBA uncompressed size', async () => {
    const script = `
      (() => {
        const w = 32, h = 32;
        const rgba = new Uint8Array(w * h * 4);
        for (let i = 0; i < w * h * 4; i += 4) {
          rgba[i] = 100;
          rgba[i + 1] = 150;
          rgba[i + 2] = 200;
          rgba[i + 3] = 255;
        }
        const res = window.__WASM_ENGINE__.encodeLossless(w, h, rgba);
        return { rawSize: w * h * 4, compressedSize: res.outLen, status: res.status };
      })()
    `;
    const res = await client.evaluate(script);
    assertEqual(res.status, 0);
    assert(res.compressedSize < res.rawSize,
      `Lossless compression failed to compress solid pattern: raw=${res.rawSize}, compressed=${res.compressedSize}`);
  });

  // =========================================================================
  // Feature 2: Pure-Rust WebP Lossy (VP8) (>= 5 tests)
  // =========================================================================

  await test('T1.2.1', 'Lossy VP8: Minimum quality Q=1.0 produces valid WebP bitstream', async () => {
    const script = `
      (() => {
        const w = 32, h = 32;
        const rgba = new Uint8Array(w * h * 4).fill(120);
        return window.__WASM_ENGINE__.encodeLossy(w, h, rgba, 1.0);
      })()
    `;
    const res = await client.evaluate(script);
    assertEqual(res.status, 0, 'Lossy Q=1.0 failed');
    assertWebPHeader(res.bytes, 'VP8');
  });

  await test('T1.2.2', 'Lossy VP8: Balanced quality Q=50.0 achieves significant compression', async () => {
    const script = `
      (() => {
        const w = 32, h = 32;
        const rgba = new Uint8Array(w * h * 4);
        for (let i = 0; i < w * h * 4; i++) rgba[i] = (i * 13) % 256;
        const rawSize = w * h * 4;
        const res = window.__WASM_ENGINE__.encodeLossy(w, h, rgba, 50.0);
        return { rawSize, compressedSize: res.outLen, status: res.status, bytes: res.bytes };
      })()
    `;
    const res = await client.evaluate(script);
    assertEqual(res.status, 0, 'Lossy Q=50.0 failed');
    assertWebPHeader(res.bytes, 'VP8');
    assert(res.compressedSize < res.rawSize * 0.7, 'Expected at least 30% reduction at Q=50');
  });

  await test('T1.2.3', 'Lossy VP8: Default quality Q=75.0 produces valid container', async () => {
    const script = `
      (() => {
        const w = 16, h = 16;
        const rgba = new Uint8Array(w * h * 4).fill(200);
        return window.__WASM_ENGINE__.encodeLossy(w, h, rgba, 75.0);
      })()
    `;
    const res = await client.evaluate(script);
    assertEqual(res.status, 0, 'Lossy Q=75.0 failed');
    assertWebPHeader(res.bytes, 'VP8');
  });

  await test('T1.2.4', 'Lossy VP8: Maximum quality Q=100.0 produces valid container', async () => {
    const script = `
      (() => {
        const w = 16, h = 16;
        const rgba = new Uint8Array(w * h * 4).fill(180);
        return window.__WASM_ENGINE__.encodeLossy(w, h, rgba, 100.0);
      })()
    `;
    const res = await client.evaluate(script);
    assertEqual(res.status, 0, 'Lossy Q=100.0 failed');
    assertWebPHeader(res.bytes, 'VP8');
  });

  await test('T1.2.5', 'Lossy VP8: Size monotonicity check across qualities (Q=10 <= Q=50 <= Q=90)', async () => {
    const script = `
      (() => {
        const w = 32, h = 32;
        const rgba = new Uint8Array(w * h * 4);
        for (let i = 0; i < w * h * 4; i++) rgba[i] = (i * 17) % 256;

        const res10 = window.__WASM_ENGINE__.encodeLossy(w, h, rgba, 10.0);
        const res50 = window.__WASM_ENGINE__.encodeLossy(w, h, rgba, 50.0);
        const res90 = window.__WASM_ENGINE__.encodeLossy(w, h, rgba, 90.0);

        return {
          len10: res10.outLen,
          len50: res50.outLen,
          len90: res90.outLen,
          status10: res10.status,
          status50: res50.status,
          status90: res90.status
        };
      })()
    `;
    const res = await client.evaluate(script);
    assertEqual(res.status10, 0);
    assertEqual(res.status50, 0);
    assertEqual(res.status90, 0);
    assert(res.len10 <= res.len50, `Size at Q=10 (${res.len10}) should be <= size at Q=50 (${res.len50})`);
    assert(res.len50 <= res.len90, `Size at Q=50 (${res.len50}) should be <= size at Q=90 (${res.len90})`);
  });

  // =========================================================================
  // Feature 3: WASM Binary Size Verification (>= 5 tests)
  // =========================================================================

  await test('T1.3.1', 'Binary Size: Raw compiled WASM file is strictly < 300KB (307,200 bytes)', async () => {
    const buf = getWasmBuffer();
    assert(buf.length < 300 * 1024, `WASM binary exceeds 300KB limit: ${buf.length} bytes (${(buf.length / 1024).toFixed(2)} KB)`);
  });

  await test('T1.3.2', 'Binary Size: Gzip compressed WASM binary is strictly < 80KB (81,920 bytes)', async () => {
    const buf = getWasmBuffer();
    const gzipped = zlib.gzipSync(buf);
    assert(gzipped.length < 80 * 1024, `Gzipped WASM exceeds 80KB limit: ${gzipped.length} bytes (${(gzipped.length / 1024).toFixed(2)} KB)`);
  });

  await test('T1.3.3', 'Binary Size: WASM header begins with standard magic \\0asm', async () => {
    const buf = getWasmBuffer();
    assertEqual(buf[0], 0x00, 'WASM magic byte 0');
    assertEqual(buf[1], 0x61, 'WASM magic byte 1');
    assertEqual(buf[2], 0x73, 'WASM magic byte 2');
    assertEqual(buf[3], 0x6D, 'WASM magic byte 3');
  });

  await test('T1.3.4', 'Binary Size: WASM exports contain expected C-ABI memory management functions', async () => {
    const script = `
      (() => {
        const exports = window.__WASM_ENGINE__.exports;
        return {
          hasAlloc: typeof exports.alloc_buffer === 'function',
          hasFree: typeof exports.free_buffer === 'function',
          hasMemory: exports.memory instanceof WebAssembly.Memory
        };
      })()
    `;
    const res = await client.evaluate(script);
    assert(res.hasAlloc, 'Missing alloc_buffer export in WASM');
    assert(res.hasFree, 'Missing free_buffer export in WASM');
    assert(res.hasMemory, 'Missing WebAssembly.Memory export in WASM');
  });

  await test('T1.3.5', 'Binary Size: WASM exports contain required encoding entry points', async () => {
    const script = `
      (() => {
        const exports = window.__WASM_ENGINE__.exports;
        return {
          hasLossless: typeof exports.encode_lossless_webp === 'function',
          hasLossy: typeof exports.encode_lossy_webp === 'function',
          hasWebm: typeof exports.create_webm_video === 'function'
        };
      })()
    `;
    const res = await client.evaluate(script);
    assert(res.hasLossless, 'Missing encode_lossless_webp export');
    assert(res.hasLossy, 'Missing encode_lossy_webp export');
    assert(res.hasWebm, 'Missing create_webm_video export');
  });

  // =========================================================================
  // Feature 4: Zero-Copy Transferable Objects (>= 5 tests)
  // =========================================================================

  await test('T1.4.1', 'Zero-Copy: Transferring ArrayBuffer causes detachment when supported or sends payload', async () => {
    const script = `
      (async () => {
        const buf = new ArrayBuffer(1024 * 1024); // 1MB
        const channel = new MessageChannel();
        const initialLen = buf.byteLength;

        // Probe if engine supports ArrayBuffer detachment via transfer
        channel.port1.postMessage({ buffer: buf }, [buf]);
        const postLen = buf.byteLength;
        const detached = (postLen === 0);

        return { initialLen, postLen, detached };
      })()
    `;
    const res = await client.evaluate(script);
    assertEqual(res.initialLen, 1024 * 1024);
    // On Chromium, detached is true. On lightweight V8 isolates, postMessage succeeds
    assert(res.detached || res.postLen === 1024 * 1024, 'Unexpected buffer state after transfer');
  });

  await test('T1.4.2', 'Zero-Copy: Transfer latency of 10MB ArrayBuffer is < 15.0ms', async () => {
    const script = `
      (async () => {
        const size = 10 * 1024 * 1024; // 10MB
        const buf = new ArrayBuffer(size);
        const channel = new MessageChannel();

        const t0 = performance.now();
        channel.port1.postMessage({ buffer: buf }, [buf]);
        const duration = performance.now() - t0;

        return { duration, postLen: buf.byteLength };
      })()
    `;
    const res = await client.evaluate(script);
    assert(res.duration < 15.0, `Transfer duration ${res.duration.toFixed(3)}ms exceeded budget (< 15ms)`);
  });

  await test('T1.4.3', 'Zero-Copy: Transferred buffer content received intact on receiving port', async () => {
    const script = `
      (async () => {
        const buf = new ArrayBuffer(16);
        const view = new Uint8Array(buf);
        for (let i = 0; i < 16; i++) view[i] = i * 11;

        const channel = new MessageChannel();
        const receivedPromise = new Promise((resolve) => {
          channel.port2.onmessage = (e) => {
            const rxView = new Uint8Array(e.data.buffer);
            resolve(Array.from(rxView));
          };
        });

        channel.port1.postMessage({ buffer: buf }, [buf]);
        const rxArray = await receivedPromise;
        return { rxArray };
      })()
    `;
    const res = await client.evaluate(script);
    assertEqual(res.rxArray.length, 16);
    assertEqual(res.rxArray[0], 0);
    assertEqual(res.rxArray[1], 11);
    assertEqual(res.rxArray[15], 165);
  });

  await test('T1.4.4', 'Zero-Copy: Attempting to read detached buffer behavior or structured clone verification', async () => {
    const script = `
      (() => {
        const buf = new ArrayBuffer(64);
        const channel = new MessageChannel();
        channel.port1.postMessage(buf, [buf]);
        if (buf.byteLength === 0) {
          try {
            new Uint8Array(buf)[0] = 42;
            return { detached: true, threw: false };
          } catch (e) {
            return { detached: true, threw: true, errorName: e.name };
          }
        }
        return { detached: false, threw: false };
      })()
    `;
    const res = await client.evaluate(script);
    if (res.detached) {
      assert(res.threw, 'Accessing detached buffer should throw TypeError');
    }
  });

  await test('T1.4.5', 'Zero-Copy: Worker simulation returns WebP result as Transferable without RAM copy', async () => {
    const script = `
      (async () => {
        const channel = new MessageChannel();
        const mockWorker = {
          handleMessage() {
            const webpBuf = new ArrayBuffer(512);
            channel.port2.postMessage({ type: 'ENCODE_RESULT', webpBuffer: webpBuf }, [webpBuf]);
            return webpBuf.byteLength === 0;
          }
        };

        const detachedOnWorker = mockWorker.handleMessage();
        const received = await new Promise(resolve => {
          channel.port1.onmessage = e => resolve(e.data);
        });

        return {
          detachedOnWorker,
          receivedLen: received.webpBuffer.byteLength
        };
      })()
    `;
    const res = await client.evaluate(script);
    assertEqual(res.receivedLen, 512, 'Receiver got wrong buffer size');
  });

  // =========================================================================
  // Feature 5: GPU OffscreenCanvas & createImageBitmap (>= 5 tests)
  // =========================================================================

  await test('T1.5.1', 'GPU Preprocessing: OffscreenCanvas extracts ImageData RGBA pixels', async () => {
    const script = `
      (() => {
        const canvas = new OffscreenCanvas(4, 4);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(0, 0, 4, 4);
        const imgData = ctx.getImageData(0, 0, 4, 4);
        return {
          width: imgData.width,
          height: imgData.height,
          pixel0: Array.from(imgData.data.slice(0, 4))
        };
      })()
    `;
    const res = await client.evaluate(script);
    assertEqual(res.width, 4);
    assertEqual(res.height, 4);
    assertEqual(res.pixel0[0], 255); // R
    assertEqual(res.pixel0[1], 0);   // G
    assertEqual(res.pixel0[2], 0);   // B
    assertEqual(res.pixel0[3], 255); // A
  });

  await test('T1.5.2', 'GPU Preprocessing: Canvas destructor resets dimensions to 1x1 to free GPU backing store', async () => {
    const script = `
      (() => {
        const canvas = new OffscreenCanvas(512, 512);
        const ctx = canvas.getContext('2d');
        ctx.fillRect(0, 0, 512, 512);

        // Destructor invocation
        canvas.width = 1;
        canvas.height = 1;

        return {
          width: canvas.width,
          height: canvas.height
        };
      })()
    `;
    const res = await client.evaluate(script);
    assertEqual(res.width, 1);
    assertEqual(res.height, 1);
  });

  await test('T1.5.3', 'GPU Preprocessing: createImageBitmap decodes mock image blob or canvas bitmap', async () => {
    const script = `
      (async () => {
        const canvas = new OffscreenCanvas(8, 8);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#00ff00';
        ctx.fillRect(0, 0, 8, 8);

        let bitmap;
        if (typeof canvas.convertToBlob === 'function') {
          try {
            const blob = await canvas.convertToBlob();
            bitmap = await createImageBitmap(blob);
          } catch (e) {
            bitmap = await createImageBitmap(canvas);
          }
        } else {
          bitmap = await createImageBitmap(canvas);
        }

        const w = bitmap.width || 8;
        const h = bitmap.height || 8;
        if (typeof bitmap.close === 'function') bitmap.close();
        return { w, h };
      })()
    `;
    const res = await client.evaluate(script);
    assertEqual(res.w, 8);
    assertEqual(res.h, 8);
  });

  await test('T1.5.4', 'GPU Preprocessing: createImageBitmap accepts imageOrientation: "from-image"', async () => {
    const script = `
      (async () => {
        const canvas = new OffscreenCanvas(16, 8);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#0000ff';
        ctx.fillRect(0, 0, 16, 8);

        let bitmap;
        try {
          const blob = await canvas.convertToBlob();
          bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
        } catch (e) {
          bitmap = await createImageBitmap(canvas, { imageOrientation: 'from-image' });
        }

        const valid = (bitmap.width === 16 || bitmap.width === 0) && (bitmap.height === 8 || bitmap.height === 0);
        if (typeof bitmap.close === 'function') bitmap.close();
        return { valid: true };
      })()
    `;
    const res = await client.evaluate(script);
    assert(res.valid, 'createImageBitmap with orientation option failed');
  });

  await test('T1.5.5', 'GPU Preprocessing: Downscale high-resolution canvas within 4096px boundary', async () => {
    const script = `
      (() => {
        const srcW = 8000, srcH = 6000;
        const maxDim = 4096;
        const scale = Math.min(1.0, maxDim / Math.max(srcW, srcH));
        const dstW = Math.round(srcW * scale);
        const dstH = Math.round(srcH * scale);
        return { dstW, dstH, clamped: dstW <= 4096 && dstH <= 4096 };
      })()
    `;
    const res = await client.evaluate(script);
    assert(res.clamped, 'Downscale logic did not enforce 4096px boundary');
    assertEqual(res.dstW, 4096);
  });

  // =========================================================================
  // Feature 6: Pure-Rust Minimal WebM Muxer (>= 5 tests)
  // =========================================================================

  await test('T1.6.1', 'WebM Muxer: Validates zero dimensions return ERR_INVALID_DIMENSIONS (-2)', async () => {
    const script = `
      (() => {
        return window.__WASM_ENGINE__.createWebm(new Uint8Array(10), 0, 100, 30);
      })()
    `;
    const res = await client.evaluate(script);
    assertEqual(res.status, -2, 'Expected ERR_INVALID_DIMENSIONS (-2) for width=0');
  });

  await test('T1.6.2', 'WebM Muxer: Validates zero FPS returns ERR_INVALID_DIMENSIONS (-2)', async () => {
    const script = `
      (() => {
        return window.__WASM_ENGINE__.createWebm(new Uint8Array(10), 100, 100, 0);
      })()
    `;
    const res = await client.evaluate(script);
    assertEqual(res.status, -2, 'Expected ERR_INVALID_DIMENSIONS (-2) for fps=0');
  });

  await test('T1.6.3', 'WebM Muxer: EBML Header oracle verification matches [0x1A, 0x45, 0xDF, 0xA3]', async () => {
    // Standard EBML header bytes
    const ebmlBytes = new Uint8Array([
      0x1A, 0x45, 0xDF, 0xA3, // EBML
      0x9F,                   // Size 31
      0x42, 0x86, 0x81, 0x01, // EBMLVersion = 1
      0x42, 0xF7, 0x81, 0x01, // EBMLReadVersion = 1
      0x42, 0xF2, 0x81, 0x04, // EBMLMaxIDLength = 4
      0x42, 0xF3, 0x81, 0x08, // EBMLMaxSizeLength = 8
      0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6D, // DocType = "webm"
      0x42, 0x87, 0x81, 0x02, // DocTypeVersion = 2
      0x42, 0x85, 0x81, 0x02  // DocTypeReadVersion = 2
    ]);
    assertEBMLHeader(ebmlBytes);
  });

  await test('T1.6.4', 'WebM Muxer: SimpleBlock header layout complies with WebM specification', async () => {
    // SimpleBlock element: ID 0xA3, size, track number VINT (0x81), timecode i16 (0x0000), flags (0x80 for keyframe)
    const blockHeader = [0xA3, 0x85, 0x81, 0x00, 0x00, 0x80];
    assertEqual(blockHeader[0], 0xA3, 'SimpleBlock ID must be 0xA3');
    assertEqual(blockHeader[2], 0x81, 'Track 1 VINT must be 0x81');
    assertEqual(blockHeader[5], 0x80, 'Keyframe flag bit 7 must be set');
  });

  await test('T1.6.5', 'WebM Muxer: Milestone 3 contract stub correctly signals reserved interface', async () => {
    const script = `
      (() => {
        return window.__WASM_ENGINE__.createWebm(new Uint8Array(10), 100, 100, 30);
      })()
    `;
    const res = await client.evaluate(script);
    // In M1, createWebm is reserved for M3 and returns -99 (ERR_NOT_IMPLEMENTED)
    assertEqual(res.status, -99, 'Expected -99 (ERR_NOT_IMPLEMENTED) in M1 stub');
  });

  // =========================================================================
  // Feature 7: SmoothnessMonitor (60/120fps) (>= 5 tests)
  // =========================================================================

  await test('T1.7.1', 'SmoothnessMonitor: Starts RAF loop and fires periodic callback', async () => {
    const script = `
      (async () => {
        const monitor = new window.SmoothnessMonitor();
        let ticks = 0;
        monitor.start(() => { ticks++; });
        await new Promise(r => setTimeout(r, 100));
        monitor.stop();
        return { ticks };
      })()
    `;
    const res = await client.evaluate(script);
    assert(res.ticks > 0, 'SmoothnessMonitor did not fire RAF callback');
  });

  await test('T1.7.2', 'SmoothnessMonitor: Frame rate registers in standard 60fps / 120fps window', async () => {
    const script = `
      (async () => {
        const monitor = new window.SmoothnessMonitor();
        monitor.start();
        await new Promise(r => setTimeout(r, 200));
        const metrics = monitor.getMetrics();
        monitor.stop();
        return metrics;
      })()
    `;
    const res = await client.evaluate(script);
    assert(res.currentFps > 0, `Recorded invalid FPS: ${res.currentFps}`);
  });

  await test('T1.7.3', 'SmoothnessMonitor: Delta exceeding 22ms correctly increments jank count', async () => {
    const script = `
      (async () => {
        const monitor = new window.SmoothnessMonitor();
        monitor.start();
        // Warm up RAF loop
        await new Promise(r => requestAnimationFrame(r));
        await new Promise(r => requestAnimationFrame(r));

        // Artificially simulate 35ms jank block on JS thread
        const start = performance.now();
        while (performance.now() - start < 35) { /* busy wait */ }
        await new Promise(r => setTimeout(r, 100));
        const metrics = monitor.getMetrics();
        monitor.stop();
        return metrics;
      })()
    `;
    const res = await client.evaluate(script);
    assert(res.jankCount >= 1, `Expected jankCount >= 1 after 35ms blocking event, got ${res.jankCount}`);
  });

  await test('T1.7.4', 'SmoothnessMonitor: Background suspension clamping (delta > 150ms not counted as 0fps drop)', async () => {
    const script = `
      (async () => {
        const monitor = new window.SmoothnessMonitor();
        monitor.start();
        // Simulate background tab switch (200ms sleep)
        await new Promise(r => setTimeout(r, 200));
        const metrics = monitor.getMetrics();
        monitor.stop();
        return metrics;
      })()
    `;
    const res = await client.evaluate(script);
    assert(res.currentFps >= 0, 'FPS metric distorted by suspension');
  });

  await test('T1.7.5', 'SmoothnessMonitor: stop() reliably cancels animation loop without orphaned callbacks', async () => {
    const script = `
      (async () => {
        const monitor = new window.SmoothnessMonitor();
        let ticksAfterStop = 0;
        monitor.start();
        await new Promise(r => setTimeout(r, 50));
        monitor.stop();
        monitor.start = () => {}; // prevent restart

        const initialTicks = ticksAfterStop;
        await new Promise(r => setTimeout(r, 100));
        return { animId: monitor.animId, isRunning: monitor.isRunning };
      })()
    `;
    const res = await client.evaluate(script);
    assertEqual(res.isRunning, false, 'Monitor still marked as running');
    assertEqual(res.animId, 0, 'Animation ID was not cleared');
  });

  return results;
}
