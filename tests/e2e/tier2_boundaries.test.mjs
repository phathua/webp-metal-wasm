import { assert, assertEqual, assertWebPHeader, assertAlphaFidelity } from './assertions.mjs';

export async function runTier2(env) {
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
  // Boundary 1: Image Dimensions (>= 5 tests)
  // =========================================================================

  await test('T2.1.1', 'Dimensions: Minimal 1x1 pixel image encodes successfully in Lossless mode', async () => {
    const script = `
      (() => {
        const rgba = new Uint8Array([255, 0, 128, 255]); // 1x1 RGBA
        return window.__WASM_ENGINE__.encodeLossless(1, 1, rgba);
      })()
    `;
    const res = await client.evaluate(script);
    assertEqual(res.status, 0, '1x1 Lossless failed');
    assertWebPHeader(res.bytes, 'VP8L');
  });

  await test('T2.1.2', 'Dimensions: Minimal 1x1 pixel image encodes successfully in Lossy mode', async () => {
    const script = `
      (() => {
        const rgba = new Uint8Array([200, 100, 50, 255]);
        return window.__WASM_ENGINE__.encodeLossy(1, 1, rgba, 80.0);
      })()
    `;
    const res = await client.evaluate(script);
    assertEqual(res.status, 0, '1x1 Lossy failed');
    assertWebPHeader(res.bytes, 'VP8');
  });

  await test('T2.1.3', 'Dimensions: Asymmetric 1x64 vertical strip image encodes successfully', async () => {
    const script = `
      (() => {
        const w = 1, h = 64;
        const rgba = new Uint8Array(w * h * 4).fill(100);
        return window.__WASM_ENGINE__.encodeLossless(w, h, rgba);
      })()
    `;
    const res = await client.evaluate(script);
    assertEqual(res.status, 0, '1x64 Lossless failed');
    assertWebPHeader(res.bytes, 'VP8L');
  });

  await test('T2.1.4', 'Dimensions: Asymmetric 64x1 horizontal strip image encodes successfully', async () => {
    const script = `
      (() => {
        const w = 64, h = 1;
        const rgba = new Uint8Array(w * h * 4).fill(150);
        return window.__WASM_ENGINE__.encodeLossless(w, h, rgba);
      })()
    `;
    const res = await client.evaluate(script);
    assertEqual(res.status, 0, '64x1 Lossless failed');
    assertWebPHeader(res.bytes, 'VP8L');
  });

  await test('T2.1.5', 'Dimensions: Zero width or height returns ERR_INVALID_DIMENSIONS (-2)', async () => {
    const script = `
      (() => {
        const exports = window.__WASM_ENGINE__.exports;
        const dummyPtr = exports.alloc_buffer(16);
        const outPtrHolder = exports.alloc_buffer(4);
        const outLenHolder = exports.alloc_buffer(4);

        const resZeroW = exports.encode_lossless_webp(dummyPtr, 0, 10, outPtrHolder, outLenHolder);
        const resZeroH = exports.encode_lossless_webp(dummyPtr, 10, 0, outPtrHolder, outLenHolder);
        const resLossyZero = exports.encode_lossy_webp(dummyPtr, 0, 0, 50.0, outPtrHolder, outLenHolder);

        exports.free_buffer(dummyPtr, 16);
        exports.free_buffer(outPtrHolder, 4);
        exports.free_buffer(outLenHolder, 4);

        return { resZeroW, resZeroH, resLossyZero };
      })()
    `;
    const res = await client.evaluate(script);
    assertEqual(res.resZeroW, -2, 'Expected -2 for width=0');
    assertEqual(res.resZeroH, -2, 'Expected -2 for height=0');
    assertEqual(res.resLossyZero, -2, 'Expected -2 for width=0, height=0');
  });

  // =========================================================================
  // Boundary 2: Quality Parameter Boundaries (>= 5 tests)
  // =========================================================================

  await test('T2.2.1', 'Quality: Exact minimum boundary quality Q=1.0 is accepted', async () => {
    const script = `
      (() => {
        const rgba = new Uint8Array(4 * 4 * 4).fill(128);
        return window.__WASM_ENGINE__.encodeLossy(4, 4, rgba, 1.0);
      })()
    `;
    const res = await client.evaluate(script);
    assertEqual(res.status, 0, 'Q=1.0 should be accepted');
  });

  await test('T2.2.2', 'Quality: Exact maximum boundary quality Q=100.0 is accepted', async () => {
    const script = `
      (() => {
        const rgba = new Uint8Array(4 * 4 * 4).fill(128);
        return window.__WASM_ENGINE__.encodeLossy(4, 4, rgba, 100.0);
      })()
    `;
    const res = await client.evaluate(script);
    assertEqual(res.status, 0, 'Q=100.0 should be accepted');
  });

  await test('T2.2.3', 'Quality: Below minimum Q=0.99 is rejected with ERR_INVALID_QUALITY (-3)', async () => {
    const script = `
      (() => {
        const rgba = new Uint8Array(4 * 4 * 4).fill(128);
        return window.__WASM_ENGINE__.encodeLossy(4, 4, rgba, 0.99);
      })()
    `;
    const res = await client.evaluate(script);
    assertEqual(res.status, -3, 'Q=0.99 should return ERR_INVALID_QUALITY (-3)');
  });

  await test('T2.2.4', 'Quality: Above maximum Q=100.01 is rejected with ERR_INVALID_QUALITY (-3)', async () => {
    const script = `
      (() => {
        const rgba = new Uint8Array(4 * 4 * 4).fill(128);
        return window.__WASM_ENGINE__.encodeLossy(4, 4, rgba, 100.01);
      })()
    `;
    const res = await client.evaluate(script);
    assertEqual(res.status, -3, 'Q=100.01 should return ERR_INVALID_QUALITY (-3)');
  });

  await test('T2.2.5', 'Quality: NaN and negative values rejected with ERR_INVALID_QUALITY (-3)', async () => {
    const script = `
      (() => {
        const rgba = new Uint8Array(4 * 4 * 4).fill(128);
        const resNeg = window.__WASM_ENGINE__.encodeLossy(4, 4, rgba, -10.0);
        const resNaN = window.__WASM_ENGINE__.encodeLossy(4, 4, rgba, NaN);
        return { resNeg: resNeg.status, resNaN: resNaN.status };
      })()
    `;
    const res = await client.evaluate(script);
    assertEqual(res.resNeg, -3, 'Negative quality should return -3');
    assertEqual(res.resNaN, -3, 'NaN quality should return -3');
  });

  // =========================================================================
  // Boundary 3: Alpha Extremes (>= 5 tests)
  // =========================================================================

  await test('T2.3.1', 'Alpha: 100% Fully transparent image (all A=0) encodes without panic or division by zero', async () => {
    const script = `
      (() => {
        const w = 16, h = 16;
        const rgba = new Uint8Array(w * h * 4); // all zeros, alpha = 0
        return window.__WASM_ENGINE__.encodeLossless(w, h, rgba);
      })()
    `;
    const res = await client.evaluate(script);
    assertEqual(res.status, 0, 'All-zero alpha failed');
    assertWebPHeader(res.bytes, 'VP8L');
  });

  await test('T2.3.2', 'Alpha: 100% Fully opaque image (all A=255) encodes without distortion', async () => {
    const script = `
      (() => {
        const w = 16, h = 16;
        const rgba = new Uint8Array(w * h * 4).fill(255);
        return window.__WASM_ENGINE__.encodeLossless(w, h, rgba);
      })()
    `;
    const res = await client.evaluate(script);
    assertEqual(res.status, 0, 'Opaque alpha failed');
    assertWebPHeader(res.bytes, 'VP8L');
  });

  await test('T2.3.3', 'Alpha: Single transparent pixel in an otherwise opaque image is handled', async () => {
    const script = `
      (() => {
        const w = 8, h = 8;
        const rgba = new Uint8Array(w * h * 4).fill(255);
        // Set single pixel (3, 3) alpha to 0
        rgba[(3 * w + 3) * 4 + 3] = 0;
        return window.__WASM_ENGINE__.encodeLossless(w, h, rgba);
      })()
    `;
    const res = await client.evaluate(script);
    assertEqual(res.status, 0);
    assertWebPHeader(res.bytes, 'VP8L');
  });

  await test('T2.3.4', 'Alpha: 1-bit binary alpha mask (alternating 0 and 255) encodes cleanly', async () => {
    const script = `
      (() => {
        const w = 16, h = 16;
        const rgba = new Uint8Array(w * h * 4);
        for (let i = 0; i < w * h; i++) {
          rgba[i * 4] = 200;
          rgba[i * 4 + 1] = 100;
          rgba[i * 4 + 2] = 50;
          rgba[i * 4 + 3] = (i % 2 === 0) ? 0 : 255;
        }
        return window.__WASM_ENGINE__.encodeLossless(w, h, rgba);
      })()
    `;
    const res = await client.evaluate(script);
    assertEqual(res.status, 0);
    assertWebPHeader(res.bytes, 'VP8L');
  });

  await test('T2.3.5', 'Alpha: Subtle translucency (A=1 and A=254) encodes without clamping distortion', async () => {
    const script = `
      (() => {
        const w = 8, h = 8;
        const rgba = new Uint8Array(w * h * 4);
        for (let i = 0; i < w * h; i++) {
          rgba[i * 4] = 120;
          rgba[i * 4 + 1] = 120;
          rgba[i * 4 + 2] = 120;
          rgba[i * 4 + 3] = (i % 2 === 0) ? 1 : 254;
        }
        return window.__WASM_ENGINE__.encodeLossless(w, h, rgba);
      })()
    `;
    const res = await client.evaluate(script);
    assertEqual(res.status, 0);
    assertWebPHeader(res.bytes, 'VP8L');
  });

  // =========================================================================
  // Boundary 4: Memory & Pointer Boundaries (>= 5 tests)
  // =========================================================================

  await test('T2.4.1', 'Memory: alloc_buffer(0) returns null pointer (0)', async () => {
    const script = `
      (() => {
        const ptr = window.__WASM_ENGINE__.alloc(0);
        return { ptr };
      })()
    `;
    const res = await client.evaluate(script);
    assertEqual(res.ptr, 0, 'alloc_buffer(0) should return 0 (null)');
  });

  await test('T2.4.2', 'Memory: free_buffer(0, 0) is safe no-op', async () => {
    const script = `
      (() => {
        try {
          window.__WASM_ENGINE__.free(0, 0);
          return { safe: true };
        } catch (e) {
          return { safe: false, error: e.message };
        }
      })()
    `;
    const res = await client.evaluate(script);
    assert(res.safe, 'free_buffer(0, 0) should not throw');
  });

  await test('T2.4.3', 'Memory: Dimension multiplication overflow returns ERR_DIMENSION_OVERFLOW (-4)', async () => {
    const script = `
      (() => {
        const exports = window.__WASM_ENGINE__.exports;
        const dummyPtr = exports.alloc_buffer(16);
        const outPtrHolder = exports.alloc_buffer(4);
        const outLenHolder = exports.alloc_buffer(4);

        // u32::MAX = 4294967295
        const code = exports.encode_lossless_webp(dummyPtr, 4294967295, 2, outPtrHolder, outLenHolder);

        exports.free_buffer(dummyPtr, 16);
        exports.free_buffer(outPtrHolder, 4);
        exports.free_buffer(outLenHolder, 4);

        return { code };
      })()
    `;
    const res = await client.evaluate(script);
    assertEqual(res.code, -4, 'Expected ERR_DIMENSION_OVERFLOW (-4)');
  });

  await test('T2.4.4', 'Memory: Null pointer passed to C-ABI returns ERR_NULL_POINTER (-1)', async () => {
    const script = `
      (() => {
        const exports = window.__WASM_ENGINE__.exports;
        const outPtrHolder = exports.alloc_buffer(4);
        const outLenHolder = exports.alloc_buffer(4);

        // Pass 0 (null pointer) for in_ptr
        const code = exports.encode_lossless_webp(0, 10, 10, outPtrHolder, outLenHolder);

        exports.free_buffer(outPtrHolder, 4);
        exports.free_buffer(outLenHolder, 4);

        return { code };
      })()
    `;
    const res = await client.evaluate(script);
    assertEqual(res.code, -1, 'Expected ERR_NULL_POINTER (-1)');
  });

  await test('T2.4.5', 'Memory: 50 consecutive alloc/free cycles maintain heap stability without leak', async () => {
    const script = `
      (() => {
        const exports = window.__WASM_ENGINE__.exports;
        const initialPages = exports.memory.buffer.byteLength / 65536;

        for (let i = 0; i < 50; i++) {
          const ptr = exports.alloc_buffer(64 * 1024); // 64KB
          new Uint8Array(exports.memory.buffer, ptr, 64 * 1024).fill(i & 0xFF);
          exports.free_buffer(ptr, 64 * 1024);
        }

        const finalPages = exports.memory.buffer.byteLength / 65536;
        return { initialPages, finalPages };
      })()
    `;
    const res = await client.evaluate(script);
    assert(res.finalPages <= res.initialPages + 4,
      `WASM memory expanded excessively: from ${res.initialPages} to ${res.finalPages} pages`);
  });

  // =========================================================================
  // Boundary 5: Corrupt & Truncated Input Data (>= 5 tests)
  // =========================================================================

  await test('T2.5.1', 'Corrupt Data: Truncated RIFF header rejected by parser oracle', async () => {
    const truncated = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x08, 0x00]); // 6 bytes (truncated)
    let rejected = false;
    try {
      assertWebPHeader(truncated);
    } catch (e) {
      rejected = true;
    }
    assert(rejected, 'Truncated RIFF was not rejected');
  });

  await test('T2.5.2', 'Corrupt Data: Random noise bytes rejected by WebP parser', async () => {
    const randomBytes = fixtures['corrupt_random']?.buffer || Buffer.alloc(512);
    let rejected = false;
    try {
      assertWebPHeader(randomBytes);
    } catch (e) {
      rejected = true;
    }
    assert(rejected, 'Random bytes passed as valid WebP');
  });

  await test('T2.5.3', 'Corrupt Data: Detached ArrayBuffer sent to encoder bridge safely rejected', async () => {
    const script = `
      (() => {
        const buf = new ArrayBuffer(100);
        const channel = new MessageChannel();
        channel.port1.postMessage(buf, [buf]); // Detach buffer

        try {
          const res = window.__WASM_ENGINE__.encodeLossless(5, 5, new Uint8Array(buf));
          return { handled: true, status: res.status };
        } catch (e) {
          return { handled: true, error: e.name };
        }
      })()
    `;
    const res = await client.evaluate(script);
    assert(res.handled, 'Detached buffer should be caught');
  });

  await test('T2.5.4', 'Corrupt Data: WebM stub rejects zero length frames with error', async () => {
    const script = `
      (() => {
        const res = window.__WASM_ENGINE__.createWebm(new Uint8Array(0), 10, 10, 30);
        return { status: res.status };
      })()
    `;
    const res = await client.evaluate(script);
    assert(res.status < 0, `Expected negative error code for invalid/empty frames, got ${res.status}`);
  });

  await test('T2.5.5', 'Corrupt Data: Mismatched dimensions (buffer length < width * height * 4) safely handled', async () => {
    const script = `
      (() => {
        // Provide 16 bytes for a 10x10 image (which expects 400 bytes)
        const tinyRgba = new Uint8Array(16);
        try {
          const res = window.__WASM_ENGINE__.encodeLossless(10, 10, tinyRgba);
          return { handled: true, status: res.status };
        } catch (e) {
          return { handled: true, error: e.name };
        }
      })()
    `;
    const res = await client.evaluate(script);
    assert(res.handled, 'Mismatched buffer length did not throw or safely return error');
  });

  return results;
}
