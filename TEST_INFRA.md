# TEST_INFRA — Comprehensive E2E Testing Infrastructure

## 1. Executive Summary & Testing Philosophy

This document specifies the end-to-end (E2E) testing infrastructure for the **Pure-Rust WebAssembly WebP Engine with iOS Metal GPU Pipeline & WebCodecs**.

### Dual-Track Testing Principles
1. **Opaque-Box Independence**: E2E tests interact with the system strictly through defined interface contracts, C-ABI boundaries, Web Worker protocols, and observable browser behaviors (DOM, RAF deltas, byte signatures, canvas states). Tests make zero assumptions about internal private algorithms.
2. **Progressive Testability**: Tests are designed to validate components as each milestone completes without requiring unbuilt future milestones. When earlier milestones (M1: WASM core, M2: Web Worker & GPU) are in place, the harness executes against the compiled artifacts.
3. **Deterministic Verification Oracles**: Every test derives its expected outcome from authoritative specifications:
   - WebP RIFF Container Specification & RFC 6386 (VP8 bitstream) / VP8L lossless specification.
   - Matroska / EBML RFC 8794 specification for WebM video containers.
   - W3C HTML Living Standard (`createImageBitmap`, `Transferable` objects, `OffscreenCanvas`).
   - W3C High Resolution Time Level 2 & ProMotion 60/120fps frame budget constraints.
4. **Adversarial & Stress Hardening**: In addition to standard happy paths, the suite subjects the engine to corrupt inputs, memory boundary stresses (4096px canvas ceiling), detached ArrayBuffer guards, and rapid allocation churn.

---

## 2. Browser Automation Environment & Detection Hierarchy

Headless browser automation executes with zero GUI overhead, adhering strictly to workspace environment conventions:

### Priority 1: Obscura (`obscura.exe`)
- **Location**: `D:\DevEnv\browsers\obscura\obscura.exe`
- **Architecture**: Rust-based ultra-lightweight headless browser with built-in stealth, instant startup, and native Chrome DevTools Protocol (CDP) compatibility.
- **CDP Mode**: Invoked with `serve --port <PORT> --allow-private-network --allow-file-access`.
- **Target Endpoint**: `ws://127.0.0.1:<PORT>/devtools/browser`.

### Priority 2: Chrome Headless Shell (`chrome-headless-shell.exe`)
- **Location**: `D:\DevEnv\browsers\chrome-headless-shell\win64-152.0.7977.54\chrome-headless-shell-win64\chrome-headless-shell.exe`
- **Role**: Secondary fallback when standard Chromium engine parity or extended headless diagnostics are required.
- **Invocation**: `--remote-debugging-port=<PORT> --headless --disable-gpu`.

The test runner detects available binaries automatically, defaulting to **Obscura**, and seamlessly falls back to **Chrome Headless Shell** if Obscura is unavailable or explicitly overridden via CLI arguments.

---

## 3. Feature Inventory & Traceability Matrix

Every feature defined in `ORIGINAL_REQUEST.md` and `PROJECT.md` is mapped across the 4 testing tiers:

