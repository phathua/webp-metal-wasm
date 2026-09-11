/**
 * WASM Engine Bridge
 * 
 * Handles dynamic detection of SIMD128, loading of the appropriate WASM module,
 * and zero-copy memory operations between JS and WASM linear memory.
 */

export interface WasmExports {
  memory: WebAssembly.Memory;
  alloc_buffer: (size: number) => number;
  free_buffer: (ptr: number, size: number) => void;
  encode_lossless_webp: (
    in_ptr: number,
    width: number,
    height: number,
    out_ptr: number,
    out_len: number
  ) => number;
  encode_lossy_webp: (
    in_ptr: number,
    width: number,
    height: number,
    quality: number,
    out_ptr: number,
    out_len: number
  ) => number;
  create_webm_video: (
    frames_ptr: number,
    frames_len: number,
    width: number,
    height: number,
    fps: number,
    out_ptr: number,
    out_len: number
  ) => number;
}

export class WasmBridge {
  private exports: WasmExports | null = null;
  private isSimd = false;

  /**
   * Probes whether the current JS engine supports WASM SIMD128.
   */
  public static isSimdSupported(): boolean {
    try {
      // 35-byte minimal WASM module using SIMD i8x16.splat opcode
      const simdBytes = new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
        0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b,
        0x03, 0x02, 0x01, 0x00,
        0x0a, 0x0a, 0x01, 0x08, 0x00, 0x41, 0x00, 0xfd, 0x0f, 0x0b
      ]);
      return WebAssembly.validate(simdBytes);
    } catch {
      return false;
    }
  }

  /**
   * Initializes the WASM engine, choosing SIMD or Scalar build automatically.
   */
  public async init(wasmBaseUrl = '/wasm/'): Promise<void> {
    if (this.exports) return;

    this.isSimd = WasmBridge.isSimdSupported();
    const fileName = this.isSimd ? 'webp_engine_simd.wasm' : 'webp_engine_scalar.wasm';
    const wasmUrl = `${wasmBaseUrl}${fileName}`;

    let response: Response;
    try {
      response = await fetch(wasmUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${wasmUrl}: ${response.statusText}`);
      }
    } catch (err) {
      // Fallback to scalar if SIMD failed to fetch
      if (this.isSimd) {
        this.isSimd = false;
        response = await fetch(`${wasmBaseUrl}webp_engine_scalar.wasm`);
      } else {
        throw err;
      }
    }

    const wasmBinary = await response.arrayBuffer();
    const { instance } = await WebAssembly.instantiate(wasmBinary, {});
    this.exports = instance.exports as unknown as WasmExports;
  }

  public getIsSimd(): boolean {
    return this.isSimd;
  }

  private ensureExports(): WasmExports {
    if (!this.exports) {
      throw new Error('WASM Engine not initialized. Call init() first.');
    }
    return this.exports;
  }

  /**
   * Encodes RGBA pixel buffer into Lossless WebP.
   */
  public encodeLossless(width: number, height: number, rgba: Uint8Array): Uint8Array {
    const exports = this.ensureExports();
    const inLen = width * height * 4;
    if (rgba.byteLength !== inLen) {
      throw new Error(`Buffer length ${rgba.byteLength} does not match width*height*4 (${inLen})`);
    }

    const inPtr = exports.alloc_buffer(inLen);
    new Uint8Array(exports.memory.buffer, inPtr, inLen).set(rgba);

    const outPtrHolder = exports.alloc_buffer(4);
    const outLenHolder = exports.alloc_buffer(4);

    try {
      const status = exports.encode_lossless_webp(inPtr, width, height, outPtrHolder, outLenHolder);
      if (status !== 0) {
        throw new Error(`encode_lossless_webp failed with status code ${status}`);
      }

      const outPtr = new DataView(exports.memory.buffer).getUint32(outPtrHolder, true);
      const outLen = new DataView(exports.memory.buffer).getUint32(outLenHolder, true);

      const result = new Uint8Array(exports.memory.buffer, outPtr, outLen).slice();
      exports.free_buffer(outPtr, outLen);
      return result;
    } finally {
      exports.free_buffer(inPtr, inLen);
      exports.free_buffer(outPtrHolder, 4);
      exports.free_buffer(outLenHolder, 4);
    }
  }

  /**
   * Encodes RGBA pixel buffer into Lossy WebP with quality 1.0 - 100.0.
   */
  public encodeLossy(width: number, height: number, rgba: Uint8Array, quality: number): Uint8Array {
    const exports = this.ensureExports();
    const inLen = width * height * 4;
    if (rgba.byteLength !== inLen) {
      throw new Error(`Buffer length ${rgba.byteLength} does not match width*height*4 (${inLen})`);
    }

    const inPtr = exports.alloc_buffer(inLen);
    new Uint8Array(exports.memory.buffer, inPtr, inLen).set(rgba);

    const outPtrHolder = exports.alloc_buffer(4);
    const outLenHolder = exports.alloc_buffer(4);

    try {
      const status = exports.encode_lossy_webp(inPtr, width, height, quality, outPtrHolder, outLenHolder);
      if (status !== 0) {
        throw new Error(`encode_lossy_webp failed with status code ${status}`);
      }

      const outPtr = new DataView(exports.memory.buffer).getUint32(outPtrHolder, true);
      const outLen = new DataView(exports.memory.buffer).getUint32(outLenHolder, true);

      const result = new Uint8Array(exports.memory.buffer, outPtr, outLen).slice();
      exports.free_buffer(outPtr, outLen);
      return result;
    } finally {
      exports.free_buffer(inPtr, inLen);
      exports.free_buffer(outPtrHolder, 4);
      exports.free_buffer(outLenHolder, 4);
    }
  }

  /**
   * Muxes frames into a minimal WebM container.
   */
  public createWebm(frames: Uint8Array, width: number, height: number, fps: number): Uint8Array {
    const exports = this.ensureExports();
    const inLen = frames.byteLength;
    const inPtr = exports.alloc_buffer(inLen);
    new Uint8Array(exports.memory.buffer, inPtr, inLen).set(frames);

    const outPtrHolder = exports.alloc_buffer(4);
    const outLenHolder = exports.alloc_buffer(4);

    try {
      const status = exports.create_webm_video(inPtr, inLen, width, height, fps, outPtrHolder, outLenHolder);
      if (status !== 0) {
        throw new Error(`create_webm_video failed with status code ${status}`);
      }

      const outPtr = new DataView(exports.memory.buffer).getUint32(outPtrHolder, true);
      const outLen = new DataView(exports.memory.buffer).getUint32(outLenHolder, true);

      const result = new Uint8Array(exports.memory.buffer, outPtr, outLen).slice();
      exports.free_buffer(outPtr, outLen);
      return result;
    } finally {
      exports.free_buffer(inPtr, inLen);
      exports.free_buffer(outPtrHolder, 4);
      exports.free_buffer(outLenHolder, 4);
    }
  }
}
