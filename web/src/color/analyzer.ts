/**
 * Color Spectrum & Histogram Analyzer
 *
 * Phân tích và so sánh định lượng màu sắc giữa ảnh gốc và ảnh WebP:
 * - Histogram 256 bins cho các kênh Red, Green, Blue, Luma
 * - Thống kê giá trị trung bình (Mean), phương sai, tương quan
 * - Độ lệch màu trung bình (Mean Color Drift / ΔE xấp xỉ)
 * - Tỷ lệ trùng khớp màu sắc (Color Match Score %)
 * - Chỉ số tương đồng sáng PSNR (Peak Signal-to-Noise Ratio)
 * - Xuất báo cáo dữ liệu JSON toàn diện chuẩn mực cho AI đọc hiểu
 */

export interface ChannelHistogram {
  original: Uint32Array; // 256 bins
  compressed: Uint32Array; // 256 bins
  maxCount: number;
}

export interface ChannelStats {
  origMean: number;
  compMean: number;
  diffMean: number;
  correlation: number;
}

export interface ColorAnalysisResult {
  colorMatchScore: number; // e.g. 98.9 (%)
  avgDeltaE: number; // e.g. 2.7
  psnr: number; // e.g. 36.0 (dB)
  maxColorError: number; // e.g. 55 / 255
  verdict: 'perfect' | 'excellent' | 'good' | 'deviated';
  verdictText: string;
  r: ChannelHistogram;
  g: ChannelHistogram;
  b: ChannelHistogram;
  luma: ChannelHistogram;
  stats: {
    r: ChannelStats;
    g: ChannelStats;
    b: ChannelStats;
    luma: ChannelStats;
  };
  sampleCount: number;
}

export interface AiReportContext {
  fileName: string;
  originalSizeBytes: number;
  compressedSizeBytes: number;
  dimensions: { width: number; height: number };
  isLossless: boolean;
  quality: number;
  durationMs: number;
  hasHdr: boolean;
  hdrReason: string;
  hdrBoostEnabled: boolean;
}

export class ColorAnalyzer {
  /**
   * Phân tích và so sánh phổ màu giữa hai nguồn ảnh (HTMLImageElement hoặc Blob URL)
   */
  public static async analyze(
    originalSrc: string,
    compressedSrc: string
  ): Promise<ColorAnalysisResult> {
    const [imgOrig, imgComp] = await Promise.all([
      this.loadImage(originalSrc),
      this.loadImage(compressedSrc),
    ]);

    // Dùng mẫu 256x256 để tính toán thống kê tức thì trong < 2ms
    const sampleSize = 256;
    const canvas = document.createElement('canvas');
    canvas.width = sampleSize;
    canvas.height = sampleSize;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      throw new Error('Không thể khởi tạo Canvas 2D context');
    }

    // Lấy dữ liệu pixel ảnh gốc
    ctx.drawImage(imgOrig, 0, 0, sampleSize, sampleSize);
    const origData = ctx.getImageData(0, 0, sampleSize, sampleSize).data;

    // Lấy dữ liệu pixel ảnh nén WebP
    ctx.clearRect(0, 0, sampleSize, sampleSize);
    ctx.drawImage(imgComp, 0, 0, sampleSize, sampleSize);
    const compData = ctx.getImageData(0, 0, sampleSize, sampleSize).data;

    // Giải phóng bộ nhớ canvas
    canvas.width = 1;
    canvas.height = 1;

    // Khởi tạo bins histogram
    const rOrig = new Uint32Array(256);
    const rComp = new Uint32Array(256);
    const gOrig = new Uint32Array(256);
    const gComp = new Uint32Array(256);
    const bOrig = new Uint32Array(256);
    const bComp = new Uint32Array(256);
    const lumaOrig = new Uint32Array(256);
    const lumaComp = new Uint32Array(256);

    let totalDiff = 0;
    let sumSquaredError = 0;
    let maxDiff = 0;
    const totalPixels = sampleSize * sampleSize;

    let sumRo = 0, sumRc = 0, sumGo = 0, sumGc = 0, sumBo = 0, sumBc = 0, sumLo = 0, sumLc = 0;

