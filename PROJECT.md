# Project: Pure-Rust WebAssembly WebP Engine with iOS Metal GPU Pipeline & WebCodecs

## Architecture

A high-performance, ultra-lightweight hybrid image/video processing pipeline designed specifically for iOS Safari (Apple Metal GPU & Apple Silicon) and modern browsers. It achieves zero UI jank (sustaining 60/120fps) by combining Metal hardware-accelerated decoding, Web Worker thread isolation with zero-copy Transferable Objects, pure-Rust WebP SIMD encoding, and WebM/WebCodecs video packaging.

### High-Level Data Flow
```
[User Image / Canvas Input]
         │
         ▼ (postMessage with Transferable ArrayBuffer)
[Web Worker Isolate]
   ├── [Dual-Engine Decoding]:
   │     ├── Bit-exact Lossless: Pure-Rust PNG decoder (100% alpha & hidden RGB preserved)
   │     └── Lossy / Heavy Photos: createImageBitmap (Metal GPU) + OffscreenCanvas (auto EXIF rotate)
   ├── [Zero-Copy Linear Memory]:
   │     ├── alloc_buffer(size) -> heap pointer in WASM memory
   │     ├── new Uint8Array(wasm.memory.buffer, ptr, len).set(pixels)
   │     └── encode_webp(ptr, width, height, quality, is_lossless)
   └── [Pure-Rust WebP Core (webp-rust)]:
         ├── Dual-Module: webp_engine_simd.wasm (Apple Silicon NEON) & webp_engine_scalar.wasm
         ├── Lossless (VP8L): Full alpha transparency, color transforms, entropy coding
         └── Lossy (VP8): Quality 1-100, YUV420 planar, DCT, VP8X+ALPH container
         │
         ▼ (postMessage with Transferable WebP ArrayBuffer)
[Main UI Thread (Vite + TypeScript)]
   ├── Instant Display & Download
   ├── Compression Ratio (% reduction) & Duration (ms)
   └── High-Precision RAF SmoothnessMonitor (60/120fps, dropped frame & jank counter)
```

### Video / WebM Extension Flow
```
[Canvas / Image Sequence]
   ├── Route A (Pure-Rust WebM): Frames -> VP8 Intra-Frames -> EBML WebM Muxer -> .webm
   └── Route B (WebCodecs Safari 16.4+): VideoFrame -> VideoEncoder (H.264 VideoToolbox) -> MP4/WebM Chunks
```

---

## Code Layout

```
d:\2-VibeCode\WASM\
├── .cargo/
│   └── config.toml                  # Default wasm32-unknown-unknown flags & target configs
├── Cargo.toml                        # Cargo workspace root
├── crates/
│   └── webp-engine/                  # Pure-Rust WebAssembly crate (cdylib + rlib)
│       ├── Cargo.toml                # release profile: opt-level="z", lto, strip, panic="abort"
│       └── src/
│           ├── lib.rs                # C-ABI exports, memory management (alloc/free), error codes
│           ├── encoder.rs            # WebP encoding dispatcher (Lossless VP8L / Lossy VP8)
│           ├── muxer.rs              # RIFF/WebP chunk formatting (VP8, VP8L, VP8X, ALPH)
│           └── webm.rs               # Minimal Pure-Rust EBML WebM video container muxer
├── web/                              # Vite + TypeScript Frontend & Playground
│   ├── package.json                  # pnpm dependencies
│   ├── tsconfig.json
│   ├── vite.config.ts                # Static asset serving for .wasm files
│   ├── index.html                    # Playground UI layout
│   ├── src/
│   │   ├── main.ts                   # Main UI entry: Drag-and-drop, sliders, stats, FPS meter
│   │   ├── worker/
│   │   │   ├── worker.ts             # Web Worker entry point
│   │   │   ├── wasm-bridge.ts        # WASM loader, SIMD probe, zero-copy buffer bridge
│   │   │   └── protocol.ts           # Type-safe message contracts between Main and Worker
│   │   ├── gpu/
│   │   │   └── preprocessor.ts       # createImageBitmap + OffscreenCanvas with destructor cleanup
│   │   ├── webcodecs/
│   │   │   └── video-pipeline.ts     # WebCodecs VideoEncoder & WebM packaging
│   │   └── monitor/
│   │       └── smoothness.ts         # High-precision RAF frame delta & 60/120fps jank tracker
│   └── public/
│       └── wasm/                     # webp_engine_simd.wasm & webp_engine_scalar.wasm
├── tests/
│   ├── e2e/                          # Headless browser E2E test suite (obscura / chrome-headless)
│   │   ├── runner.mjs                # E2E test runner
│   │   ├── tier1_features.test.mjs   # Tier 1 tests (>=5 per feature)
│   │   ├── tier2_boundaries.test.mjs # Tier 2 boundary tests
│   │   ├── tier3_pairwise.test.mjs   # Tier 3 cross-feature combinations
│   │   └── tier4_workloads.test.mjs  # Tier 4 real-world workloads
│   └── fixtures/                     # Test images (transparent PNGs, JPEGs, gradient synthetic)
├── scripts/
│   ├── build-wasm.ps1                # Build script: compile SIMD & Scalar + wasm-opt -Oz
│   └── test-e2e.ps1                  # One-command E2E test execution script
├── PROJECT.md
├── TEST_INFRA.md
├── TEST_READY.md
└── README.md
```

