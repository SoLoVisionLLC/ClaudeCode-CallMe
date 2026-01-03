import Twilio from 'twilio';
import WebSocket from 'ws';
import { createServer } from 'http';

interface CallResult {
  status: 'completed' | 'failed' | 'timeout';
  transcript: string;
  duration: number;
  callId?: string;
}

interface Config {
  twilioAccountSid: string;
  twilioAuthToken: string;
  twilioPhoneNumber: string;
  userPhoneNumber: string;
  openaiApiKey: string;
  publicUrl: string;
  port: number;
}

function loadConfig(): Config {
  const required = [
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_PHONE_NUMBER',
    'USER_PHONE_NUMBER',
    'OPENAI_API_KEY',
    'PUBLIC_URL',
  ];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
        'Please configure these in your .env file or Claude Code settings.'
    );
  }

  return {
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID!,
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN!,
    twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER!,
    userPhoneNumber: process.env.USER_PHONE_NUMBER!,
    openaiApiKey: process.env.OPENAI_API_KEY!,
    publicUrl: process.env.PUBLIC_URL!,
    port: parseInt(process.env.PORT || '3000', 10),
  };
}

class VoiceHandler {
  private openaiWs: WebSocket | null = null;
  private userResponses: string[] = [];
  private isComplete = false;
  private startTime: number;

  constructor(
    private config: Config,
    private question: string,
    private urgency: string
  ) {
    this.startTime = Date.now();
  }

  async handleCall(twilioWs: WebSocket): Promise<CallResult> {
    return new Promise((resolve, reject) => {
      this.initializeOpenAI(resolve, reject);

      twilioWs.on('message', (message: string) => {
        try {
          const msg = JSON.parse(message);
          this.handleTwilioMessage(msg);
        } catch (error) {
          console.error('Error parsing Twilio message:', error);
        }
      });

      twilioWs.on('close', () => {
        this.cleanup();
        if (!this.isComplete) {
          reject(new Error('Call ended prematurely'));
        }
      });

      twilioWs.on('error', (error) => {
        this.cleanup();
        reject(error);
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        if (!this.isComplete) {
          this.cleanup();
          reject(new Error('Call timeout after 5 minutes'));
        }
      }, 300000);
    });
  }

  private initializeOpenAI(
    resolve: (value: CallResult) => void,
    reject: (reason: any) => void
  ) {
    const url = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17';
    this.openaiWs = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${this.config.openaiApiKey}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    });

    this.openaiWs.on('open', () => {
      console.error('Connected to OpenAI Realtime API');
      this.sendSessionUpdate();
    });

    this.openaiWs.on('message', (data: Buffer) => {
      try {
        const event = JSON.parse(data.toString());
        this.handleOpenAIEvent(event, resolve, reject);
      } catch (error) {
        console.error('Error parsing OpenAI message:', error);
      }
    });

    this.openaiWs.on('error', (error) => {
      reject(error);
    });
  }

  private sendSessionUpdate() {
    const urgencyNote = this.urgency === 'high' ? 'This is time-sensitive. ' : '';
    const systemMessage = `You are calling on behalf of Claude Code, an AI coding assistant.

${urgencyNote}Claude needs the following information:
${this.question}

Your task:
1. Briefly explain what Claude needs (1-2 sentences)
2. Ask for the user's input
3. Listen carefully to their response
4. Ask clarifying questions if the response is unclear or incomplete
5. Once you have a complete answer, say "Thank you, I'll relay this to Claude" and the call will end

Keep responses concise and natural for phone conversation. Be professional and helpful.`;

    this.openaiWs?.send(
      JSON.stringify({
        type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          instructions: systemMessage,
          voice: 'alloy',
          input_audio_format: 'g711_ulaw',
          output_audio_format: 'g711_ulaw',
          input_audio_transcription: {
            model: 'whisper-1',
          },
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
          },
          temperature: 0.8,
        },
      })
    );
  }

  private handleTwilioMessage(msg: any) {
    switch (msg.event) {
      case 'media':
        if (this.openaiWs?.readyState === WebSocket.OPEN) {
          this.openaiWs.send(
            JSON.stringify({
              type: 'input_audio_buffer.append',
              audio: msg.media.payload,
            })
          );
        }
        break;
    }
  }

  private handleOpenAIEvent(
    event: any,
    resolve: (value: CallResult) => void,
    reject: (reason: any) => void
  ) {
    switch (event.type) {
      case 'conversation.item.input_audio_transcription.completed':
        const userText = event.transcript;
        console.error('User said:', userText);
        this.userResponses.push(userText);
        break;

      case 'response.done':
        const response = event.response;
        if (response.output && response.output.length > 0) {
          const assistantText = response.output
            .filter((item: any) => item.type === 'message')
            .map((item: any) =>
              item.content
                .filter((c: any) => c.type === 'text')
                .map((c: any) => c.text)
                .join(' ')
            )
            .join(' ');

          if (
            assistantText &&
            (assistantText.toLowerCase().includes("i'll relay this to claude") ||
              assistantText.toLowerCase().includes('thank you'))
          ) {
            this.completeCall(resolve);
          }
        }
        break;

      case 'error':
        console.error('OpenAI error:', event.error);
        reject(new Error(event.error.message));
        break;
    }
  }

  private completeCall(resolve: (value: CallResult) => void) {
    this.isComplete = true;
    const duration = Math.round((Date.now() - this.startTime) / 1000);

    setTimeout(() => {
      const transcript = this.userResponses.join('\n\n');
      console.error('Call completed with result:', transcript);
      this.cleanup();
      resolve({
        status: 'completed',
        transcript: transcript || 'No response captured',
        duration,
      });
    }, 2000);
  }

  private cleanup() {
    if (this.openaiWs) {
      this.openaiWs.close();
      this.openaiWs = null;
    }
  }
}

