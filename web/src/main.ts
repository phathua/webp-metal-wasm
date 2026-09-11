import './style.css';
import { SmoothnessMonitor } from './monitor/smoothness';
import { GpuPreprocessor } from './gpu/preprocessor';
import { WasmBridge } from './worker/wasm-bridge';
import { AppLogger } from './monitor/logger';
import { ColorHistogramCard } from './color/histogram-card';
import type { AiReportContext } from './color/analyzer';
import type { EncodeRequest, EncodeResponse, WebmMuxRequest, WebmMuxResponse } from './worker/protocol';

// Khởi tạo AppLogger
const logger = AppLogger.get();
logger.info(`Trình duyệt: ${navigator.userAgent.includes('Safari') ? 'Safari / WebKit' : navigator.userAgent}`);
logger.info(`Màn hình: ${window.innerWidth}x${window.innerHeight} (DPR: ${window.devicePixelRatio})`);

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

// Comparison elements
const viewModeBar = document.getElementById('view-mode-bar') as HTMLElement;
const btnModeSlider = document.getElementById('btn-mode-slider') as HTMLButtonElement;
const btnModeSide = document.getElementById('btn-mode-side') as HTMLButtonElement;
const btnModeSingle = document.getElementById('btn-mode-single') as HTMLButtonElement;

// HDR UI elements
const hdrToggleBox = document.getElementById('hdr-toggle-box') as HTMLElement;
const hdrSwitchInput = document.getElementById('hdr-switch-input') as HTMLInputElement;
const hdrBadgeAuto = document.getElementById('hdr-badge-auto') as HTMLElement;
const hdrDescText = document.getElementById('hdr-desc-text') as HTMLElement;

const comparisonSliderBox = document.getElementById('comparison-slider-box') as HTMLElement;
const sliderOverlay = document.getElementById('slider-overlay') as HTMLElement;
const sliderHandle = document.getElementById('slider-handle') as HTMLElement;
const sliderImgBefore = document.getElementById('slider-img-before') as HTMLImageElement;
const sliderImgAfter = document.getElementById('slider-img-after') as HTMLImageElement;

const sideBySideBox = document.getElementById('side-by-side-box') as HTMLElement;
const sideImgBefore = document.getElementById('side-img-before') as HTMLImageElement;
const sideImgAfter = document.getElementById('side-img-after') as HTMLImageElement;
const sideLabelBefore = document.getElementById('side-label-before') as HTMLElement;
const sideLabelAfter = document.getElementById('side-label-after') as HTMLElement;

// Khởi tạo ColorHistogramCard
const colorCard = new ColorHistogramCard('color-analysis-card');

// State
let selectedFile: File | null = null;
let isLossless = true;
let quality = 80;
let outputBlobUrl: string | null = null;
let originalBlobUrl: string | null = null;
let currentViewMode: 'slider' | 'side' | 'single' = 'slider';
let detectedHdr = false;
let hdrReason = '';
let enableHdrBoost = false;

// Initialize Smoothness Monitor (60/120fps tracking)
const monitor = new SmoothnessMonitor();
monitor.start((metrics) => {
  fpsDisplay.textContent = `${metrics.currentFps} FPS`;
  jankDisplay.textContent = `${metrics.jankCount}`;
});