---

## Feature Inventory

Every feature requested in `ORIGINAL_REQUEST.md` and uncovered during the Survey phase:

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Pure-Rust WebP Lossless (VP8L) | Bit-exact lossless encoding preserving 100% alpha and color fidelity | M1 | ORIGINAL_REQUEST §R1 |
| 2 | Pure-Rust WebP Lossy (VP8) | Quality adjustable 1-100 with optimal compression ratio | M1 | ORIGINAL_REQUEST §R1 |
| 3 | WASM Binary Size Optimization | Size < 300KB raw and < 80KB gzip via LTO, opt-level="z", strip, wasm-opt | M1 | ORIGINAL_REQUEST §R1, Acceptance |
| 4 | WASM SIMD128 Hardware Acceleration | Vectorized 128-bit instructions for Apple Silicon A/M-series NEON | M1 | ORIGINAL_REQUEST §R1 |
| 5 | Dual-Module Fallback (Scalar/SIMD) | Automatic 35-byte JS probe selecting SIMD or Scalar WASM safely | M1 | Survey Explorer 2 |
| 6 | Direct C-ABI & Heap Memory Bridge | `alloc_buffer` / `free_buffer` without wasm-bindgen glue bloat | M1 | Survey Explorer 1 & 2 |
| 7 | Web Worker Thread Isolation | 100% background processing of WASM, unblocking Main UI thread | M2 | ORIGINAL_REQUEST §R2 |
| 8 | Zero-Copy Transferable Objects | `postMessage(msg, [buffer])` transfer in < 0.05ms without RAM clone | M2 | ORIGINAL_REQUEST §R2, Acceptance |
| 9 | Metal GPU Accelerated Preprocessing | `createImageBitmap` with hardware decode & auto-orientation | M2 | ORIGINAL_REQUEST §R2, Spec Miner |
| 10 | OffscreenCanvas Pixel Normalization | Worker-based canvas extraction with dimension clamping (< 4096px) | M2 | ORIGINAL_REQUEST §R2, Spec Miner |
| 11 | Canvas Destructor & Memory Reclamation | Immediate release of iOS Safari Metal backing store (`1x1` reset) | M2 | Spec Miner 1 |
| 12 | Pure-Rust Minimal WebM Muxer | Lightweight EBML container builder (< 5KB) packaging VP8 video frames | M3 | ORIGINAL_REQUEST §R3, Spec Miner |
| 13 | Safari 16.4+ WebCodecs Connection | Integration with `VideoEncoder` / `VideoFrame` (VideoToolbox H.264) | M3 | ORIGINAL_REQUEST §R3, Spec Miner |
| 14 | Vite + TypeScript Playground UI | Interactive web UI for drag-and-drop, sliders, and download | M4 | ORIGINAL_REQUEST §R4 |
| 15 | Live Before/After Comparison & Stats | Visual preview, % reduction, compression duration in milliseconds | M4 | ORIGINAL_REQUEST §R4 |
| 16 | 60/120fps High-Precision Smoothness Monitor | RAF loop measuring instant FPS, rolling average, and jank count | M4 | ORIGINAL_REQUEST §R4, Acceptance |
| 17 | Comprehensive E2E Testing Suite (Tiers 1-4) | Opaque-box automated tests covering all features, boundaries, and workloads | M-E2E | Project Pattern Dual Track |
| 18 | Tier 5 Adversarial Coverage Hardening | Edge dimensions, memory stability, corrupt input rejection stress tests | M5 | Project Pattern Final Milestone |