| Feature # | Feature Name | Source | Milestones | Primary Tier | Target Verification Oracle |
|---|---|---|---|---|---|
| F-01 | Pure-Rust WebP Lossless (VP8L) | ORIGINAL_REQUEST §R1 | M1 | Tier 1, Tier 2 | RIFF/WEBP/VP8L header, 100% bit-exact RGBA color + alpha roundtrip |
| F-02 | Pure-Rust WebP Lossy (VP8) | ORIGINAL_REQUEST §R1 | M1 | Tier 1, Tier 2 | RIFF/WEBP/VP8 header, quality 1-100 scaling, 40-80% file size reduction |
| F-03 | WASM Binary Size Optimization | ORIGINAL_REQUEST §R1, Acceptance | M1 | Tier 1 | Raw `.wasm` < 300KB, gzip compressed < 80KB, stripped debug symbols |
| F-04 | WASM SIMD128 Hardware Acceleration | ORIGINAL_REQUEST §R1 | M1 | Tier 1, Tier 3 | Dual-module build, SIMD feature probe, 128-bit vector execution |
| F-05 | Dual-Module Fallback (Scalar/SIMD) | PROJECT.md §Feature 5 | M1 | Tier 1 | 35-byte JS WebAssembly probe correctly detects runtime capability |
| F-06 | Direct C-ABI & Linear Heap Bridge | PROJECT.md §Interface 1 | M1 | Tier 1, Tier 2 | `alloc_buffer`, `free_buffer`, pointer alignment, null pointer rejection |
| F-07 | Web Worker Thread Isolation | ORIGINAL_REQUEST §R2 | M2 | Tier 1, Tier 3 | Main UI thread remains responsive; 0 execution blocking during encoding |
| F-08 | Zero-Copy Transferable Objects | ORIGINAL_REQUEST §R2, Acceptance | M2 | Tier 1, Tier 2 | Sender ArrayBuffer detached (`byteLength === 0`), transfer duration < 1ms |
| F-09 | Metal GPU Accelerated Preprocessing | ORIGINAL_REQUEST §R2, Spec Miner | M2 | Tier 1, Tier 4 | `createImageBitmap` asynchronous decode with `imageOrientation: 'from-image'` |
| F-10 | OffscreenCanvas Normalization | ORIGINAL_REQUEST §R2, Spec Miner | M2 | Tier 1, Tier 2 | 2D canvas pixel extraction, clamping at 4096px boundary |
| F-11 | Canvas Destructor & Texture Cleanup | Spec Miner 1 §Edge Cases | M2 | Tier 1, Tier 4 | Canvas dimensions reset to 1x1 before dereferencing; flat memory profile |
| F-12 | Pure-Rust Minimal WebM Muxer | ORIGINAL_REQUEST §R3, Spec Miner | M3 | Tier 1, Tier 3 | EBML header `0x1A45DFA3`, `DocType: "webm"`, `V_VP8` track, SimpleBlock packaging |
| F-13 | Safari 16.4+ WebCodecs Connection | ORIGINAL_REQUEST §R3, Spec Miner | M3 | Tier 1, Tier 4 | `VideoEncoder.isConfigSupported()`, `VideoFrame` ingestion and `.close()` discipline |
| F-14 | Vite + TypeScript Playground UI | ORIGINAL_REQUEST §R4 | M4 | Tier 1, Tier 4 | DOM elements render, file drag-and-drop ingestion, download trigger |
| F-15 | Live Before/After Comparison & Stats | ORIGINAL_REQUEST §R4 | M4 | Tier 1, Tier 4 | Accurate % size reduction calculation and duration in milliseconds |
| F-16 | 60/120fps Smoothness Monitor | ORIGINAL_REQUEST §R4, Acceptance | M4 | Tier 1, Tier 3 | High-precision RAF loop, delta tracking, jank threshold detection (>22ms / >12ms) |
| F-17 | Opaque-Box E2E Test Suite | PROJECT.md §Milestones | M-E2E | Tiers 1-4 | Automated test execution, exit codes, verifiable reports |

---

## 4. Test Suite Tier Specifications & Thresholds

The E2E test suite is organized into 4 distinct verification tiers:

### Tier 1: Feature Coverage (>=5 Test Cases per Feature)
Validates the standard functional behavior of each subsystem against documented specifications.

- **Feature 1: Pure-Rust WebP Lossless (VP8L)**
  - `T1.1.1`: Encode 16x16 pure red solid block → produces valid `VP8L` WebP.
  - `T1.1.2`: Encode 32x32 transparent square with full alpha channel → preserves alpha `0x00` through `0xFF`.
  - `T1.1.3`: Encode 64x64 RGBA gradient pattern → output buffer contains `RIFF....WEBPVP8L` signature.
  - `T1.1.4`: Verify lossless output dimensions stored in VP8L bitstream match original dimensions.
  - `T1.1.5`: Verify color fidelity (RGB values untouched on all pixels with alpha > 0).

- **Feature 2: Pure-Rust WebP Lossy (VP8)**
  - `T1.2.1`: Encode with Quality = 1.0 (lowest) → produces smallest valid `VP8 ` chunk.
  - `T1.2.2`: Encode with Quality = 50.0 (balanced) → compression ratio between 40% and 80%.
  - `T1.2.3`: Encode with Quality = 75.0 (default) → produces valid VP8 bitstream.
  - `T1.2.4`: Encode with Quality = 100.0 (maximum) → preserves visual structure with minimum DCT artifacts.
  - `T1.2.5`: Monotonicity check: Output file size at Q=20 < size at Q=50 < size at Q=80 < size at Q=100.

