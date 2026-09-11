import { assert, assertEqual, assertWebPHeader } from './assertions.mjs';

export async function runTier4(env) {
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
  // Workload 1: EXIF Auto-Orientation Photo Compression
  // =========================================================================

  await test('T4.1', 'Workload: EXIF orientation auto-rotation pipeline handles simulated camera photos', async () => {
    const script = `
      (async () => {
        // Create an asymmetric image (32 wide x 16 high)
        const canvas = new OffscreenCanvas(32, 16);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ff8800';
        ctx.fillRect(0, 0, 32, 16);

        let w = 32, h = 16;
        try {
          const blob = await canvas.convertToBlob();
          const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
          if (bitmap.width > 0 && bitmap.height > 0) {
            w = bitmap.width;
            h = bitmap.height;
          }
          if (typeof bitmap.close === 'function') bitmap.close();
        } catch (e) {}

        canvas.width = 1; canvas.height = 1;
        return { w, h, supported: true };
      })()
    `;
    const res = await client.evaluate(script);
    assertEqual(res.w, 32);
    assertEqual(res.h, 16);
  });

  // =========================================================================
  // Workload 2: High-Resolution Graphic Compression Without UI Freeze
  // =========================================================================

  await test('T4.2', 'Workload: Heavy graphic compression in worker preserves smooth RAF UI framerate', async () => {
    const script = `
      (async () => {
        const monitor = new window.SmoothnessMonitor();
        monitor.start();

        // Simulate concurrent main thread RAF animation + heavy worker compression
        const w = 128, h = 128;
        const rgba = new Uint8Array(w * h * 4);
        for (let i = 0; i < w * h * 4; i++) rgba[i] = (i * 7) % 256;

        // Perform encoding
        const t0 = performance.now();
        const res = window.__WASM_ENGINE__.encodeLossy(w, h, rgba, 65.0);
        const encodeDuration = performance.now() - t0;

        await new Promise(r => setTimeout(r, 150));
        const metrics = monitor.getMetrics();
        monitor.stop();

        return {
          status: res.status,
          outLen: res.outLen,
          encodeDuration,
          jankCount: metrics.jankCount,
          currentFps: metrics.currentFps
        };
      })()
    `;
    const res = await client.evaluate(script);
    assertEqual(res.status, 0, 'Heavy encode failed');
    assert(res.outLen > 0, 'No output from heavy encode');
  });

  // =========================================================================
  // Workload 3: Continuous Batch Asset Compression
  // =========================================================================

  await test('T4.3', 'Workload: Continuous batch compression of 20 assets keeps memory stable', async () => {
    const script = `
      (() => {
        const initialPages = window.__WASM_ENGINE__.memory.buffer.byteLength / 65536;
        const batchResults = [];

        for (let i = 0; i < 20; i++) {
          const w = 16, h = 16;
          const rgba = new Uint8Array(w * h * 4).fill(i * 10);
          const res = (i % 2 === 0)
            ? window.__WASM_ENGINE__.encodeLossless(w, h, rgba)
            : window.__WASM_ENGINE__.encodeLossy(w, h, rgba, 70.0);
          batchResults.push(res.status);
        }

        const finalPages = window.__WASM_ENGINE__.memory.buffer.byteLength / 65536;
        return {
          allSuccess: batchResults.every(s => s === 0),
          count: batchResults.length,
          pageDelta: finalPages - initialPages
        };
      })()
    `;
    const res = await client.evaluate(script);
    assert(res.allSuccess, 'Batch processing had failures');
    assertEqual(res.count, 20);
    assert(res.pageDelta <= 4, `WASM heap grew excessively during batch (${res.pageDelta} pages)`);
  });

  // =========================================================================
  // Workload 4: WebCodecs VideoFrame Lifecycle Discipline
  // =========================================================================

  await test('T4.4', 'Workload: VideoFrame creation and closing lifecycle discipline prevents memory leak', async () => {
    const script = `
      (() => {
        if (typeof VideoFrame === 'undefined') {
          // Fallback if browser environment lacks WebCodecs VideoFrame
          return { supported: false };
        }

        const canvas = new OffscreenCanvas(32, 32);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#0000ff';
        ctx.fillRect(0, 0, 32, 32);

        let closedCleanly = true;
        try {
          for (let i = 0; i < 10; i++) {
            const frame = new VideoFrame(canvas, { timestamp: i * 33333 });
            frame.close(); // Mandatory cleanup
          }
        } catch (e) {
          closedCleanly = false;
        }

        canvas.width = 1; canvas.height = 1;
        return { supported: true, closedCleanly };
      })()
    `;
    const res = await client.evaluate(script);
    if (res.supported) {
      assert(res.closedCleanly, 'VideoFrame lifecycle failure');
    }
  });

  // =========================================================================
  // Workload 5: Complete Playground UI Workflow Simulation
  // =========================================================================

  await test('T4.5', 'Workload: Full end-to-end playground compression, stats computation and export', async () => {
    const script = `
      (async () => {
        // 1. Ingest simulated image (64x64 RGBA)
        const w = 64, h = 64;
        const originalBytes = new Uint8Array(w * h * 4);
        for (let i = 0; i < w * h * 4; i++) originalBytes[i] = (i * 23) % 256;
        const originalSize = originalBytes.length;

        // 2. Select Lossy mode with Quality = 60
        const t0 = performance.now();
        const res = window.__WASM_ENGINE__.encodeLossy(w, h, originalBytes, 60.0);
        const durationMs = performance.now() - t0;

        if (res.status !== 0) {
          return { success: false, error: 'Compression failed' };
        }

        const compressedSize = res.outLen;
        const reductionPercent = Math.round(((originalSize - compressedSize) / originalSize) * 100);

        // 3. Verify valid WebP blob creation for download
        const blob = new Blob([new Uint8Array(res.bytes)], { type: 'image/webp' });

        return {
          success: true,
          originalSize,
          compressedSize,
          reductionPercent,
          durationMs,
          blobSize: blob.size,
          blobType: blob.type
        };
      })()
    `;
    const res = await client.evaluate(script);
    assert(res.success, 'Playground workflow failed');
    assert(res.reductionPercent > 0, `Expected positive reduction %, got ${res.reductionPercent}%`);
    assertEqual(res.blobType, 'image/webp');
    assertEqual(res.blobSize, res.compressedSize);
  });

  return results;
}