---

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M-E2E | E2E Testing Suite (Tiers 1-4) | Test infrastructure, test runner, test fixtures, Tiers 1-4 test cases, publishes TEST_READY.md | none (Opaque-box) | PLANNED |
| M1 | Pure-Rust WebP SIMD WASM Engine | `crates/webp-engine`: VP8L Lossless, VP8 Lossy, C-ABI memory, Dual-Module SIMD/Scalar builds, wasm-opt <300KB | none | PLANNED |
| M2 | Zero-Copy Web Worker & GPU Preprocessing | `web/src/worker`, `web/src/gpu`: Transferable Objects, OffscreenCanvas, createImageBitmap, canvas destructor | M1 | PLANNED |
| M3 | WebM Container Muxer & WebCodecs Pipeline | Pure-Rust/TS WebM EBML muxer, Safari 16.4+ VideoEncoder connection | M1, M2 | PLANNED |
| M4 | Vite Demo Playground & 60/120fps UI Monitor | `web/`: Drag-and-drop UI, before/after compare, quality slider, SmoothnessMonitor FPS meter | M2, M3 | PLANNED |
| M5 | Final E2E Integration & Adversarial Hardening | Pass 100% E2E tests (Tiers 1-4), Tier 5 adversarial stress testing, Forensic Integrity Audit | M-E2E, M4 | PLANNED |

---

## Interface Contracts

### 1. Rust WASM C-ABI Exports (`crates/webp-engine/src/lib.rs`)

```rust
// Memory allocation and deallocation
#[no_mangle]
pub extern "C" fn alloc_buffer(size: usize) -> *mut u8;

#[no_mangle]
pub unsafe extern "C" fn free_buffer(ptr: *mut u8, size: usize);

// WebP Encoding functions
// Output buffer pointer and length written to out_ptr and out_len pointers
#[no_mangle]
pub unsafe extern "C" fn encode_lossless_webp(
    in_ptr: *const u8,
    width: u32,
    height: u32,
    out_ptr: *mut *mut u8,
    out_len: *mut usize,
) -> i32; // Returns 0 on success, negative error code on failure

#[no_mangle]
pub unsafe extern "C" fn encode_lossy_webp(
    in_ptr: *const u8,
    width: u32,
    height: u32,
    quality: f32, // 1.0 to 100.0
    out_ptr: *mut *mut u8,
    out_len: *mut usize,
) -> i32; // Returns 0 on success, negative error code on failure

// Minimal WebM Muxer exports
#[no_mangle]
pub unsafe extern "C" fn create_webm_video(
    frames_ptr: *const u8,
    frames_len: usize,
    width: u32,
    height: u32,
    fps: u32,
    out_ptr: *mut *mut u8,
    out_len: *mut usize,
) -> i32;
```

### 2. Main Thread ↔ Web Worker Message Protocol (`web/src/worker/protocol.ts`)

```typescript
export interface EncodeRequest {
  type: 'ENCODE';
  id: string;
  buffer: ArrayBuffer;      // Raw RGBA pixels transferred zero-copy
  width: number;
  height: number;
  quality: number;          // 1 - 100
  isLossless: boolean;      // true = VP8L, false = VP8
}

export interface EncodeResponse {
  type: 'ENCODE_RESULT';
  id: string;
  success: boolean;
  webpBuffer?: ArrayBuffer; // Encoded WebP bytes transferred zero-copy
  originalSize: number;
  compressedSize: number;
  durationMs: number;
  error?: string;
}

export interface WebmMuxRequest {
  type: 'MUX_WEBM';
  id: string;
  frames: ArrayBuffer[];    // Transferred zero-copy
  width: number;
  height: number;
  fps: number;
}

export interface WebmMuxResponse {
  type: 'MUX_WEBM_RESULT';
  id: string;
  success: boolean;
  webmBuffer?: ArrayBuffer; // Transferred zero-copy
  error?: string;
}
```

### 3. SmoothnessMonitor API (`web/src/monitor/smoothness.ts`)

```typescript
export interface SmoothnessMetrics {
  currentFps: number;       // Instant FPS
  rollingAvgFps: number;    // 60-frame average
  jankCount: number;        // Number of frames exceeding threshold (>22ms on 60Hz, >12ms on 120Hz)
  droppedFrames: number;    // Estimated dropped frames
}

export class SmoothnessMonitor {
  start(onTick: (metrics: SmoothnessMetrics) => void): void;
  stop(): void;
  getMetrics(): SmoothnessMetrics;
}
```