- **Feature 3: WASM Binary Size Verification**
  - `T1.3.1`: Verify `webp_engine_scalar.wasm` raw file size is strictly < 300KB (307,200 bytes).
  - `T1.3.2`: Verify `webp_engine_simd.wasm` raw file size is strictly < 300KB (307,200 bytes).
  - `T1.3.3`: Verify gzip compressed size of `.wasm` binary is strictly < 80KB (81,920 bytes).
  - `T1.3.4`: Verify absence of unneeded symbol debug sections (`.debug_info`, `name` section stripped).
  - `T1.3.5`: Verify export table contains only intended C-ABI functions (`alloc_buffer`, `free_buffer`, `encode_*`).

- **Feature 4: Zero-Copy Transferable Objects**
  - `T1.4.1`: Transfer 1MB ArrayBuffer via `postMessage(msg, [buffer])` → sender `byteLength` becomes 0.
  - `T1.4.2`: Transfer 10MB ArrayBuffer → measure transfer latency is < 1.0 millisecond.
  - `T1.4.3`: Worker returns encoded WebP ArrayBuffer as Transferable → Worker buffer detaches.
  - `T1.4.4`: Main thread receives Transferred ArrayBuffer with matching byte length and content.
  - `T1.4.5`: Verify structured clone does not double RAM during transfer.

- **Feature 5: GPU OffscreenCanvas & createImageBitmap**
  - `T1.5.1`: `createImageBitmap` decodes Blob asynchronously without blocking main thread.
  - `T1.5.2`: OffscreenCanvas 2D context extracts raw `ImageData` RGBA pixel buffer.
  - `T1.5.3`: Canvas dimensions set to target image dimensions accurately.
  - `T1.5.4`: Destructor check: Setting `canvas.width = 1; canvas.height = 1` resets memory backing store.
  - `T1.5.5`: Image orientation flag `imageOrientation: 'from-image'` is accepted by decoder.

- **Feature 6: Pure-Rust Minimal WebM Muxer**
  - `T1.6.1`: Muxer outputs valid EBML header starting with `[0x1A, 0x45, 0xDF, 0xA3]`.
  - `T1.6.2`: EBML `DocType` field strictly equals string `"webm"`.
  - `T1.6.3`: Segment element contains valid Tracks entry with `CodecID = "V_VP8"`.
  - `T1.6.4`: Single keyframe VP8 payload packaged into valid `SimpleBlock` element.
  - `T1.6.5`: Multi-frame sequence correctly writes monotonically increasing timestamps.

- **Feature 7: SmoothnessMonitor (60/120fps)**
  - `T1.7.1`: SmoothnessMonitor starts RAF loop and produces periodic frame delta callbacks.
  - `T1.7.2`: Steady frame rate on 60Hz display registers `rollingAvgFps` in range [58, 62].
  - `T1.7.3`: High frame rate on 120Hz display registers `rollingAvgFps` up to 120fps.
  - `T1.7.4`: Frame delta exceeding 22ms increments `jankCount` and `droppedFrames`.
  - `T1.7.5`: SmoothnessMonitor `.stop()` immediately cancels RAF loop without leaked callbacks.

---

### Tier 2: Boundary & Corner Cases (>=5 Test Cases per Feature)
Validates extreme dimensions, boundary values, edge conditions, and corrupt input handling.

- **Boundary 1: Image Dimensions**
  - `T2.1.1`: Minimal image dimension: 1x1 pixel RGBA image encodes successfully.
  - `T2.1.2`: Asymmetric dimensions: 1x4096 and 4096x1 images handled correctly.
  - `T2.1.3`: Maximum iOS Safari boundary: 4096x4096px (16,777,216 pixels) handled without overflow.
  - `T2.1.4`: Dimensions exceeding 4096px rejected or safely clamped by preprocessor.
  - `T2.1.5`: Zero dimensions (`width = 0` or `height = 0`) returns `ERR_INVALID_DIMENSIONS` (-2).