    for (let i = 0; i < origData.length; i += 4) {
      const ro = origData[i];
      const go = origData[i + 1];
      const bo = origData[i + 2];

      const rc = compData[i];
      const gc = compData[i + 1];
      const bc = compData[i + 2];

      sumRo += ro; sumRc += rc;
      sumGo += go; sumGc += gc;
      sumBo += bo; sumBc += bc;

      // Tăng bins RGB
      rOrig[ro]++;
      rComp[rc]++;
      gOrig[go]++;
      gComp[gc]++;
      bOrig[bo]++;
      bComp[bc]++;

      // Tính Luma (Rec. 601 chuẩn sRGB/VP8)
      const lo = Math.round(0.299 * ro + 0.587 * go + 0.114 * bo);
      const lc = Math.round(0.299 * rc + 0.587 * gc + 0.114 * bc);
      sumLo += lo; sumLc += lc;
      lumaOrig[lo]++;
      lumaComp[lc]++;

      // Tính khoảng cách màu Euclidean xấp xỉ ΔE trong sRGB
      const dr = ro - rc;
      const dg = go - gc;
      const db = bo - bc;
      const pixelDiff = Math.sqrt(0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db);
      totalDiff += pixelDiff;

      const sqErr = (dr * dr + dg * dg + db * db) / 3;
      sumSquaredError += sqErr;

      if (pixelDiff > maxDiff) {
        maxDiff = pixelDiff;
      }
    }

    const avgDiff = totalDiff / totalPixels;
    const mse = sumSquaredError / totalPixels;
    const psnr = mse > 0 ? Math.min(99.9, 10 * Math.log10((255 * 255) / mse)) : 99.9;
    
    // Tỷ lệ trùng khớp màu (%): 100% khi không lệch
    const colorMatchScore = Math.max(0, Math.min(100, 100 - (avgDiff / 255) * 100));

    // Đánh giá mức độ
    let verdict: ColorAnalysisResult['verdict'] = 'perfect';
    let verdictText = '';

    if (avgDiff < 2.0) {
      verdict = 'perfect';
      verdictText = 'Màu sắc bảo toàn hoàn hảo: Mắt thường hoàn toàn không nhận ra sai biệt.';
    } else if (avgDiff < 4.0) {
      verdict = 'excellent';
      verdictText = 'Màu sắc rất chân thực: Độ lệch màu cực nhỏ, giữ trọn vẹn sắc độ và chi tiết.';
    } else if (avgDiff < 8.0) {
      verdict = 'good';
      verdictText = 'Chất lượng nén tốt: Duy trì màu sắc ổn định, độ lệch ở mức chấp nhận được.';
    } else {
      verdict = 'deviated';
      verdictText = 'Có hiện tượng lệch sắc độ nhẹ giữa ảnh gốc và ảnh nén.';
    }

    const findMax = (arr1: Uint32Array, arr2: Uint32Array): number => {
      let m = 0;
      for (let i = 0; i < 256; i++) {
        if (arr1[i] > m) m = arr1[i];
        if (arr2[i] > m) m = arr2[i];
      }
      return m;
    };

    const calcChannelStats = (sumOrig: number, sumComp: number, arrOrig: Uint32Array, arrComp: Uint32Array): ChannelStats => {
      const origMean = sumOrig / totalPixels;
      const compMean = sumComp / totalPixels;
      const diffMean = compMean - origMean;

      // Correlation coefficient
      let num = 0, den1 = 0, den2 = 0;
      for (let i = 0; i < 256; i++) {
        const d1 = arrOrig[i];
        const d2 = arrComp[i];
        num += d1 * d2;
        den1 += d1 * d1;
        den2 += d2 * d2;
      }
      const correlation = (den1 > 0 && den2 > 0) ? Math.min(1, num / Math.sqrt(den1 * den2)) : 1;

      return {
        origMean: Math.round(origMean * 10) / 10,
        compMean: Math.round(compMean * 10) / 10,
        diffMean: Math.round(diffMean * 10) / 10,
        correlation: Math.round(correlation * 1000) / 1000,
      };
    };

