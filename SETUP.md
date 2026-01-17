# CallMe Setup Guide

This guide covers configuring the CallMe MCP server with alternative TTS and STT providers for cost optimization.

## Overview

CallMe is an MCP server that lets Claude Code call you on the phone. It requires:
- **Phone provider**: Telnyx (recommended) or Twilio
- **TTS (Text-to-Speech)**: OpenAI, LemonFox, or any OpenAI-compatible API
- **STT (Speech-to-Text)**: OpenAI Realtime or Deepgram
- **ngrok**: For exposing webhooks to phone providers

## Provider Options

### Phone Providers

| Provider | Cost | Notes |
|----------|------|-------|
| **Telnyx** (recommended) | ~$0.007/min + $1/mo | 50% cheaper than Twilio |
| Twilio | ~$0.014/min + $1.15/mo | Requires $20 minimum credit |

### TTS Providers

| Provider | Cost | Notes |
|----------|------|-------|
| OpenAI | ~$15/1M characters | High quality, standard option |
| **LemonFox** (recommended) | ~$2.50/1M characters | 6x cheaper, OpenAI-compatible |

### STT Providers

| Provider | Cost | Notes |
|----------|------|-------|
| OpenAI Realtime | ~$0.006/min | Uses WebSocket, high quality |
| **Deepgram** (recommended) | ~$0.0043/min | 30% cheaper, excellent accuracy |

## Quick Start

### 1. Get Your API Keys

