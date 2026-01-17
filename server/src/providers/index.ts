/**
 * Provider Factory
 *
 * Creates and configures providers based on environment variables.
 * Supports Telnyx or Twilio for phone, OpenAI for TTS and Realtime STT.
 */

import type { PhoneProvider, TTSProvider, RealtimeSTTProvider, ProviderRegistry } from './types.js';
import { TelnyxPhoneProvider } from './phone-telnyx.js';
import { TwilioPhoneProvider } from './phone-twilio.js';
import { OpenAITTSProvider } from './tts-openai.js';
import { OpenAIRealtimeSTTProvider } from './stt-openai-realtime.js';
import { DeepgramSTTProvider } from './stt-deepgram.js';

export * from './types.js';

export type PhoneProviderType = 'telnyx' | 'twilio';
export type STTProviderType = 'openai' | 'deepgram';

export interface ProviderConfig {
  // Phone provider selection
  phoneProvider: PhoneProviderType;

  // Phone credentials (interpretation depends on provider)
  // Telnyx: accountSid = Connection ID, authToken = API Key
  // Twilio: accountSid = Account SID, authToken = Auth Token
  phoneAccountSid: string;
  phoneAuthToken: string;
  phoneNumber: string;

  // Telnyx webhook public key (for signature verification)
  // Get from: Mission Control > Account Settings > Keys & Credentials > Public Key
  telnyxPublicKey?: string;

  // OpenAI (fallback for TTS/STT if not using alternatives)
  openaiApiKey: string;

  // TTS configuration
  ttsVoice?: string;
  ttsApiKey?: string;  // Optional separate API key for TTS (e.g., LemonFox)
  ttsBaseUrl?: string; // Optional base URL for TTS (e.g., https://api.lemonfox.ai/v1)

  // STT configuration
  sttProvider: STTProviderType;
  sttApiKey?: string;  // Optional separate API key for STT (e.g., Deepgram)
  sttModel?: string;
  sttSilenceDurationMs?: number;
}

export function loadProviderConfig(): ProviderConfig {
  const sttSilenceDurationMs = process.env.CALLME_STT_SILENCE_DURATION_MS
    ? parseInt(process.env.CALLME_STT_SILENCE_DURATION_MS, 10)
    : undefined;

  // Default to telnyx if not specified
  const phoneProvider = (process.env.CALLME_PHONE_PROVIDER || 'telnyx') as PhoneProviderType;

  // Default STT provider based on whether Deepgram key is set
  const sttProvider = (process.env.CALLME_STT_PROVIDER ||
    (process.env.CALLME_STT_API_KEY ? 'deepgram' : 'openai')) as STTProviderType;

  // Default STT model based on provider
  const defaultSttModel = sttProvider === 'deepgram' ? 'nova-2' : 'gpt-4o-transcribe';

  return {
    phoneProvider,
    phoneAccountSid: process.env.CALLME_PHONE_ACCOUNT_SID || '',
    phoneAuthToken: process.env.CALLME_PHONE_AUTH_TOKEN || '',
    phoneNumber: process.env.CALLME_PHONE_NUMBER || '',
    telnyxPublicKey: process.env.CALLME_TELNYX_PUBLIC_KEY,
    openaiApiKey: process.env.CALLME_OPENAI_API_KEY || '',
    ttsVoice: process.env.CALLME_TTS_VOICE || 'onyx',
    ttsApiKey: process.env.CALLME_TTS_API_KEY,
    ttsBaseUrl: process.env.CALLME_TTS_BASE_URL,
    sttProvider,
    sttApiKey: process.env.CALLME_STT_API_KEY,
    sttModel: process.env.CALLME_STT_MODEL || defaultSttModel,
    sttSilenceDurationMs,
  };
}

export function createPhoneProvider(config: ProviderConfig): PhoneProvider {
  let provider: PhoneProvider;

  if (config.phoneProvider === 'twilio') {
    provider = new TwilioPhoneProvider();
  } else {
    provider = new TelnyxPhoneProvider();
  }

  provider.initialize({
    accountSid: config.phoneAccountSid,
    authToken: config.phoneAuthToken,
    phoneNumber: config.phoneNumber,
  });

  return provider;
}

export function createTTSProvider(config: ProviderConfig): TTSProvider {
  const provider = new OpenAITTSProvider();
  provider.initialize({
    apiKey: config.ttsApiKey || config.openaiApiKey,
    apiUrl: config.ttsBaseUrl,
    voice: config.ttsVoice,
  });
  return provider;
}

export function createSTTProvider(config: ProviderConfig): RealtimeSTTProvider {
  if (config.sttProvider === 'deepgram') {
    const provider = new DeepgramSTTProvider();
    provider.initialize({
      apiKey: config.sttApiKey || config.openaiApiKey,
      model: config.sttModel,
      silenceDurationMs: config.sttSilenceDurationMs,
    });
    return provider;
  }

  // Default to OpenAI
  const provider = new OpenAIRealtimeSTTProvider();
  provider.initialize({
    apiKey: config.sttApiKey || config.openaiApiKey,
    model: config.sttModel,
    silenceDurationMs: config.sttSilenceDurationMs,
  });
  return provider;
}

export function createProviders(config: ProviderConfig): ProviderRegistry {
  return {
    phone: createPhoneProvider(config),
    tts: createTTSProvider(config),
    stt: createSTTProvider(config),
  };
}

/**
 * Validate that required config is present
 */
export function validateProviderConfig(config: ProviderConfig): string[] {
  const errors: string[] = [];

  // Provider-specific credential descriptions
  const credentialDesc = config.phoneProvider === 'twilio'
    ? { accountSid: 'Twilio Account SID', authToken: 'Twilio Auth Token' }
    : { accountSid: 'Telnyx Connection ID', authToken: 'Telnyx API Key' };

  if (!config.phoneAccountSid) {
    errors.push(`Missing CALLME_PHONE_ACCOUNT_SID (${credentialDesc.accountSid})`);
  }
  if (!config.phoneAuthToken) {
    errors.push(`Missing CALLME_PHONE_AUTH_TOKEN (${credentialDesc.authToken})`);
  }
  if (!config.phoneNumber) {
    errors.push('Missing CALLME_PHONE_NUMBER');
  }

  // TTS requires either ttsApiKey or openaiApiKey
  const hasTtsKey = config.ttsApiKey || config.openaiApiKey;
  if (!hasTtsKey) {
    errors.push('Missing TTS API key (set CALLME_TTS_API_KEY or CALLME_OPENAI_API_KEY)');
  }

  // STT requires either sttApiKey or openaiApiKey
  const hasSttKey = config.sttApiKey || config.openaiApiKey;
  if (!hasSttKey) {
    errors.push('Missing STT API key (set CALLME_STT_API_KEY or CALLME_OPENAI_API_KEY)');
  }

  return errors;
}