    return {
      colorMatchScore: Math.round(colorMatchScore * 10) / 10,
      avgDeltaE: Math.round(avgDiff * 10) / 10,
      psnr: Math.round(psnr * 10) / 10,
      maxColorError: Math.round(maxDiff),
      verdict,
      verdictText,
      r: { original: rOrig, compressed: rComp, maxCount: findMax(rOrig, rComp) },
      g: { original: gOrig, compressed: gComp, maxCount: findMax(gOrig, gComp) },
      b: { original: bOrig, compressed: bComp, maxCount: findMax(bOrig, bComp) },
      luma: { original: lumaOrig, compressed: lumaComp, maxCount: findMax(lumaOrig, lumaComp) },
      stats: {
        r: calcChannelStats(sumRo, sumRc, rOrig, rComp),
        g: calcChannelStats(sumGo, sumGc, gOrig, gComp),
        b: calcChannelStats(sumBo, sumBc, bOrig, bComp),
        luma: calcChannelStats(sumLo, sumLc, lumaOrig, lumaComp),
      },
      sampleCount: totalPixels,
    };
  }

  /**
   * Tạo báo cáo dữ liệu định dạng JSON đầy đủ chi tiết cho AI
   */
  public static buildAiReport(result: ColorAnalysisResult, ctx: AiReportContext): Record<string, unknown> {
    const savedBytes = Math.max(0, ctx.originalSizeBytes - ctx.compressedSizeBytes);
    const savedPercent = ctx.originalSizeBytes > 0 ? ((savedBytes / ctx.originalSizeBytes) * 100).toFixed(1) : '0';
    const compressionFactor = ctx.compressedSizeBytes > 0 ? (ctx.originalSizeBytes / ctx.compressedSizeBytes).toFixed(2) : '1.0';

    return {
      title: 'Báo Cáo Phân Tích Độ Chuẩn Màu Sắc & Nén WebP (Dành Cho AI Phân Tích)',
      timestamp: new Date().toISOString(),
      environment: {
        userAgent: navigator.userAgent,
        screen: `${window.innerWidth}x${window.innerHeight}`,
        devicePixelRatio: window.devicePixelRatio || 1,
        isHdrDisplayCapable: typeof window !== 'undefined' && !!(window.matchMedia && window.matchMedia('(dynamic-range: high)').matches),
        pipeline: 'Pure-Rust WebAssembly (SIMD128) + Metal GPU Preprocessor',
      },
      sourceImage: {
        fileName: ctx.fileName,
        fileSizeBytes: ctx.originalSizeBytes,
        fileSizeFormatted: this.formatBytes(ctx.originalSizeBytes),
        dimensions: {
          width: ctx.dimensions.width,
          height: ctx.dimensions.height,
          totalPixels: ctx.dimensions.width * ctx.dimensions.height,
          aspectRatio: (ctx.dimensions.width / ctx.dimensions.height).toFixed(3),
        },
        hdrDetection: {
          hasHdr: ctx.hasHdr,
          reason: ctx.hdrReason,
        },
      },
      compressedWebp: {
        format: ctx.isLossless ? 'WebP Lossless (VP8L)' : `WebP Lossy (VP8, Q=${ctx.quality})`,
        isLossless: ctx.isLossless,
        qualityLevel: ctx.quality,
        hdrBoostApplied: ctx.hdrBoostEnabled,
        fileSizeBytes: ctx.compressedSizeBytes,
        fileSizeFormatted: this.formatBytes(ctx.compressedSizeBytes),
        compressionRatio: `-${savedPercent}%`,
        compressionFactor: `${compressionFactor}x`,
        durationMs: ctx.durationMs,
      },
      colorMetrics: {
        colorMatchScorePercent: result.colorMatchScore,
        averageDeltaE: result.avgDeltaE,
        maxColorError: `${result.maxColorError} / 255`,
        psnrDecibels: result.psnr,
        verdict: result.verdict,
        verdictDescription: result.verdictText,
        referenceThresholds: {
          deltaE: '< 1.0: Mắt thường không nhận ra; 1.0 - 3.0: Rất gần nhau; > 3.0: Nhận biết rõ',
          psnr: '> 40 dB: Tái tạo hoàn hảo; 30 - 40 dB: Chất lượng cao; < 30 dB: Mất chi tiết',
          matchScore: '> 98%: Rất chuẩn mực; > 95%: Chuẩn tốt; < 90%: Lệch màu',
        },
      },
      channelStatistics: {
        red: result.stats.r,
        green: result.stats.g,
        blue: result.stats.b,
        luma: result.stats.luma,
      },
      histogramData: {
        binCount: 256,
        red: {
          original: Array.from(result.r.original),
          compressed: Array.from(result.r.compressed),
        },
        green: {
          original: Array.from(result.g.original),
          compressed: Array.from(result.g.compressed),
        },
        blue: {
          original: Array.from(result.b.original),
          compressed: Array.from(result.b.compressed),
        },
        luma: {
          original: Array.from(result.luma.original),
          compressed: Array.from(result.luma.compressed),
        },
      },
      aiSummaryPrompt: `Ảnh gốc "${ctx.fileName}" (${this.formatBytes(ctx.originalSizeBytes)}, ${ctx.dimensions.width}x${ctx.dimensions.height}px) được nén thành WebP ${ctx.isLossless ? 'Lossless' : `Lossy (Q=${ctx.quality})`} dung lượng ${this.formatBytes(ctx.compressedSizeBytes)} (giảm ${savedPercent}%). Độ trùng khớp màu đạt ${result.colorMatchScore}%, sai số trung bình ΔE=${result.avgDeltaE}, PSNR=${result.psnr}dB. ${ctx.hasHdr ? `Ảnh gốc có tính năng Apple Smart HDR / Display P3 (${ctx.hdrBoostEnabled ? 'Đã bật chế độ bù màu sống động HDR' : 'Chưa bật bù màu HDR'}).` : 'Ảnh gốc thuộc dải màu tiêu chuẩn SDR.'}`,
    };
  }

  private static formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  private static loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(new Error(`Không thể tải ảnh: ${e}`));
      img.src = src;
    });
  }
}