1. **Phone (Telnyx)**:
   - Create account at [portal.telnyx.com](https://portal.telnyx.com)
   - Buy a phone number (~$1/month)
   - Create a Call Control application
   - Note your **Connection ID** and **API Key**

2. **TTS (LemonFox)**:
   - Sign up at [lemonfox.ai](https://lemonfox.ai)
   - Get your API key from the dashboard

3. **STT (Deepgram)**:
   - Sign up at [deepgram.com](https://deepgram.com)
   - Get your API key from the console

4. **ngrok**:
   - Sign up at [ngrok.com](https://ngrok.com) (free tier works)
   - Get your auth token from the dashboard

### 2. Configure Environment

Create `server/.env`:

```bash
# ===================
# Phone Provider (Telnyx)
# ===================
CALLME_PHONE_ACCOUNT_SID=your_telnyx_connection_id
CALLME_PHONE_AUTH_TOKEN=your_telnyx_api_key
CALLME_PHONE_NUMBER=+15551234567      # Your Telnyx number
CALLME_USER_PHONE_NUMBER=+15559876543 # Your personal phone

# Optional: Webhook signature verification (recommended)
# CALLME_TELNYX_PUBLIC_KEY=your_public_key

# ===================
# TTS - LemonFox
# ===================
CALLME_TTS_API_KEY=your_lemonfox_api_key
CALLME_TTS_BASE_URL=https://api.lemonfox.ai/v1
CALLME_TTS_VOICE=heart

# ===================
# STT - Deepgram
# ===================
CALLME_STT_API_KEY=your_deepgram_api_key

# ===================
# ngrok
# ===================
CALLME_NGROK_AUTHTOKEN=your_ngrok_authtoken

# ===================
# Optional
# ===================
# CALLME_PORT=3333
# CALLME_NGROK_DOMAIN=your-custom-domain.ngrok.io
```

### 3. Run the Server

```bash
cd server
bun install
bun run src/index.ts
```

You should see output like:
```
Starting ngrok tunnel...
ngrok tunnel: https://xxxx.ngrok-free.dev
Phone provider: Telnyx (API v2)
TTS provider: lemonfox (tts-1, voice: heart, 24000Hz)
STT provider: Deepgram (nova-2, silence: 800ms)

CallMe MCP server ready
Phone: +15551234567 -> +15559876543
```

## Complete Environment Variable Reference

### Required Variables

| Variable | Description |
|----------|-------------|
| `CALLME_PHONE_ACCOUNT_SID` | Telnyx Connection ID or Twilio Account SID |
| `CALLME_PHONE_AUTH_TOKEN` | Telnyx API Key or Twilio Auth Token |
| `CALLME_PHONE_NUMBER` | Phone number to call FROM (E.164 format) |
| `CALLME_USER_PHONE_NUMBER` | Your phone number to receive calls |
| `CALLME_NGROK_AUTHTOKEN` | ngrok auth token |

**Note**: You must provide either `CALLME_TTS_API_KEY` or `CALLME_OPENAI_API_KEY` for TTS, and either `CALLME_STT_API_KEY` or `CALLME_OPENAI_API_KEY` for STT.

### Phone Provider Options

| Variable | Default | Description |
|----------|---------|-------------|
| `CALLME_PHONE_PROVIDER` | `telnyx` | `telnyx` or `twilio` |
| `CALLME_TELNYX_PUBLIC_KEY` | - | Telnyx public key for webhook verification |

### TTS Options

| Variable | Default | Description |
|----------|---------|-------------|
| `CALLME_TTS_API_KEY` | - | API key for TTS provider (falls back to OpenAI key) |
| `CALLME_TTS_BASE_URL` | - | Custom base URL (e.g., `https://api.lemonfox.ai/v1`) |
| `CALLME_TTS_VOICE` | `onyx` | Voice to use (provider-dependent) |
| `CALLME_TTS_SAMPLE_RATE` | `24000` | TTS output sample rate in Hz |

**LemonFox voices**: `heart`, `aloe`, `dan`, `lola`, `sarah`, `fable`, etc.

### STT Options

| Variable | Default | Description |
|----------|---------|-------------|
| `CALLME_STT_PROVIDER` | auto | `openai` or `deepgram` (auto-detects based on API key) |
| `CALLME_STT_API_KEY` | - | API key for STT provider (falls back to OpenAI key) |
| `CALLME_STT_MODEL` | varies | STT model (`nova-2` for Deepgram, `gpt-4o-transcribe` for OpenAI) |
| `CALLME_STT_SILENCE_DURATION_MS` | `800` | Silence duration to detect end of speech |

### Other Options

| Variable | Default | Description |
|----------|---------|-------------|
| `CALLME_PORT` | `3333` | Local HTTP server port |
| `CALLME_NGROK_DOMAIN` | - | Custom ngrok domain (paid feature) |
| `CALLME_TRANSCRIPT_TIMEOUT_MS` | `180000` | Max wait time for user speech (3 min) |
| `CALLME_OPENAI_API_KEY` | - | Fallback API key for TTS/STT if not using alternatives |

## Cost Comparison

### Per-Minute Breakdown

| Configuration | Phone | TTS | STT | **Total** |
|--------------|-------|-----|-----|-----------|
| Telnyx + OpenAI + OpenAI | $0.007 | ~$0.02 | ~$0.006 | **~$0.033/min** |
| Telnyx + LemonFox + Deepgram | $0.007 | ~$0.003 | ~$0.004 | **~$0.014/min** |
| Twilio + OpenAI + OpenAI | $0.014 | ~$0.02 | ~$0.006 | **~$0.040/min** |

**Using LemonFox + Deepgram saves ~60% compared to OpenAI-only configuration.**

### Monthly Costs (at 100 minutes/month)

| Configuration | Cost |
|--------------|------|
| Premium (Twilio + OpenAI) | ~$5.15/mo |
| **Budget (Telnyx + LemonFox + Deepgram)** | **~$2.40/mo** |

## Troubleshooting

### Common Issues

**"Missing TTS API key" or "Missing STT API key"**
- Set either the provider-specific key (`CALLME_TTS_API_KEY`, `CALLME_STT_API_KEY`) or the fallback (`CALLME_OPENAI_API_KEY`)

**Audio sounds choppy or cuts out**
- This was fixed in the latest version with 500ms audio chunks
- Ensure you're using the latest code

**Call connects but no audio**
- Check that your Telnyx webhook URL matches your ngrok URL
- Verify the phone number is verified in Telnyx portal

**Deepgram connection drops**
- The provider includes automatic reconnection with exponential backoff
- Check your API key is valid

**ngrok errors**
- Verify your `CALLME_NGROK_AUTHTOKEN` is correct
- Check if you've hit ngrok's free tier limits (try a different port)

### Debug Mode

Run Claude Code with debug output:
```bash
claude --debug
```

This shows the MCP server logs including connection status and webhook events.

## Architecture

```
Claude Code
    │
    │ stdio (MCP protocol)
    ▼
CallMe MCP Server (local)
    │
    ├─► ngrok tunnel (webhooks)
    │
    ├─► TTS Provider (LemonFox/OpenAI)
    │   └── Converts Claude's text to audio
    │
    ├─► STT Provider (Deepgram/OpenAI)
    │   └── Converts your speech to text
    │
    └─► Phone Provider (Telnyx/Twilio)
        │
        ▼
    Your Phone
```

### Audio Pipeline

1. **Claude speaks**: Text → TTS (24kHz PCM) → Resample to 8kHz → mu-law encode → Phone
2. **You speak**: Phone → mu-law audio (8kHz) → STT WebSocket → Transcript → Claude

## Changes from Original

The following enhancements were made to support alternative providers:

### New Files
- `server/src/providers/stt-deepgram.ts` - Deepgram streaming STT provider

### Modified Files
- `server/src/providers/tts-openai.ts` - Added LemonFox support via custom base URL
- `server/src/providers/index.ts` - Updated factory to support provider selection
- `server/src/providers/types.ts` - Added `sampleRate` to TTSProvider interface
- `server/src/phone-call.ts` - Fixed audio chunking (500ms), dynamic sample rate resampling

### Key Technical Changes
1. **WAV header parsing**: Auto-detects sample rate from LemonFox response
2. **500ms audio chunks**: Fixed choppy audio by sending larger chunks with proper delays
3. **Linear interpolation resampling**: Improved audio quality when converting 24kHz → 8kHz
4. **Deepgram WebSocket**: Native mu-law support, built-in endpointing for turn detection
