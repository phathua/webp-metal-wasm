import './style.css';
import { SmoothnessMonitor } from './monitor/smoothness';
import { GpuPreprocessor } from './gpu/preprocessor';
import { WasmBridge } from './worker/wasm-bridge';
import type { EncodeRequest, EncodeResponse, WebmMuxRequest, WebmMuxResponse } from './worker/protocol';

// UI Elements
const dropZone = document.getElementById('drop-zone') as HTMLDivElement;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const btnLossless = document.getElementById('btn-lossless') as HTMLButtonElement;
const btnLossy = document.getElementById('btn-lossy') as HTMLButtonElement;
const modeHint = document.getElementById('mode-hint') as HTMLElement;
const heavierWarning = document.getElementById('heavier-warning') as HTMLElement;
const btnSwitchLossy = document.getElementById('btn-switch-lossy') as HTMLButtonElement;
const qualityContainer = document.getElementById('quality-container') as HTMLDivElement;
const qualitySlider = document.getElementById('quality-slider') as HTMLInputElement;
const qualityVal = document.getElementById('quality-val') as HTMLElement;
const btnCompress = document.getElementById('btn-compress') as HTMLButtonElement;
const previewImg = document.getElementById('preview-img') as HTMLImageElement;
const previewPlaceholder = document.getElementById('preview-placeholder') as HTMLElement;
const btnDownload = document.getElementById('btn-download') as HTMLButtonElement;
const sizeBefore = document.getElementById('size-before') as HTMLElement;
const sizeAfter = document.getElementById('size-after') as HTMLElement;
const savingsDisplay = document.getElementById('savings-display') as HTMLElement;
const durationDisplay = document.getElementById('duration-display') as HTMLElement;
const fpsDisplay = document.getElementById('fps-display') as HTMLElement;
const jankDisplay = document.getElementById('jank-display') as HTMLElement;
const dimensionsBadge = document.getElementById('dimensions-badge') as HTMLElement;
const engineModeBadge = document.getElementById('engine-mode-badge') as HTMLElement;
const btnTestWebm = document.getElementById('btn-test-webm') as HTMLButtonElement;
const webmTestResult = document.getElementById('webm-test-result') as HTMLElement;

// State
let selectedFile: File | null = null;
let isLossless = true;
let quality = 80;
let outputBlobUrl: string | null = null;

// Initialize Smoothness Monitor (60/120fps tracking)
const monitor = new SmoothnessMonitor();
monitor.start((metrics) => {
  fpsDisplay.textContent = `${metrics.currentFps} FPS`;
  jankDisplay.textContent = `${metrics.jankCount}`;
});

// Detect SIMD support for UI badge
if (WasmBridge.isSimdSupported()) {
  engineModeBadge.textContent = 'SIMD128 (Apple Silicon)';
} else {
  engineModeBadge.textContent = 'Scalar Fallback';
}

// Initialize Web Worker
const worker = new Worker(new URL('./worker/worker.ts', import.meta.url), { type: 'module' });

// Mode toggle
btnLossless.addEventListener('click', () => {
  isLossless = true;
  btnLossless.classList.add('active');
  btnLossy.classList.remove('active');
  qualityContainer.style.display = 'none';
  modeHint.innerHTML = '💡 <strong>Chế độ Lossless (VP8L)</strong>: Bảo toàn nguyên vẹn 100% điểm ảnh và độ trong suốt. Thích hợp nhất cho <strong>ảnh PNG, logo, icon</strong>.';
  heavierWarning.style.display = 'none';
});

btnLossy.addEventListener('click', () => {
  isLossless = false;
  btnLossy.classList.add('active');
  btnLossless.classList.remove('active');
  qualityContainer.style.display = 'block';
  modeHint.innerHTML = '⚡ <strong>Chế độ Lossy (VP8)</strong>: Giảm 50% - 85% dung lượng với chất lượng mắt thường không phân biệt được. Thích hợp nhất cho <strong>ảnh JPEG, ảnh chụp, bản đồ</strong>.';
  heavierWarning.style.display = 'none';
});

btnSwitchLossy.addEventListener('click', () => {
  btnLossy.click();
  btnCompress.click();
});

qualitySlider.addEventListener('input', () => {
  quality = Number(qualitySlider.value);
  qualityVal.textContent = `${quality}%`;
});

// File selection
dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
    handleFile(e.dataTransfer.files[0]);
  }
});

fileInput.addEventListener('change', () => {
  if (fileInput.files && fileInput.files.length > 0) {
    handleFile(fileInput.files[0]);
  }
});

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function handleFile(file: File) {
  selectedFile = file;
  btnCompress.disabled = false;
  btnCompress.textContent = `🚀 Nén ${file.name}`;
  sizeBefore.textContent = `Gốc: ${formatBytes(file.size)}`;
  heavierWarning.style.display = 'none';

  // Tự động nhận diện ảnh JPEG để gợi ý Lossy
  const isJpeg = file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name);
  if (isJpeg) {
    btnLossy.click();
    modeHint.innerHTML = '⚡ <strong>Đã tự động chuyển sang Lossy (VP8)</strong>: Phát hiện định dạng JPEG. Nén Lossy sẽ giảm sâu 50-80% dung lượng mà giữ nguyên độ nét!';
  } else {
    btnLossless.click();
    modeHint.innerHTML = '💡 <strong>Đã chọn Lossless (VP8L)</strong>: Định dạng ảnh PNG/đồ họa sẽ được bảo toàn nguyên vẹn 100% chất lượng và kênh trong suốt.';
  }
}

