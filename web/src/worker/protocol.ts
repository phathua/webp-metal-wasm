/**
 * Type-safe message contracts between Main UI Thread and Web Worker
 */

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

export type WorkerInMessage = EncodeRequest | WebmMuxRequest;
export type WorkerOutMessage = EncodeResponse | WebmMuxResponse;
