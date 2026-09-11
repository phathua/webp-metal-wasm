import { ColorAnalyzer, ColorAnalysisResult, ChannelHistogram, AiReportContext } from './analyzer';

export type HistogramChannel = 'all' | 'r' | 'g' | 'b' | 'luma';

export class ColorHistogramCard {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private currentResult: ColorAnalysisResult | null = null;
  private currentContext: AiReportContext | null = null;
  private activeChannel: HistogramChannel = 'all';

  // UI elements
  private scoreBadge: HTMLElement;
  private metricFidelity: HTMLElement;
  private metricDeltaE: HTMLElement;
  private metricPsnr: HTMLElement;
  private metricMaxDiff: HTMLElement;
  private verdictBanner: HTMLElement;
  private hoverTooltip: HTMLElement;
  private btnCopyJson: HTMLButtonElement;
  private btnDownloadJson: HTMLButtonElement;
  private exportHint: HTMLElement;

  constructor(containerId: string) {
    const el = document.getElementById(containerId);
    if (!el) throw new Error(`Không tìm thấy container #${containerId}`);
    this.container = el;

    // Render HTML inside container
    this.container.innerHTML = `
      <div class="card-title">
        <span>📊 Phân Tích & So Sánh Phổ Màu Sắc</span>
        <span class="info-pill match-pill" id="color-match-pill">Đang phân tích...</span>
      </div>

      <!-- Color Metrics Summary -->
      <div class="color-metrics-grid">
        <div class="color-metric-box">
          <span class="color-metric-label">Độ Trùng Khớp Màu</span>
          <span class="color-metric-value text-emerald" id="color-fidelity-val">--%</span>
          <span class="color-metric-sub">So với ảnh gốc</span>
        </div>
        <div class="color-metric-box">
          <span class="color-metric-label">Độ Lệch Màu (ΔE)</span>
          <span class="color-metric-value text-cyan" id="color-delta-val">--</span>
          <span class="color-metric-sub">< 2.3: Không lệch sắc</span>
        </div>
        <div class="color-metric-box">
          <span class="color-metric-label">Chất Lượng Tín Hiệu (PSNR)</span>
          <span class="color-metric-value text-purple" id="color-psnr-val">-- dB</span>
          <span class="color-metric-sub">> 40 dB: Xuất sắc</span>
        </div>
        <div class="color-metric-box">
          <span class="color-metric-label">Lệch Tối Đa (Max Error)</span>
          <span class="color-metric-value" id="color-maxdiff-val">-- / 255</span>
          <span class="color-metric-sub">Tại điểm ảnh lệch nhất</span>
        </div>
      </div>

      <!-- Verdict Banner -->
      <div class="color-verdict-banner" id="color-verdict-banner">
        Đang tải phân tích phổ màu sắc...
      </div>

      <!-- Channel Switcher Buttons -->
      <div class="histogram-channel-bar">
        <button class="channel-btn active" data-channel="all">🌈 Tất Cả (RGB)</button>
        <button class="channel-btn" data-channel="r">🔴 Kênh Đỏ (Red)</button>
        <button class="channel-btn" data-channel="g">🟢 Kênh Xanh Lá (Green)</button>
        <button class="channel-btn" data-channel="b">🔵 Kênh Xanh Dương (Blue)</button>
        <button class="channel-btn" data-channel="luma">⚪ Độ Sáng (Luma)</button>
      </div>

      <!-- Interactive Canvas & Tooltip Container -->
      <div class="histogram-canvas-wrapper">
        <canvas id="color-histogram-canvas" width="600" height="220"></canvas>
        <div class="histogram-tooltip" id="histogram-tooltip" style="display: none;"></div>
      </div>

      <!-- Legend & Non-tech Guidance -->
      <div class="histogram-legend">
        <div class="legend-item">
          <span class="legend-line dashed"></span>
          <span><strong>Ảnh Gốc</strong> (Đường nét đứt)</span>
        </div>
        <div class="legend-item">
          <span class="legend-line solid"></span>
          <span><strong>Ảnh WebP</strong> (Đường nét liền rực sáng)</span>
        </div>
        <div class="legend-item note">
          💡 <em>Hai đường càng trùng khít lên nhau, màu sắc nén ra càng giống nguyên bản 100%.</em>
        </div>
      </div>

      <!-- AI JSON Export Actions -->
      <div class="histogram-export-bar">
        <button class="export-btn" id="btn-copy-color-json">
          📋 Sao Chép JSON (Cho AI Phân Tích)
        </button>
        <button class="export-btn secondary" id="btn-download-color-json">
          💾 Tải File Báo Cáo JSON
        </button>
        <span class="export-hint" id="color-export-hint"></span>
      </div>
    `;

    this.canvas = this.container.querySelector('#color-histogram-canvas') as HTMLCanvasElement;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Không thể khởi tạo context Canvas 2D');
    this.ctx = ctx;

    this.scoreBadge = this.container.querySelector('#color-match-pill') as HTMLElement;
    this.metricFidelity = this.container.querySelector('#color-fidelity-val') as HTMLElement;
    this.metricDeltaE = this.container.querySelector('#color-delta-val') as HTMLElement;
    this.metricPsnr = this.container.querySelector('#color-psnr-val') as HTMLElement;
    this.metricMaxDiff = this.container.querySelector('#color-maxdiff-val') as HTMLElement;
    this.verdictBanner = this.container.querySelector('#color-verdict-banner') as HTMLElement;
    this.hoverTooltip = this.container.querySelector('#histogram-tooltip') as HTMLElement;
    this.btnCopyJson = this.container.querySelector('#btn-copy-color-json') as HTMLButtonElement;
    this.btnDownloadJson = this.container.querySelector('#btn-download-color-json') as HTMLButtonElement;
    this.exportHint = this.container.querySelector('#color-export-hint') as HTMLElement;

    this.setupEvents();
  }

