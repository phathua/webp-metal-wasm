/**
 * WebCodecs Video Processing Pipeline (Safari 16.4+ / Modern Browsers)
 * 
 * Interacts with hardware-accelerated VideoEncoder (Apple VideoToolbox / Metal)
 * and passes frames to WebM container muxer.
 */

export interface VideoEncoderConfigParams {
  width: number;
  height: number;
  fps: number;
  bitrate?: number;
}

export class WebCodecsPipeline {
  /**
   * Checks whether WebCodecs API (VideoEncoder and VideoFrame) is supported.
   */
  public static isSupported(): boolean {
    return typeof window !== 'undefined' && 'VideoEncoder' in window && 'VideoFrame' in window;
  }

  /**
   * Encodes a sequence of canvas or image frames using hardware VideoEncoder if available,
   * or packages frames into WebM structure.
   */
  public static async checkCodecSupport(codec = 'vp8'): Promise<boolean> {
    if (!this.isSupported()) return false;
    try {
      const config: VideoEncoderConfig = {
        codec: codec === 'vp8' ? 'vp8' : 'avc1.42001E',
        width: 640,
        height: 480,
        bitrate: 1_000_000,
        framerate: 30
      };
      const support = await VideoEncoder.isConfigSupported(config);
      return !!support.supported;
    } catch {
      return false;
    }
  }

  /**
   * Lifecycle helper to cleanly close a VideoFrame without memory leak.
   */
  public static closeFrame(frame: VideoFrame | null): void {
    if (frame) {
      try {
        frame.close();
      } catch {
        // Ignored if already closed
      }
    }
  }
}