- **Boundary 2: Quality Factor Extreme Boundaries**
  - `T2.2.1`: Quality = 1.0 (exact minimum allowable value) accepted.
  - `T2.2.2`: Quality = 100.0 (exact maximum allowable value) accepted.
  - `T2.2.3`: Quality = 0.99 (below minimum) rejected with `ERR_INVALID_QUALITY` (-3).
  - `T2.2.4`: Quality = 100.01 (above maximum) rejected with `ERR_INVALID_QUALITY` (-3).
  - `T2.2.5`: Quality = NaN or Infinity rejected with `ERR_INVALID_QUALITY` (-3).

- **Boundary 3: Alpha Channel Extremes**
  - `T2.3.1`: 100% Fully transparent image (all pixels `A = 0`) encodes without division by zero.
  - `T2.3.2`: 100% Fully opaque image (all pixels `A = 255`) encodes without unnecessary ALPH chunk.
  - `T2.3.3`: Single transparent pixel in an otherwise opaque image preserved bit-exactly.
  - `T2.3.4`: 1-bit binary alpha mask (pixels either 0 or 255) handled efficiently.
  - `T2.3.5`: Semi-transparent uniform veil (`A = 1` and `A = 254`) preserved without rounding distortion.

- **Boundary 4: Memory & Buffer Extremes**
  - `T2.4.1`: Allocation of 0 bytes via `alloc_buffer(0)` returns `null` pointer.
  - `T2.4.2`: Freeing `null` pointer via `free_buffer(null, 0)` is safe no-op.
  - `T2.4.3`: Dimension multiplication overflow (`width = u32::MAX, height = 2`) returns `ERR_DIMENSION_OVERFLOW` (-4).
  - `T2.4.4`: Passing null input pointer to encoder returns `ERR_NULL_POINTER` (-1).
  - `T2.4.5`: Multiple consecutive `alloc_buffer` and `free_buffer` calls exhibit zero memory leakage.

- **Boundary 5: Corrupt & Truncated Input Data**
  - `T2.5.1`: Feeding truncated PNG bytes to decoder returns error without panic or crash.
  - `T2.5.2`: Feeding random high-entropy noise bytes to WebP parser returns `InvalidRiffHeader`.
  - `T2.5.3`: Feeding valid RIFF header with invalid container tag (e.g. `AVI `) returns `InvalidWebpSignature`.
  - `T2.5.4`: Feeding detached ArrayBuffer (`byteLength === 0`) to Worker request rejected with error message.
  - `T2.5.5`: Mismatched buffer length (fewer than `width * height * 4` bytes) safely rejected.

---

### Tier 3: Cross-Feature Combinations (Pairwise Verification)
Tests complex multi-component interactions across the pipeline.

- `T3.1`: **Transparent PNG with Lossy VP8 Encoding**:
  - Image with varying alpha encoded in lossy mode.
  - Verifies generated WebP uses Extended Format (`VP8X`) containing both an `ALPH` chunk and a `VP8 ` chunk.
- `T3.2`: **4K Image Zero-Copy Transfer with Live RAF Loop**:
  - Main thread runs active `SmoothnessMonitor` tracking 60/120fps.
  - Concurrently transfers 4K RGBA buffer (3840x2160x4 = 33.2MB) to Web Worker.
  - Verifies zero dropped frames (`jankCount == 0`) and transfer time < 1ms on main thread.
- `T3.3`: **GPU Decoded Image Fed to WASM Linear Memory**:
  - `createImageBitmap` decodes test image on GPU.
  - Pixel data extracted via `OffscreenCanvas` and transferred directly into WASM linear heap.
  - Encoded to WebP and verified against reference raster.
- `T3.4`: **WebM Video Muxing from WebP Encoded Frames**:
  - Sequence of 5 frames encoded into VP8 intra-frames via WASM encoder.
  - Frames packaged into WebM container using pure-Rust WebM muxer.
  - Output validated for correct track count, duration, and frame count.
- `T3.5`: **Rapid Quality Parameter Modulation**:
  - Same source image encoded sequentially at Q=10, Q=50, Q=90 across Worker boundary.
  - Verifies state isolation (no buffer corruption or memory carryover between requests).

---

### Tier 4: Real-World Application Scenarios (>=5 Workloads)
Simulates end-user workflows and production edge conditions.