  private setupEvents() {
    // Channel buttons
    const btns = this.container.querySelectorAll<HTMLButtonElement>('.channel-btn');
    btns.forEach((btn) => {
      btn.addEventListener('click', () => {
        btns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeChannel = btn.dataset.channel as HistogramChannel;
        this.draw();
      });
    });

    // Touch & Hover interactions on canvas
    const handlePointer = (clientX: number) => {
      if (!this.currentResult) return;
      const rect = this.canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      if (x < 0 || x > rect.width) {
        this.hoverTooltip.style.display = 'none';
        this.draw();
        return;
      }

      const binIndex = Math.max(0, Math.min(255, Math.floor((x / rect.width) * 256)));
      this.draw(binIndex);
      this.showTooltip(binIndex, x);
    };

    this.canvas.addEventListener('mousemove', (e) => handlePointer(e.clientX));
    this.canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length > 0) handlePointer(e.touches[0].clientX);
    }, { passive: true });

    const hideTooltip = () => {
      this.hoverTooltip.style.display = 'none';
      this.draw();
    };

    this.canvas.addEventListener('mouseleave', hideTooltip);
    this.canvas.addEventListener('touchend', hideTooltip);

    // AI JSON Export: Copy to Clipboard
    this.btnCopyJson.addEventListener('click', async () => {
      if (!this.currentResult) return;
      try {
        const report = this.getReportObject();
        const jsonStr = JSON.stringify(report, null, 2);
        await navigator.clipboard.writeText(jsonStr);
        this.btnCopyJson.textContent = '✅ Đã Sao Chép Vào Clipboard!';
        this.btnCopyJson.classList.add('copied');
        setTimeout(() => {
          this.btnCopyJson.textContent = '📋 Sao Chép JSON (Cho AI Phân Tích)';
          this.btnCopyJson.classList.remove('copied');
        }, 2500);
      } catch (err) {
        console.error('Không thể sao chép vào clipboard:', err);
        this.exportHint.textContent = 'Lỗi sao chép! Hãy thử nút Tải File JSON.';
      }
    });

    // AI JSON Export: Download File
    this.btnDownloadJson.addEventListener('click', () => {
      if (!this.currentResult) return;
      try {
        const report = this.getReportObject();
        const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const namePart = (this.currentContext?.fileName || 'image').replace(/\.[^/.]+$/, '');
        a.download = `color-analysis-${namePart}-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error('Không thể tải file JSON:', err);
      }
    });

    // Responsive Canvas Resize
    window.addEventListener('resize', () => {
      this.resizeCanvas();
      this.draw();
    });
    this.resizeCanvas();
  }

  private getReportObject(): Record<string, unknown> {
    if (!this.currentResult) return {};
    const fallbackCtx: AiReportContext = {
      fileName: 'unknown.jpg',
      originalSizeBytes: 0,
      compressedSizeBytes: 0,
      dimensions: { width: 0, height: 0 },
      isLossless: false,
      quality: 80,
      durationMs: 0,
      hasHdr: false,
      hdrReason: 'Standard SDR',
      hdrBoostEnabled: false,
    };
    return ColorAnalyzer.buildAiReport(this.currentResult, this.currentContext || fallbackCtx);
  }

  private resizeCanvas() {
    const parentWidth = this.canvas.parentElement?.clientWidth || 600;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = parentWidth * dpr;
    this.canvas.height = 220 * dpr;
    this.canvas.style.width = `${parentWidth}px`;
    this.canvas.style.height = '220px';
    this.ctx.resetTransform?.();
    this.ctx.scale(dpr, dpr);
  }

  /**
   * Cập nhật kết quả phân tích và vẽ biểu đồ
   */
  public async update(originalSrc: string, compressedSrc: string, context?: AiReportContext) {
    this.container.style.display = 'block';
    this.scoreBadge.textContent = 'Đang phân tích...';
    if (context) this.currentContext = context;

    try {
      const result = await ColorAnalyzer.analyze(originalSrc, compressedSrc);
      this.currentResult = result;

      // Update UI Metrics
      this.scoreBadge.textContent = `Trùng Khớp: ${result.colorMatchScore}%`;
      this.metricFidelity.textContent = `${result.colorMatchScore}%`;
      this.metricDeltaE.textContent = `${result.avgDeltaE}`;
      this.metricPsnr.textContent = `${result.psnr} dB`;
      this.metricMaxDiff.textContent = `${result.maxColorError} / 255`;

      // Verdict styling & text
      this.verdictBanner.textContent = `✅ ${result.verdictText}`;
      if (result.verdict === 'perfect' || result.verdict === 'excellent') {
        this.verdictBanner.className = 'color-verdict-banner success';
        this.scoreBadge.className = 'info-pill match-pill success';
      } else {
        this.verdictBanner.className = 'color-verdict-banner warning';
        this.scoreBadge.className = 'info-pill match-pill warning';
      }

      this.resizeCanvas();
      this.draw();
    } catch (e) {
      console.error('Lỗi khi phân tích màu sắc:', e);
      this.verdictBanner.textContent = '⚠️ Không thể phân tích màu sắc của ảnh';
      this.verdictBanner.className = 'color-verdict-banner error';
    }
  }

  public hide() {
    this.container.style.display = 'none';
  }

  /**
   * Vẽ biểu đồ phổ màu trên Canvas
   */
  private draw(highlightBin: number | null = null) {
    if (!this.currentResult) return;
    const width = this.canvas.clientWidth;
    const height = 220;
    const ctx = this.ctx;

    ctx.clearRect(0, 0, width, height);

    // Grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let y = 40; y < height; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    if (this.activeChannel === 'all') {
      // Draw all 3 channels layered
      this.drawChannelCurve(this.currentResult.r, 'rgba(239, 68, 68, 0.8)', 'rgba(239, 68, 68, 0.1)', width, height);
      this.drawChannelCurve(this.currentResult.g, 'rgba(34, 197, 94, 0.8)', 'rgba(34, 197, 94, 0.1)', width, height);
      this.drawChannelCurve(this.currentResult.b, 'rgba(59, 130, 246, 0.8)', 'rgba(59, 130, 246, 0.1)', width, height);
    } else {
      let ch: ChannelHistogram;
      let strokeColor: string;
      let fillColor: string;

      switch (this.activeChannel) {
        case 'r':
          ch = this.currentResult.r;
          strokeColor = '#ef4444';
          fillColor = 'rgba(239, 68, 68, 0.18)';
          break;
        case 'g':
          ch = this.currentResult.g;
          strokeColor = '#22c55e';
          fillColor = 'rgba(34, 197, 94, 0.18)';
          break;
        case 'b':
          ch = this.currentResult.b;
          strokeColor = '#3b82f6';
          fillColor = 'rgba(59, 130, 246, 0.18)';
          break;
        case 'luma':
        default:
          ch = this.currentResult.luma;
          strokeColor = '#06b6d4';
          fillColor = 'rgba(6, 182, 212, 0.18)';
          break;
      }
      this.drawChannelCurve(ch, strokeColor, fillColor, width, height, true);
    }

    // Highlight vertical cursor line if active
    if (highlightBin !== null) {
      const x = (highlightBin / 255) * width;
      ctx.save();
      ctx.strokeStyle = '#f8fafc';
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawChannelCurve(
    ch: ChannelHistogram,
    strokeColor: string,
    fillColor: string,
    width: number,
    height: number,
    fillArea: boolean = false
  ) {
    const ctx = this.ctx;
    const max = Math.max(1, ch.maxCount);
    const topPadding = 15;
    const chartHeight = height - topPadding - 10;

    // 1. Draw Original curve (Dashed white/translucent)
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * width;
      const y = height - 10 - (ch.original[i] / max) * chartHeight;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();

    // 2. Draw Compressed WebP curve (Solid glowing)
    ctx.save();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2.5;
    ctx.shadowColor = strokeColor;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * width;
      const y = height - 10 - (ch.compressed[i] / max) * chartHeight;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Area fill if single channel
    if (fillArea) {
      ctx.lineTo(width, height - 10);
      ctx.lineTo(0, height - 10);
      ctx.closePath();
      ctx.fillStyle = fillColor;
      ctx.shadowBlur = 0;
      ctx.fill();
    }
    ctx.restore();
  }

  private showTooltip(bin: number, cursorX: number) {
    if (!this.currentResult) return;
    let origVal = 0;
    let compVal = 0;
    let chName = '';

    switch (this.activeChannel) {
      case 'r':
        origVal = this.currentResult.r.original[bin];
        compVal = this.currentResult.r.compressed[bin];
        chName = '🔴 Đỏ (Red)';
        break;
      case 'g':
        origVal = this.currentResult.g.original[bin];
        compVal = this.currentResult.g.compressed[bin];
        chName = '🟢 Xanh Lá (Green)';
        break;
      case 'b':
        origVal = this.currentResult.b.original[bin];
        compVal = this.currentResult.b.compressed[bin];
        chName = '🔵 Xanh Dương (Blue)';
        break;
      case 'luma':
        origVal = this.currentResult.luma.original[bin];
        compVal = this.currentResult.luma.compressed[bin];
        chName = '⚪ Độ Sáng (Luma)';
        break;
      case 'all':
      default:
        origVal = this.currentResult.luma.original[bin];
        compVal = this.currentResult.luma.compressed[bin];
        chName = '🌈 RGB Trung Bình';
        break;
    }

    const diff = Math.abs(origVal - compVal);
    const diffPct = origVal > 0 ? ((diff / origVal) * 100).toFixed(1) : '0';

    this.hoverTooltip.innerHTML = `
      <div style="font-weight: 700; margin-bottom: 3px;">${chName} | Sắc độ: ${bin}/255</div>
      <div>Gốc: <strong>${origVal.toLocaleString()} px</strong></div>
      <div>WebP: <strong>${compVal.toLocaleString()} px</strong></div>
      <div style="color: ${diff === 0 ? '#10b981' : '#a5f3fc'}; margin-top: 2px;">
        Độ chênh lệch: ${diffPct}% (${diff.toLocaleString()} px)
      </div>
    `;

    const cardWidth = this.canvas.clientWidth;
    const tooltipWidth = 180;
    let left = cursorX + 15;
    if (left + tooltipWidth > cardWidth) {
      left = cursorX - tooltipWidth - 15;
    }

    this.hoverTooltip.style.left = `${Math.max(10, left)}px`;
    this.hoverTooltip.style.top = `25px`;
    this.hoverTooltip.style.display = 'block';
  }
}
