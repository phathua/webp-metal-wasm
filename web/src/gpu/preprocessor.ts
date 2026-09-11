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

export class GpuPreprocessor {
  public static readonly MAX_SAFE_DIMENSION = 4096;

  /**
   * Decodes an image file or blob using hardware accelerated createImageBitmap
   * with automatic EXIF orientation preservation, scales to safe dimensions,
   * extracts raw RGBA pixels, and immediately destroys the canvas backing store.
   */
  public static async processImage(blob: Blob): Promise<PreprocessResult> {
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

    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
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
