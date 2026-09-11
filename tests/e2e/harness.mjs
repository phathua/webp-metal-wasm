import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserClient } from './browser-client.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const FIXTURES_DIR = path.join(ROOT_DIR, 'tests', 'fixtures');

export function getWasmPaths() {
  const candidates = [
    path.join(ROOT_DIR, 'target', 'wasm32-unknown-unknown', 'release', 'webp_engine.wasm'),
    path.join(ROOT_DIR, 'web', 'public', 'wasm', 'webp_engine_simd.wasm'),
    path.join(ROOT_DIR, 'web', 'public', 'wasm', 'webp_engine_scalar.wasm'),
    path.join(ROOT_DIR, 'target', 'wasm32-unknown-unknown', 'debug', 'webp_engine.wasm')
  ];

  const found = candidates.filter(p => fs.existsSync(p));
  return {
    candidates,
    found,
    primary: found[0] || null
  };
}

export function getWasmBuffer() {
  const { primary } = getWasmPaths();
  if (!primary) {
    throw new Error('Compiled webp_engine.wasm not found in target/ or web/public/wasm/');
  }
  return fs.readFileSync(primary);
}

export function getWasmBase64() {
  return getWasmBuffer().toString('base64');
}

export function getFixtures() {
  const metaPath = path.join(FIXTURES_DIR, 'fixtures.json');
  if (!fs.existsSync(metaPath)) {
    throw new Error(`Fixtures not found at ${metaPath}. Run generate-fixtures.mjs first.`);
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  const loaded = {};

  for (const [key, item] of Object.entries(meta)) {
    const filePath = path.join(FIXTURES_DIR, item.file);
    if (fs.existsSync(filePath)) {
      loaded[key] = {
        ...item,
        buffer: fs.readFileSync(filePath),
        base64: fs.readFileSync(filePath).toString('base64')
      };
    }
  }

  return loaded;
}

/**
 * Script injected into the browser to instantiate and expose WASM Engine helpers
 */
export function getWasmBridgeInjectionScript(wasmBase64) {
  return `
    (async () => {
      const wasmB64 = ${JSON.stringify(wasmBase64)};
      const binaryString = atob(wasmB64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const { instance, module } = await WebAssembly.instantiate(bytes.buffer);
      const exports = instance.exports;

      window.__WASM_ENGINE__ = {
        exports,
        memory: exports.memory,

        alloc(size) {
          return exports.alloc_buffer(size);
        },

        free(ptr, size) {
          return exports.free_buffer(ptr, size);
        },

        encodeLossless(width, height, rgbaBytes) {
          const inLen = width * height * 4;
          const inPtr = exports.alloc_buffer(inLen);
          new Uint8Array(exports.memory.buffer, inPtr, inLen).set(rgbaBytes);

          const outPtrHolder = exports.alloc_buffer(4);
          const outLenHolder = exports.alloc_buffer(4);

          const status = exports.encode_lossless_webp(inPtr, width, height, outPtrHolder, outLenHolder);
          let resultBytes = null;
          let outLen = 0;

          if (status === 0) {
            const outPtr = new DataView(exports.memory.buffer).getUint32(outPtrHolder, true);
            outLen = new DataView(exports.memory.buffer).getUint32(outLenHolder, true);
            resultBytes = Array.from(new Uint8Array(exports.memory.buffer, outPtr, outLen));
            exports.free_buffer(outPtr, outLen);
          }

          exports.free_buffer(inPtr, inLen);
          exports.free_buffer(outPtrHolder, 4);
          exports.free_buffer(outLenHolder, 4);

          return { status, outLen, bytes: resultBytes };
        },

        encodeLossy(width, height, rgbaBytes, quality) {
          const inLen = width * height * 4;
          const inPtr = exports.alloc_buffer(inLen);
          new Uint8Array(exports.memory.buffer, inPtr, inLen).set(rgbaBytes);

          const outPtrHolder = exports.alloc_buffer(4);
          const outLenHolder = exports.alloc_buffer(4);

          const status = exports.encode_lossy_webp(inPtr, width, height, quality, outPtrHolder, outLenHolder);
          let resultBytes = null;
          let outLen = 0;

          if (status === 0) {
            const outPtr = new DataView(exports.memory.buffer).getUint32(outPtrHolder, true);
            outLen = new DataView(exports.memory.buffer).getUint32(outLenHolder, true);
            resultBytes = Array.from(new Uint8Array(exports.memory.buffer, outPtr, outLen));
            exports.free_buffer(outPtr, outLen);
          }

          exports.free_buffer(inPtr, inLen);
          exports.free_buffer(outPtrHolder, 4);
          exports.free_buffer(outLenHolder, 4);

          return { status, outLen, bytes: resultBytes };
        },

        createWebm(framesData, width, height, fps) {
          const inLen = framesData.length;
          const inPtr = exports.alloc_buffer(inLen);
          new Uint8Array(exports.memory.buffer, inPtr, inLen).set(framesData);

          const outPtrHolder = exports.alloc_buffer(4);
          const outLenHolder = exports.alloc_buffer(4);

          const status = exports.create_webm_video(inPtr, inLen, width, height, fps, outPtrHolder, outLenHolder);
          let resultBytes = null;
          let outLen = 0;

          if (status === 0) {
            const outPtr = new DataView(exports.memory.buffer).getUint32(outPtrHolder, true);
            outLen = new DataView(exports.memory.buffer).getUint32(outLenHolder, true);
            resultBytes = Array.from(new Uint8Array(exports.memory.buffer, outPtr, outLen));
            exports.free_buffer(outPtr, outLen);
          }

          exports.free_buffer(inPtr, inLen);
          exports.free_buffer(outPtrHolder, 4);
          exports.free_buffer(outLenHolder, 4);

          return { status, outLen, bytes: resultBytes };
        }
      };

      return {
        initialized: true,
        exports: Object.keys(exports)
      };
    })()
  `;
}

/**
 * Script injected into browser for SmoothnessMonitor testing
 */
export function getSmoothnessMonitorInjectionScript() {
  return `
    (() => {
      window.SmoothnessMonitor = class SmoothnessMonitor {
        constructor() {
          this.lastTime = performance.now();
          this.frameDeltas = [];
          this.droppedFrames = 0;
          this.jankCount = 0;
          this.currentFps = 60;
          this.animId = 0;
          this.isRunning = false;
        }

        start(onTick) {
          this.isRunning = true;
          this.lastTime = performance.now();
          this.frameDeltas = [];
          this.droppedFrames = 0;
          this.jankCount = 0;

          const loop = (now) => {
            if (!this.isRunning) return;
            const delta = now - this.lastTime;
            this.lastTime = now;

            // Clamping for tab suspension
            if (delta < 150) {
              this.frameDeltas.push(delta);
              if (this.frameDeltas.length > 60) {
                this.frameDeltas.shift();
              }

              // Jank threshold (>22ms on 60Hz, >12ms on 120Hz)
              if (delta > 22) {
                this.droppedFrames++;
                this.jankCount++;
              }

              const avgDelta = this.frameDeltas.reduce((a, b) => a + b, 0) / this.frameDeltas.length;
              this.currentFps = Math.round(1000 / avgDelta);

              if (onTick) {
                onTick({
                  currentFps: this.currentFps,
                  rollingAvgFps: this.currentFps,
                  jankCount: this.jankCount,
                  droppedFrames: this.droppedFrames
                });
              }
            }

            this.animId = requestAnimationFrame(loop);
          };

          this.animId = requestAnimationFrame(loop);
        }

        stop() {
          this.isRunning = false;
          if (this.animId) {
            cancelAnimationFrame(this.animId);
            this.animId = 0;
          }
        }

        getMetrics() {
          const avgDelta = this.frameDeltas.length > 0 
            ? this.frameDeltas.reduce((a, b) => a + b, 0) / this.frameDeltas.length 
            : 16.67;
          return {
            currentFps: this.currentFps,
            rollingAvgFps: Math.round(1000 / avgDelta),
            jankCount: this.jankCount,
            droppedFrames: this.droppedFrames
          };
        }
      };

      return true;
    })()
  `;
}

export async function createTestEnvironment(options = {}) {
  const client = new BrowserClient({
    browser: options.browser || 'auto',
    port: options.port,
    verbose: options.verbose
  });

  await client.launch();

  const fixtures = getFixtures();
  let wasmBase64 = '';
  try {
    wasmBase64 = getWasmBase64();
  } catch (e) {
    // WASM might not be compiled yet
  }

  // Inject WASM module and SmoothnessMonitor into browser context if WASM is available
  if (wasmBase64) {
    await client.evaluate(getWasmBridgeInjectionScript(wasmBase64));
  }
  await client.evaluate(getSmoothnessMonitorInjectionScript());

  return {
    client,
    fixtures,
    wasmBase64,
    async reinitWasm() {
      if (wasmBase64) {
        return await client.evaluate(getWasmBridgeInjectionScript(wasmBase64));
      }
    },
    async close() {
      await client.close();
    }
  };
}
