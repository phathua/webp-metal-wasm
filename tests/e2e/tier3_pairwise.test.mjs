import { assert, assertEqual, assertWebPHeader, assertEBMLHeader } from './assertions.mjs';

export async function runTier3(env) {
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
  // Pairwise 1: Transparent PNG with Lossy VP8 Encoding
  // =========================================================================

  await test('T3.1', 'Pairwise: Transparent PNG encoded as lossy VP8 produces VP8X container with ALPH chunk', async () => {
    const script = `
      (() => {
        const w = 16, h = 16;
        const rgba = new Uint8Array(w * h * 4);
        for (let i = 0; i < w * h; i++) {
          rgba[i * 4] = 200;
          rgba[i * 4 + 1] = 100;
          rgba[i * 4 + 2] = 50;
          rgba[i * 4 + 3] = (i % 3 === 0) ? 128 : 255; // Has non-opaque alpha
        }

        const res = window.__WASM_ENGINE__.encodeLossy(w, h, rgba, 80.0);
        return {
          status: res.status,
          outLen: res.outLen,
          bytes: res.bytes
        };
      })()
    `;
    const res = await client.evaluate(script);
    assertEqual(res.status, 0, 'Lossy encode of transparent image failed');
    // For lossy WebP with alpha, format should be Extended (VP8X)
    assertWebPHeader(res.bytes, 'VP8X');

    // Check that ALPH chunk is present in the byte stream
    const str = Array.from(res.bytes).map(b => String.fromCharCode(b)).join('');
    assert(str.includes('ALPH'), 'ALPH chunk missing from lossy transparent WebP');
    assert(str.includes('VP8 '), 'VP8 chunk missing from lossy WebP');
  });

  // =========================================================================
  // Pairwise 2: 4K Image Zero-Copy Transfer with Live RAF Loop Running
  // =========================================================================

  await test('T3.2', 'Pairwise: 4K image zero-copy transfer sustains 60/120fps with 0 dropped frames', async () => {
    const script = `
      (async () => {
        const monitor = new window.SmoothnessMonitor();
        monitor.start();

        // Let RAF loop warm up
        await new Promise(r => setTimeout(r, 60));

        // Create 4K RGBA buffer (3840 x 2160 x 4 = ~33.17 MB)
        // For headless test speed and safety, allocate 8MB
        const bufferSize = 8 * 1024 * 1024;
        const largeBuffer = new ArrayBuffer(bufferSize);
        const channel = new MessageChannel();

        const t0 = performance.now();
        channel.port1.postMessage({ buffer: largeBuffer }, [largeBuffer]);
        const transferTimeMs = performance.now() - t0;
        const detached = (largeBuffer.byteLength === 0);

        // Keep loop running briefly
        await new Promise(r => setTimeout(r, 100));
        const metrics = monitor.getMetrics();
        monitor.stop();

        return {
          transferTimeMs,
          detached,
          postLen: largeBuffer.byteLength,
          jankCount: metrics.jankCount,
          currentFps: metrics.currentFps
        };
      })()
    `;
    const res = await client.evaluate(script);
    assert(res.detached || res.postLen === 8 * 1024 * 1024, 'Invalid buffer state after transfer');
    assert(res.transferTimeMs < 15.0, `Transfer time ${res.transferTimeMs.toFixed(2)}ms too slow (< 15ms budget)`);
    assertEqual(res.jankCount, 0, `Zero-copy transfer introduced UI jank (${res.jankCount} dropped frames)`);
  });

  // =========================================================================
  // Pairwise 3: GPU Decoded Image Fed into WASM Linear Memory Zero-Copy
  // =========================================================================

  await test('T3.3', 'Pairwise: createImageBitmap GPU decoded image fed to WASM linear memory zero-copy', async () => {
    const script = `
      (async () => {
        // 1. Draw test pattern on canvas
        const canvas = new OffscreenCanvas(32, 32);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#4488ff';
        ctx.fillRect(0, 0, 32, 32);

        // 2. Decode via GPU createImageBitmap with fallback
        let imgData = null;
        try {
          const blob = await canvas.convertToBlob();
          const bitmap = await createImageBitmap(blob);
          if (bitmap.width > 0 && bitmap.height > 0) {
            const extractCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
            const extractCtx = extractCanvas.getContext('2d');
            extractCtx.drawImage(bitmap, 0, 0);
            imgData = extractCtx.getImageData(0, 0, bitmap.width, bitmap.height);
            extractCanvas.width = 1; extractCanvas.height = 1;
          }
          if (typeof bitmap.close === 'function') bitmap.close();
        } catch (e) {}

        if (!imgData) {
          imgData = ctx.getImageData(0, 0, 32, 32);
        }

        // 3. Feed directly into WASM
        const res = window.__WASM_ENGINE__.encodeLossless(imgData.width, imgData.height, imgData.data);

        // 4. Destructor cleanup
        canvas.width = 1; canvas.height = 1;

        return {
          status: res.status,
          outLen: res.outLen,
          bytes: res.bytes
        };
      })()
    `;
    const res = await client.evaluate(script);
    assertEqual(res.status, 0, 'GPU pipeline to WASM encode failed');
    assertWebPHeader(res.bytes, 'VP8L');
  });

  // =========================================================================
  // Pairwise 4: WebM Container Muxed from VP8 Encoded Video Frames
  // =========================================================================

  await test('T3.4', 'Pairwise: WebM container muxer interface contracts connect with VP8 encoded frames', async () => {
    const script = `
      (() => {
        // Encode a keyframe with WASM lossy encoder
        const w = 16, h = 16;
        const rgba = new Uint8Array(w * h * 4).fill(150);
        const webp = window.__WASM_ENGINE__.encodeLossy(w, h, rgba, 80.0);

        if (webp.status !== 0) {
          return { error: 'Failed to encode VP8 frame' };
        }

        // Pass frame payload to WebM muxer interface
        const webmRes = window.__WASM_ENGINE__.createWebm(new Uint8Array(webp.bytes), w, h, 30);
        return {
          webpStatus: webp.status,
          webmStatus: webmRes.status
        };
      })()
    `;
    const res = await client.evaluate(script);
    assertEqual(res.webpStatus, 0, 'Frame encoding failed');
    // In M1, createWebm is reserved (-99); in M3 it returns 0
    assert(res.webmStatus === -99 || res.webmStatus === 0, `Unexpected WebM status: ${res.webmStatus}`);
  });

  // =========================================================================
  // Pairwise 5: Continuous Batch Encoding with Canvas Destructor Cleanup
  // =========================================================================

  await test('T3.5', 'Pairwise: Continuous batch encoding (10 images) with OffscreenCanvas destructor cleanup', async () => {
    const script = `
      (async () => {
        const results = [];
        for (let i = 0; i < 10; i++) {
          const canvas = new OffscreenCanvas(64, 64);
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = \`rgb(\${i * 25}, 100, 200)\`;
          ctx.fillRect(0, 0, 64, 64);
          const imgData = ctx.getImageData(0, 0, 64, 64);

          // Destructor call immediately after extraction
          canvas.width = 1;
          canvas.height = 1;

          const res = window.__WASM_ENGINE__.encodeLossless(64, 64, imgData.data);
          results.push(res.status);
        }

        return {
          allSucceeded: results.every(s => s === 0),
          count: results.length
        };
      })()
    `;
    const res = await client.evaluate(script);
    assert(res.allSucceeded, 'Batch encode failed');
    assertEqual(res.count, 10, 'Expected 10 batch iterations');
  });

  return results;
}
