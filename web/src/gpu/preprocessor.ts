/**
 * GPU Preprocessor for iOS Metal & WebGL/OffscreenCanvas
 * 
 * Leverages Apple Silicon hardware image decoders via createImageBitmap
 * and Metal-backed OffscreenCanvas with strict memory reclamation.
 */

export interface PreprocessResult {
  width: number;
  height: number;
  rgbaBuffer: ArrayBuffer;
}

export interface PreprocessOptions {
  enableHdrBoost?: boolean;
}

export interface HdrDetectionResult {
  hasHdr: boolean;
  reason: string;
  isHeif: boolean;
  isAppleCamera: boolean;
  isWideGamutP3: boolean;
}

export class GpuPreprocessor {
  public static readonly MAX_SAFE_DIMENSION = 4096;

  /**
   * Phát hiện ảnh chụp có chứa thông số Apple Smart HDR, dải màu Display P3 hoặc Gain Map.
   */
  public static async detectHdr(file: File): Promise<HdrDetectionResult> {
    const isHeif = file.type === 'image/heic' || file.type === 'image/heif' || /\.heic$/i.test(file.name) || /\.heif$/i.test(file.name);
    const isAppleCamera = /^IMG_(\d+|E\d+)/i.test(file.name) || isHeif;
    const isHdrDisplay = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(dynamic-range: high)').matches;

    let hasGainMapOrP3 = false;
    let reason = '';

    try {
      const slice = file.slice(0, 65536);
      const buffer = await slice.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const text = new TextDecoder('latin1').decode(bytes);

      if (text.includes('Display P3') || text.includes('display-p3') || text.includes('Apple Computer, Inc.')) {
        hasGainMapOrP3 = true;
        reason = 'Phát hiện dải màu mở rộng Apple Display P3';
      } else if (text.includes('hdrgm') || text.includes('gainmap') || text.includes('GainMap') || text.includes('Apple_HDR')) {
        hasGainMapOrP3 = true;
        reason = 'Phát hiện lớp bản đồ tăng sáng Apple Smart HDR Gain Map';
      } else if (isHeif) {
        hasGainMapOrP3 = true;
        reason = 'Ảnh chụp HEIF/HEIC tiêu chuẩn iPhone hỗ trợ Smart HDR';
      }
    } catch {
      // Fallback
    }

    const hasHdr = isHeif || hasGainMapOrP3 || (isAppleCamera && isHdrDisplay);
    if (!reason) {
      if (hasHdr) {
        reason = 'Phát hiện ảnh chụp từ iPhone với cấu hình màu mở rộng HDR';
      } else {
        reason = 'Ảnh tiêu chuẩn SDR thông thường (sRGB)';
      }
    }

    return {
      hasHdr,
      reason,
      isHeif,
      isAppleCamera,
      isWideGamutP3: hasGainMapOrP3 || isHeif,
    };
  }

  /**
   * Decodes an image file or blob using hardware accelerated createImageBitmap
   * with automatic EXIF orientation preservation, scales to safe dimensions,
   * extracts raw RGBA pixels, and immediately destroys the canvas backing store.
   */
  public static async processImage(blob: Blob, options: PreprocessOptions = {}): Promise<PreprocessResult> {
    // 1. Hardware decode via Metal on iOS Safari
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch {
      // Fallback if imageOrientation option is not supported
      bitmap = await createImageBitmap(blob);
    }

    let targetWidth = bitmap.width;
    let targetHeight = bitmap.height;

    // 2. Clamp dimensions within safe iOS Safari GPU limits (4096px)
    if (targetWidth > this.MAX_SAFE_DIMENSION || targetHeight > this.MAX_SAFE_DIMENSION) {
      if (targetWidth >= targetHeight) {
        targetHeight = Math.round((targetHeight * this.MAX_SAFE_DIMENSION) / targetWidth);
        targetWidth = this.MAX_SAFE_DIMENSION;
      } else {
        targetWidth = Math.round((targetWidth * this.MAX_SAFE_DIMENSION) / targetHeight);
        targetHeight = this.MAX_SAFE_DIMENSION;
      }
    }

    // 3. Render onto Metal-backed OffscreenCanvas
    let canvas: OffscreenCanvas | HTMLCanvasElement;
    if (typeof OffscreenCanvas !== 'undefined') {
      canvas = new OffscreenCanvas(targetWidth, targetHeight);
    } else {
      canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }

    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) {
      bitmap.close();
      throw new Error('Failed to get 2D canvas context for GPU preprocessing');
    }

    // Áp dụng bù sắc độ & tương phản cho ảnh HDR nếu được bật
    if (options.enableHdrBoost) {
      ctx.filter = 'contrast(1.05) saturate(1.14) brightness(1.02)';
    }

    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    ctx.filter = 'none'; // Khôi phục bộ lọc mặc định
    bitmap.close(); // Immediate release of hardware bitmap texture

    // 4. Extract RGBA buffer
    const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
    const rgbaBuffer = imageData.data.buffer.slice(0); // Transferable ArrayBuffer

    // 5. Canvas Destructor: Reset to 1x1 to force immediate release of iOS Safari Metal backing store
    canvas.width = 1;
    canvas.height = 1;

    return {
      width: targetWidth,
      height: targetHeight,
      rgbaBuffer
    };
  }

  /**
   * Resets and frees canvas memory immediately.
   */
  public static releaseCanvas(canvas: HTMLCanvasElement | OffscreenCanvas): void {
    canvas.width = 1;
    canvas.height = 1;
  }
}