// Detect SIMD support for UI badge & log
if (WasmBridge.isSimdSupported()) {
  engineModeBadge.textContent = 'SIMD128 (Apple Silicon)';
  logger.wasm('Phát hiện tập lệnh SIMD128 - Đã nạp webp_engine_simd.wasm (Tối ưu Apple Silicon)');
} else {
  engineModeBadge.textContent = 'Scalar Fallback';
  logger.wasm('Thiết bị không có SIMD128 - Sử dụng webp_engine_scalar.wasm');
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

// View mode toggle
btnModeSlider.addEventListener('click', () => {
  currentViewMode = 'slider';
  renderViewMode();
});

btnModeSide.addEventListener('click', () => {
  currentViewMode = 'side';
  renderViewMode();
});

btnModeSingle.addEventListener('click', () => {
  currentViewMode = 'single';
  renderViewMode();
});

function renderViewMode() {
  btnModeSlider.classList.toggle('active', currentViewMode === 'slider');
  btnModeSide.classList.toggle('active', currentViewMode === 'side');
  btnModeSingle.classList.toggle('active', currentViewMode === 'single');

  if (currentViewMode === 'slider') {
    comparisonSliderBox.style.display = 'block';
    sideBySideBox.style.display = 'none';
    previewImg.style.display = 'none';
    requestAnimationFrame(updateSliderOverlayWidth);
  } else if (currentViewMode === 'side') {
    comparisonSliderBox.style.display = 'none';
    sideBySideBox.style.display = 'grid';
    previewImg.style.display = 'none';
  } else {
    comparisonSliderBox.style.display = 'none';
    sideBySideBox.style.display = 'none';
    previewImg.style.display = 'block';
  }
}

function updateSliderOverlayWidth() {
  const boxWidth = comparisonSliderBox.getBoundingClientRect().width;
  if (boxWidth > 0) {
    sliderImgBefore.style.width = `${boxWidth}px`;
  }
}

let isDragging = false;
function setSliderPos(clientX: number) {
  const rect = comparisonSliderBox.getBoundingClientRect();
  if (rect.width <= 0) return;
  const offsetX = Math.max(0, Math.min(rect.width, clientX - rect.left));
  const pct = (offsetX / rect.width) * 100;
  sliderOverlay.style.width = `${pct}%`;
  sliderHandle.style.left = `${pct}%`;
}

comparisonSliderBox.addEventListener('pointerdown', (e) => {
  isDragging = true;
  try { comparisonSliderBox.setPointerCapture(e.pointerId); } catch {}
  setSliderPos(e.clientX);
});

comparisonSliderBox.addEventListener('pointermove', (e) => {
  if (isDragging) {
    setSliderPos(e.clientX);
  }
});

comparisonSliderBox.addEventListener('pointerup', (e) => {
  isDragging = false;
  try { comparisonSliderBox.releasePointerCapture(e.pointerId); } catch {}
});

comparisonSliderBox.addEventListener('pointercancel', () => {
  isDragging = false;
});

window.addEventListener('resize', () => {
  if (currentViewMode === 'slider') {
    updateSliderOverlayWidth();
  }
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

// Listener công tắc HDR
hdrSwitchInput.addEventListener('change', () => {
  enableHdrBoost = hdrSwitchInput.checked;
  hdrToggleBox.classList.toggle('active', enableHdrBoost);
  logger.info(`Chế độ Tối ưu màu sống động HDR: ${enableHdrBoost ? 'Bật thủ công' : 'Tắt'}`);
});

async function handleFile(file: File) {
  selectedFile = file;
  btnCompress.disabled = false;
  btnCompress.textContent = `🚀 Nén ${file.name}`;
  sizeBefore.textContent = `Gốc: ${formatBytes(file.size)}`;
  heavierWarning.style.display = 'none';
  colorCard.hide();

  if (originalBlobUrl) URL.revokeObjectURL(originalBlobUrl);
  originalBlobUrl = URL.createObjectURL(file);

  logger.info(`Đã chọn ảnh: ${file.name} (${formatBytes(file.size)})`);

  // 1. Tự động phát hiện ảnh chụp iPhone có HDR / Display P3 để tự bật công tắc
  try {
    const hdrInfo = await GpuPreprocessor.detectHdr(file);
    if (hdrInfo.hasHdr) {
      detectedHdr = true;
      hdrReason = hdrInfo.reason;
      enableHdrBoost = true;
      hdrSwitchInput.checked = true;
      hdrBadgeAuto.style.display = 'inline-block';
      hdrBadgeAuto.textContent = 'Đã tự động bật';
      hdrToggleBox.classList.add('active');
      hdrDescText.innerHTML = `🌟 <strong>${hdrInfo.reason}</strong>: Đã tự động kích hoạt bù sắc độ & tương phản để ảnh WebP rực rỡ như ảnh HDR gốc.`;
      logger.info(`Phát hiện HDR (${hdrInfo.reason}) ➜ Tự động bật Tối ưu màu sống động HDR.`);
    } else {
      detectedHdr = false;
      hdrReason = hdrInfo.reason;
      enableHdrBoost = false;
      hdrSwitchInput.checked = false;
      hdrBadgeAuto.style.display = 'none';
      hdrToggleBox.classList.remove('active');
      hdrDescText.textContent = 'Tự động bù sắc độ & tương phản cho ảnh chụp iPhone (HEIF/Display P3) khi chuyển sang WebP SDR, giúp ảnh rực rỡ như ảnh gốc.';
    }
  } catch (e) {
    console.warn('Không thể kiểm tra HDR:', e);
  }

  // 2. Tự động nhận diện ảnh JPEG để gợi ý Lossy
  const isJpeg = file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name);
  if (isJpeg) {
    btnLossy.click();
    modeHint.innerHTML = '⚡ <strong>Đã tự động chuyển sang Lossy (VP8)</strong>: Phát hiện định dạng JPEG. Nén Lossy sẽ giảm sâu 50-80% dung lượng mà giữ nguyên độ nét!';
    logger.info('Tự động chọn chế độ Lossy (VP8) cho ảnh JPEG.');
  } else {
    btnLossless.click();
    modeHint.innerHTML = '💡 <strong>Đã chọn Lossless (VP8L)</strong>: Định dạng ảnh PNG/đồ họa sẽ được bảo toàn nguyên vẹn 100% chất lượng và kênh trong suốt.';
    logger.info('Đã chọn chế độ Lossless (VP8L) cho ảnh PNG/đồ họa.');
  }
}

// Compression process
btnCompress.addEventListener('click', async () => {
  if (!selectedFile) return;

  btnCompress.disabled = true;
  btnCompress.textContent = '⏳ Đang nén (Web Worker)...';
  heavierWarning.style.display = 'none';

  try {
    logger.metal(`Bắt đầu giải mã Metal GPU cho ảnh ${selectedFile.name}... ${enableHdrBoost ? '(Áp dụng bù màu rực rỡ HDR)' : ''}`);
    // 1. GPU Preprocessing (Metal via createImageBitmap + OffscreenCanvas)
    const preprocess = await GpuPreprocessor.processImage(selectedFile, { enableHdrBoost });
    dimensionsBadge.textContent = `${preprocess.width} × ${preprocess.height} px`;
    logger.metal(`Metal GPU xử lý xong: ${preprocess.width}x${preprocess.height}px. Chuyển dữ liệu sang Web Worker (Zero-Copy)...`);

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

          // Cập nhật các chế độ xem so sánh (Slider, Song song, Đơn lẻ)
          previewImg.src = outputBlobUrl;
          sliderImgBefore.src = originalBlobUrl || outputBlobUrl;
          sliderImgAfter.src = outputBlobUrl;
          sideImgBefore.src = originalBlobUrl || outputBlobUrl;
          sideImgAfter.src = outputBlobUrl;

          sideLabelBefore.textContent = `Ảnh Gốc: ${formatBytes(selectedFile!.size)}`;
          sideLabelAfter.textContent = `WebP: ${formatBytes(msg.compressedSize)}`;

          previewPlaceholder.style.display = 'none';
          viewModeBar.style.display = 'flex';
          renderViewMode();

          sizeAfter.textContent = `WebP: ${formatBytes(msg.compressedSize)}`;
          durationDisplay.textContent = `${msg.durationMs} ms`;

          if (msg.compressedSize <= selectedFile!.size) {
            const savedRatio = Math.round((1 - msg.compressedSize / selectedFile!.size) * 100);
            savingsDisplay.textContent = `-${savedRatio}%`;
            savingsDisplay.style.color = 'var(--accent-cyan)';
            heavierWarning.style.display = 'none';
            logger.info(`Nén WebP ${isLossless ? 'Lossless' : `Lossy (Q=${quality})`} thành công: ${formatBytes(selectedFile!.size)} ➜ ${formatBytes(msg.compressedSize)} (giảm ${savedRatio}%) trong ${msg.durationMs}ms`);
          } else {
            const increaseRatio = Math.round((msg.compressedSize / selectedFile!.size - 1) * 100);
            savingsDisplay.textContent = `+${increaseRatio}% (Tăng)`;
            savingsDisplay.style.color = '#f87171';
            if (isLossless) {
              heavierWarning.style.display = 'block';
            }
            logger.warn(`WebP Lossless lớn hơn ảnh gốc (+${increaseRatio}%). Khuyến nghị chuyển sang Lossy.`);
          }

          btnDownload.style.display = 'block';

          // Phân tích và so sánh phổ màu sắc trước & sau nén (kèm ngữ cảnh chi tiết cho AI)
          if (originalBlobUrl && outputBlobUrl) {
            logger.info('Bắt đầu phân tích phổ màu sắc (Histogram & Delta-E)...');
            const aiCtx: AiReportContext = {
              fileName: selectedFile!.name,
              originalSizeBytes: selectedFile!.size,
              compressedSizeBytes: msg.compressedSize,
              dimensions: { width: preprocess.width, height: preprocess.height },
              isLossless,
              quality,
              durationMs: msg.durationMs,
              hasHdr: detectedHdr,
              hdrReason,
              hdrBoostEnabled: enableHdrBoost,
            };

            colorCard.update(originalBlobUrl, outputBlobUrl, aiCtx).then(() => {
              logger.info('Phân tích phổ màu hoàn tất. Đã sẵn sàng xuất JSON cho AI.');
            }).catch((err) => {
              logger.error(`Lỗi phân tích màu sắc: ${err}`);
            });
          }
        } else {
          logger.error(`Nén thất bại: ${msg.error || 'Lỗi không xác định'}`);
          alert(`Nén thất bại: ${msg.error || 'Lỗi không xác định'}`);
        }
      }
    };

    worker.addEventListener('message', handleMessage);
  } catch (err: unknown) {
    btnCompress.disabled = false;
    btnCompress.textContent = '🚀 Nén Thử Lại';
    const errText = err instanceof Error ? err.message : String(err);
    logger.error(`Lỗi tiền xử lý ảnh: ${errText}`);
    alert(`Lỗi tiền xử lý ảnh: ${errText}`);
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
