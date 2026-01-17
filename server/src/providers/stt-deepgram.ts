/**
 * Deepgram Realtime STT Provider
 *
 * Uses the Deepgram Live Audio API for streaming transcription with:
 * - Direct mu-law audio support (8kHz)
 * - Built-in endpointing for turn detection
 * - Low-latency streaming transcription
 *
 * Pricing: ~$0.0043/min
 */

import WebSocket from 'ws';
import type { RealtimeSTTProvider, RealtimeSTTSession, STTConfig } from './types.js';

export class DeepgramSTTProvider implements RealtimeSTTProvider {
  readonly name = 'deepgram';
  private apiKey: string | null = null;
  private model: string = 'nova-2';
  private silenceDurationMs: number = 800;

  initialize(config: STTConfig): void {
    if (!config.apiKey) {
      throw new Error('Deepgram API key required for STT');
    }
    this.apiKey = config.apiKey;
    this.model = config.model || 'nova-2';
    this.silenceDurationMs = config.silenceDurationMs || 800;
    console.error(`STT provider: Deepgram (${this.model}, silence: ${this.silenceDurationMs}ms)`);
  }

  createSession(): RealtimeSTTSession {
    if (!this.apiKey) throw new Error('Deepgram STT not initialized');
    return new DeepgramSTTSession(this.apiKey, this.model, this.silenceDurationMs);
  }
}

class DeepgramSTTSession implements RealtimeSTTSession {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private model: string;
  private silenceDurationMs: number;
  private connected = false;
  private pendingTranscript = '';
  private onTranscriptCallback: ((transcript: string) => void) | null = null;
  private onPartialCallback: ((partial: string) => void) | null = null;
  private closed = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelayMs = 1000;
  private keepAliveInterval: ReturnType<typeof setInterval> | null = null;

  constructor(apiKey: string, model: string, silenceDurationMs: number) {
    this.apiKey = apiKey;
    this.model = model;
    this.silenceDurationMs = silenceDurationMs;
  }

  async connect(): Promise<void> {
    this.closed = false;
    this.reconnectAttempts = 0;
    return this.doConnect();
  }

  private async doConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Build WebSocket URL with query parameters
      const params = new URLSearchParams({
        encoding: 'mulaw',
        sample_rate: '8000',
        channels: '1',
        model: this.model,
        punctuate: 'true',
        interim_results: 'true',
        endpointing: this.silenceDurationMs.toString(),
        vad_events: 'true',
      });

      const url = `wss://api.deepgram.com/v1/listen?${params.toString()}`;

      this.ws = new WebSocket(url, {
        headers: {
          'Authorization': `Token ${this.apiKey}`,
        },
      });

      this.ws.on('open', () => {
        console.error('[DeepgramSTT] WebSocket connected');
        this.connected = true;
        this.reconnectAttempts = 0;

        // Start keepalive to prevent timeout
        this.keepAliveInterval = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'KeepAlive' }));
          }
        }, 10000);

        resolve();
      });

      this.ws.on('message', (data: Buffer) => {
        try {
          const event = JSON.parse(data.toString());
          this.handleEvent(event);
        } catch (e) {
          console.error('[DeepgramSTT] Failed to parse event:', e);
        }
      });

      this.ws.on('error', (error) => {
        console.error('[DeepgramSTT] WebSocket error:', error);
        if (!this.connected) reject(error);
      });

      this.ws.on('close', (code, reason) => {
        console.error(`[DeepgramSTT] WebSocket closed (code: ${code}, reason: ${reason || 'none'})`);
        this.connected = false;
        this.clearKeepAlive();

        if (!this.closed) {
          this.attemptReconnect();
        }
      });

      setTimeout(() => {
        if (!this.connected) {
          reject(new Error('Deepgram STT connection timeout'));
        }
      }, 10000);
    });
  }

  private clearKeepAlive(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }

  private async attemptReconnect(): Promise<void> {
    if (this.closed) {
      console.error('[DeepgramSTT] Not reconnecting - session intentionally closed');
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`[DeepgramSTT] Max reconnect attempts (${this.maxReconnectAttempts}) reached, giving up`);
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelayMs * Math.pow(2, this.reconnectAttempts - 1);
    console.error(`[DeepgramSTT] Attempting reconnect ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms...`);

    await new Promise(resolve => setTimeout(resolve, delay));

    if (this.closed) {
      console.error('[DeepgramSTT] Reconnect cancelled - session was closed');
      return;
    }

    try {
      await this.doConnect();
      console.error('[DeepgramSTT] Reconnected successfully');
    } catch (error) {
      console.error('[DeepgramSTT] Reconnect failed:', error);
    }
  }

  private handleEvent(event: any): void {
    switch (event.type) {
      case 'Results':
        this.handleTranscriptResult(event);
        break;

      case 'SpeechStarted':
        console.error('[DeepgramSTT] Speech started');
        this.pendingTranscript = '';
        break;

      case 'UtteranceEnd':
        console.error('[DeepgramSTT] Utterance end');
        // If we have pending transcript, emit it
        if (this.pendingTranscript.trim()) {
          this.onTranscriptCallback?.(this.pendingTranscript.trim());
          this.pendingTranscript = '';
        }
        break;

      case 'Metadata':
        console.error('[DeepgramSTT] Session metadata received');
        break;

      case 'Error':
        console.error('[DeepgramSTT] Error:', event.message || event);
        break;
    }
  }

  private handleTranscriptResult(event: any): void {
    const channel = event.channel;
    if (!channel?.alternatives?.[0]) return;

    const transcript = channel.alternatives[0].transcript;
    const isFinal = event.is_final;
    const speechFinal = event.speech_final;

    if (!transcript) return;

    if (isFinal) {
      // Accumulate final transcripts
      this.pendingTranscript += transcript + ' ';
      this.onPartialCallback?.(this.pendingTranscript.trim());

      // If speech_final is true, the user has stopped speaking
      if (speechFinal) {
        console.error(`[DeepgramSTT] Transcript: ${this.pendingTranscript.trim()}`);
        this.onTranscriptCallback?.(this.pendingTranscript.trim());
        this.pendingTranscript = '';
      }
    } else {
      // Interim result - show current pending + interim
      this.onPartialCallback?.((this.pendingTranscript + transcript).trim());
    }
  }

  sendAudio(muLawData: Buffer): void {
    if (!this.connected || this.ws?.readyState !== WebSocket.OPEN) return;
    // Deepgram accepts raw binary audio data
    this.ws.send(muLawData);
  }

  onPartial(callback: (partial: string) => void): void {
    this.onPartialCallback = callback;
  }

  async waitForTranscript(timeoutMs: number = 30000): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.onTranscriptCallback = null;
        reject(new Error('Transcript timeout'));
      }, timeoutMs);

      this.onTranscriptCallback = (transcript) => {
        clearTimeout(timeout);
        this.onTranscriptCallback = null;
        resolve(transcript);
      };
    });
  }

  close(): void {
    this.closed = true;
    this.clearKeepAlive();
    if (this.ws) {
      // Send close message to Deepgram
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'CloseStream' }));
      }
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }
}
