/// <reference lib="webworker" />
import { WasmBridge } from './wasm-bridge';
import type { WorkerInMessage, EncodeResponse, WebmMuxResponse } from './protocol';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const bridge = new WasmBridge();
let initPromise: Promise<void> | null = null;

async function ensureInitialized() {
  if (!initPromise) {
    initPromise = bridge.init();
  }
  await initPromise;
}

ctx.onmessage = async (e: MessageEvent<WorkerInMessage>) => {
  const msg = e.data;

  try {
    await ensureInitialized();

    if (msg.type === 'ENCODE') {
      const startTime = performance.now();
      const rgba = new Uint8Array(msg.buffer);
      const originalSize = msg.buffer.byteLength;

      let webpBytes: Uint8Array;
      if (msg.isLossless) {
        webpBytes = bridge.encodeLossless(msg.width, msg.height, rgba);
      } else {
        webpBytes = bridge.encodeLossy(msg.width, msg.height, rgba, msg.quality);
      }

      const durationMs = Math.round((performance.now() - startTime) * 100) / 100;
      const webpBuffer = webpBytes.buffer as ArrayBuffer;

      const response: EncodeResponse = {
        type: 'ENCODE_RESULT',
        id: msg.id,
        success: true,
        webpBuffer,
        originalSize,
        compressedSize: webpBytes.byteLength,
        durationMs
      };

      // Transfer ownership zero-copy back to Main UI Thread
      ctx.postMessage(response, [webpBuffer]);
    } else if (msg.type === 'MUX_WEBM') {
      let totalBytes = 0;
      for (const f of msg.frames) totalBytes += f.byteLength;

      const combined = new Uint8Array(totalBytes);
      let offset = 0;
      for (const f of msg.frames) {
        combined.set(new Uint8Array(f), offset);
        offset += f.byteLength;
      }

      const webmBytes = bridge.createWebm(combined, msg.width, msg.height, msg.fps);
      const webmBuffer = webmBytes.buffer as ArrayBuffer;

      const response: WebmMuxResponse = {
        type: 'MUX_WEBM_RESULT',
        id: msg.id,
        success: true,
        webmBuffer
      };

      ctx.postMessage(response, [webmBuffer]);
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (msg.type === 'ENCODE') {
      const response: EncodeResponse = {
        type: 'ENCODE_RESULT',
        id: msg.id,
        success: false,
        originalSize: msg.buffer ? msg.buffer.byteLength : 0,
        compressedSize: 0,
        durationMs: 0,
        error: errorMsg
      };
      ctx.postMessage(response);
    } else {
      const response: WebmMuxResponse = {
        type: 'MUX_WEBM_RESULT',
        id: msg.id,
        success: false,
        error: errorMsg
      };
      ctx.postMessage(response);
    }
  }
};