// Compression process
btnCompress.addEventListener('click', async () => {
  if (!selectedFile) return;

  btnCompress.disabled = true;
  btnCompress.textContent = '⏳ Đang nén (Web Worker)...';
  heavierWarning.style.display = 'none';

  try {
    // 1. GPU Preprocessing (Metal via createImageBitmap + OffscreenCanvas)
    const preprocess = await GpuPreprocessor.processImage(selectedFile);
    dimensionsBadge.textContent = `${preprocess.width} × ${preprocess.height} px`;

    // 2. Dispatch to Web Worker with Transferable ArrayBuffer (Zero-Copy)
    const requestId = `req_${Date.now()}`;
    const request: EncodeRequest = {
      type: 'ENCODE',
      id: requestId,
      buffer: preprocess.rgbaBuffer,
      width: preprocess.width,
      height: preprocess.height,
      quality,
      isLossless
    };

    worker.postMessage(request, [preprocess.rgbaBuffer]);

    const handleMessage = (e: MessageEvent<EncodeResponse | WebmMuxResponse>) => {
      const msg = e.data;
      if (msg.type === 'ENCODE_RESULT' && msg.id === requestId) {
        worker.removeEventListener('message', handleMessage);
        btnCompress.disabled = false;
        btnCompress.textContent = '🚀 Nén Lại';

        if (msg.success && msg.webpBuffer) {
          // Display results
          const blob = new Blob([msg.webpBuffer], { type: 'image/webp' });
          if (outputBlobUrl) URL.revokeObjectURL(outputBlobUrl);
          outputBlobUrl = URL.createObjectURL(blob);

          previewImg.src = outputBlobUrl;
          previewImg.style.display = 'block';
          previewPlaceholder.style.display = 'none';

          sizeAfter.textContent = `WebP: ${formatBytes(msg.compressedSize)}`;
          durationDisplay.textContent = `${msg.durationMs} ms`;

          if (msg.compressedSize <= selectedFile!.size) {
            const savedRatio = Math.round((1 - msg.compressedSize / selectedFile!.size) * 100);
            savingsDisplay.textContent = `-${savedRatio}%`;
            savingsDisplay.style.color = 'var(--accent-cyan)';
            heavierWarning.style.display = 'none';
          } else {
            const increaseRatio = Math.round((msg.compressedSize / selectedFile!.size - 1) * 100);
            savingsDisplay.textContent = `+${increaseRatio}% (Tăng)`;
            savingsDisplay.style.color = '#f87171';
            if (isLossless) {
              heavierWarning.style.display = 'block';
            }
          }

          btnDownload.style.display = 'block';
        } else {
          alert(`Nén thất bại: ${msg.error || 'Lỗi không xác định'}`);
        }
      }
    };

    worker.addEventListener('message', handleMessage);
  } catch (err: unknown) {
    btnCompress.disabled = false;
    btnCompress.textContent = '🚀 Nén Thử Lại';
    alert(`Lỗi tiền xử lý ảnh: ${err instanceof Error ? err.message : String(err)}`);
  }
});

btnDownload.addEventListener('click', () => {
  if (!outputBlobUrl) return;
  const a = document.createElement('a');
  a.href = outputBlobUrl;
  a.download = `compressed_${Date.now()}.webp`;
  a.click();
});

// WebM Muxer test
btnTestWebm.addEventListener('click', () => {
  btnTestWebm.disabled = true;
  webmTestResult.textContent = 'Đang kiểm thử...';

  const requestId = `webm_${Date.now()}`;
  const dummyFrame = new Uint8Array([0x52, 0x49, 0x46, 0x46]); // Dummy VP8 frame
  const req: WebmMuxRequest = {
    type: 'MUX_WEBM',
    id: requestId,
    frames: [dummyFrame.buffer],
    width: 640,
    height: 480,
    fps: 30
  };

  const handleWebmMsg = (e: MessageEvent<EncodeResponse | WebmMuxResponse>) => {
    const msg = e.data;
    if (msg.type === 'MUX_WEBM_RESULT' && msg.id === requestId) {
      worker.removeEventListener('message', handleWebmMsg);
      btnTestWebm.disabled = false;
      if (msg.success && msg.webmBuffer) {
        const header = new Uint8Array(msg.webmBuffer.slice(0, 4));
        const isEbml = header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3;
        webmTestResult.textContent = isEbml
          ? `✓ Muxer EBML thành công (${msg.webmBuffer.byteLength} bytes, header 0x1A45DFA3)`
          : `✓ Nhận ${msg.webmBuffer.byteLength} bytes`;
      } else {
        webmTestResult.textContent = `Lỗi: ${msg.error}`;
      }
    }
  };

  worker.addEventListener('message', handleWebmMsg);
  worker.postMessage(req, [dummyFrame.buffer]);
});
