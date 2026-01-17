/**
 * OpenAI-compatible TTS Provider
 *
 * Supports OpenAI and compatible APIs like LemonFox.
 * Configure CALLME_TTS_BASE_URL to use alternative providers.
 *
 * Pricing:
 * - OpenAI: ~$15/1M characters
 * - LemonFox: ~$2.50/1M characters
 */

import OpenAI from 'openai';
import type { TTSProvider, TTSConfig } from './types.js';

export class OpenAITTSProvider implements TTSProvider {
  private _name = 'openai';
  get name() { return this._name; }
  private _sampleRate = 24000;  // OpenAI default
  get sampleRate() { return this._sampleRate; }
  private client: OpenAI | null = null;
  private voice: string = 'onyx';
  private model: string = 'tts-1';

  initialize(config: TTSConfig): void {
    if (!config.apiKey) {
      throw new Error('API key required for TTS');
    }

    const baseURL = config.apiUrl;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      ...(baseURL && { baseURL }),
    });
    this.voice = config.voice || 'onyx';
    this.model = config.model || 'tts-1';

    // Detect provider name from base URL and set appropriate sample rate
    if (baseURL?.includes('lemonfox')) {
      this._name = 'lemonfox';
      // LemonFox may use different sample rate - configurable via CALLME_TTS_SAMPLE_RATE
      this._sampleRate = config.sampleRate || 24000;
    } else {
      this._sampleRate = config.sampleRate || 24000;  // OpenAI uses 24kHz
    }

    console.error(`TTS provider: ${this._name} (${this.model}, voice: ${this.voice}, ${this._sampleRate}Hz)`);
  }

  async synthesize(text: string): Promise<Buffer> {
    if (!this.client) throw new Error('OpenAI TTS not initialized');

    // Use WAV format for LemonFox to get sample rate from header
    const useWav = this._name === 'lemonfox';

    const response = await this.client.audio.speech.create({
      model: this.model,
      voice: this.voice as 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer',
      input: text,
      response_format: useWav ? 'wav' : 'pcm',
      speed: 1.0,
    });

    const arrayBuffer = await response.arrayBuffer();
    let buffer = Buffer.from(arrayBuffer);

    // If WAV, parse header to get sample rate and extract PCM data
    if (useWav && buffer.length > 44) {
      // WAV header structure:
      // 22-23: num channels (1=mono, 2=stereo)
      // 24-27: sample rate
      // 34-35: bits per sample
      const numChannels = buffer.readUInt16LE(22);
      const detectedSampleRate = buffer.readUInt32LE(24);
      const bitsPerSample = buffer.readUInt16LE(34);

      console.error(`[TTS] WAV: ${detectedSampleRate}Hz, ${numChannels}ch, ${bitsPerSample}bit`);

      if (detectedSampleRate !== this._sampleRate) {
        console.error(`[TTS] Updating sample rate: ${this._sampleRate}Hz -> ${detectedSampleRate}Hz`);
        this._sampleRate = detectedSampleRate;
      }

      // Strip WAV header (44 bytes) to get raw PCM
      buffer = buffer.subarray(44);
    }

    return buffer;
  }

  /**
   * Stream TTS audio as chunks arrive from OpenAI
   * Yields Buffer chunks of PCM audio data
   */
  async *synthesizeStream(text: string): AsyncGenerator<Buffer> {
    if (!this.client) throw new Error('OpenAI TTS not initialized');

    const response = await this.client.audio.speech.create({
      model: this.model,
      voice: this.voice as 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer',
      input: text,
      response_format: 'pcm',
      speed: 1.0,
    });

    // Get the response body as a readable stream
    const body = response.body;
    if (!body) {
      throw new Error('No response body from OpenAI TTS');
    }

    const reader = body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          yield Buffer.from(value);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