- `T4.1`: **EXIF Auto-Orientation Photo Compression**:
  - Simulates camera photo with EXIF Orientation tag (e.g. Orientation 6: 90° clockwise).
  - Preprocessor correctly corrects orientation before WebP compression.
- `T4.2`: **High-Resolution Graphic Compression Without UI Jank**:
  - Heavy 8K composite graphic compressed in background Worker.
  - Main thread user interaction (simulated slider drag) responds smoothly at >= 60fps.
- `T4.3`: **Continuous Batch Asset Compression**:
  - 20 images compressed sequentially.
  - Verifies that total memory footprint remains stable without unbounded heap growth.
  - Canvas destructor is invoked after each image to release GPU texture backing stores.
- `T4.4`: **WebCodecs VideoFrame Lifecycle Under Pressure**:
  - Simulates frame extraction and encoding stream.
  - Verifies that `.close()` is called deterministically on every `VideoFrame` to avoid Metal texture exhaustion.
- `T4.5`: **Complete Playground E2E Workflow**:
  - User loads image, adjusts quality slider from 75 to 40, toggles lossless switch, views live size reduction stats, and triggers file download.

---

## 5. Test Runner Invocation Specification

### Command Line Interface

```powershell
# Run complete test suite (Tiers 1-4) with Obscura (default)
.\scripts\test-e2e.ps1

# Run specific tier
.\scripts\test-e2e.ps1 -Tier 1
.\scripts\test-e2e.ps1 -Tier 2
.\scripts\test-e2e.ps1 -Tier 3
.\scripts\test-e2e.ps1 -Tier 4

# Force Chrome Headless Shell fallback
.\scripts\test-e2e.ps1 -Browser chrome-headless-shell

# Custom remote debugging port
.\scripts\test-e2e.ps1 -Port 9444

# Verbose debugging output
.\scripts\test-e2e.ps1 -Verbose
```

### Direct Node.js Invocation

```powershell
node tests/e2e/runner.mjs --tier=all --browser=auto
node tests/e2e/runner.mjs --tier=1 --browser=obscura
node tests/e2e/runner.mjs --tier=2 --browser=chrome-headless-shell
```

### Exit Codes
- `0`: All executed test suites passed successfully.
- `1`: One or more test assertions failed.
- `2`: Browser launch or CDP connection failure.
- `3`: Missing prerequisites or invalid CLI arguments.

---

## 6. Expected Output Derivation & Authoritative Oracles

| Metric / Target | Authoritative Source | Verification Algorithm |
|---|---|---|
| WebP Lossless Signature | WebP Container Spec (Google Developers) | Bytes 0..3 == `RIFF`, 8..11 == `WEBP`, 12..15 == `VP8L`. Byte 16 == `0x2F` (VP8L signature byte). |
| WebP Lossy Signature | WebP Container Spec & RFC 6386 | Bytes 0..3 == `RIFF`, 8..11 == `WEBP`, 12..15 == `VP8 `. VP8 bitstream starts with 3-byte frame tag. |
| WebP Extended (VP8X) | WebP Container Spec | Bytes 12..15 == `VP8X`. Byte 20 contains flags: bit 4 (`0x10`) indicates presence of Alpha chunk (`ALPH`). |
| WebM EBML Signature | RFC 8794 (Matroska / EBML) | Bytes 0..3 == `[0x1A, 0x45, 0xDF, 0xA3]`. DocType element ID `0x4282` containing `"webm"`. |
| Alpha Channel Fidelity | Pixel Array Ground Truth | $\forall (x, y), \text{OriginalAlpha}(x, y) == \text{DecodedAlpha}(x, y)$. Bit-exact matching for Lossless mode. |
| Zero-Copy Verification | HTML Living Standard §Transferable | Prior to transfer: `buffer.byteLength > 0`. Post transfer: `buffer.byteLength === 0`. Latency < 1ms. |
| UI Jank Measurement | W3C High Resolution Time | Frame delta $\Delta t = t_n - t_{n-1}$. If $\Delta t > 22.0\text{ms}$ (on 60Hz) or $\Delta t > 12.0\text{ms}$ (on 120Hz), flag as dropped frame / jank. |
| Memory Release | WebKit Bugzilla Canvas Ceiling | Setting canvas `width = 1; height = 1` flushes Metal texture backing store. |