export async function makePhoneCall(
  question: string,
  urgency: string = 'normal'
): Promise<CallResult> {
  const config = loadConfig();
  const twilioClient = Twilio(config.twilioAccountSid, config.twilioAuthToken);

  return new Promise((resolve, reject) => {
    let server: any;
    let streamSid: string | null = null;

    // Create HTTP server for Twilio webhooks
    const httpServer = createServer((req, res) => {
      const url = new URL(req.url!, `http://${req.headers.host}`);

      if (url.pathname === '/twiml') {
        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${new URL(config.publicUrl).host}/media-stream" />
  </Connect>
</Response>`;
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        res.end(twiml);
      } else if (url.pathname === '/status') {
        res.writeHead(200);
        res.end('OK');
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    // Create WebSocket server
    const wss = new WebSocket.Server({ noServer: true });

    httpServer.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url!, `http://${request.headers.host}`);
      if (url.pathname === '/media-stream') {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
      } else {
        socket.destroy();
      }
    });

    wss.on('connection', (ws) => {
      console.error('Twilio WebSocket connected');
      const handler = new VoiceHandler(config, question, urgency);

      ws.on('message', (message: string) => {
        try {
          const msg = JSON.parse(message);
          if (msg.event === 'start') {
            streamSid = msg.start.streamSid;
            console.error('Call started, streamSid:', streamSid);
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      });

      handler
        .handleCall(ws)
        .then((result) => {
          cleanup();
          resolve(result);
        })
        .catch((error) => {
          cleanup();
          reject(error);
        });
    });

    httpServer.listen(config.port, () => {
      console.error(`Server listening on port ${config.port}`);

      // Initiate the call
      twilioClient.calls
        .create({
          url: `${config.publicUrl}/twiml`,
          to: config.userPhoneNumber,
          from: config.twilioPhoneNumber,
          timeout: 60,
          statusCallback: `${config.publicUrl}/status`,
          statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        })
        .then((call) => {
          console.error('Call initiated:', call.sid);
        })
        .catch((error) => {
          console.error('Error initiating call:', error);
          cleanup();
          reject(error);
        });
    });

    function cleanup() {
      wss.close();
      httpServer.close();
    }

    // Cleanup after 6 minutes regardless
    setTimeout(() => {
      cleanup();
    }, 360000);
  });
}
