#!/usr/bin/env bun

/**
 * CallMe MCP Server - SSE Transport (for cloud deployment)
 *
 * Single unified HTTP server that handles:
 * - /sse         → MCP SSE connection (Claude Code)
 * - /messages    → MCP message posting
 * - /twiml       → Phone provider webhooks (Twilio/Telnyx)
 * - /media-stream → WebSocket for real-time audio
 * - /health      → Health check
 *
 * Designed for deployment on Coolify, Railway, or similar platforms.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { CallManager, loadServerConfig, type ServerConfig } from './phone-call.js';
import { createServer, IncomingMessage, ServerResponse } from 'http';

// Store active SSE transports
const activeTransports = new Map<string, SSEServerTransport>();

function createMcpServer(callManager: CallManager): Server {
  const mcpServer = new Server(
    { name: 'callme', version: '3.0.0' },
    { capabilities: { tools: {} } }
  );

  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'initiate_call',
          description: 'Start a phone call with the user. Use when you need voice input, want to report completed work, or need real-time discussion.',
          inputSchema: {
            type: 'object',
            properties: {
              message: {
                type: 'string',
                description: 'What you want to say to the user. Be natural and conversational.',
              },
            },
            required: ['message'],
          },
        },
        {
          name: 'continue_call',
          description: 'Continue an active call with a follow-up message.',
          inputSchema: {
            type: 'object',
            properties: {
              call_id: { type: 'string', description: 'The call ID from initiate_call' },
              message: { type: 'string', description: 'Your follow-up message' },
            },
            required: ['call_id', 'message'],
          },
        },
        {
          name: 'speak_to_user',
          description: 'Speak a message on an active call without waiting for a response.',
          inputSchema: {
            type: 'object',
            properties: {
              call_id: { type: 'string', description: 'The call ID from initiate_call' },
              message: { type: 'string', description: 'What to say to the user' },
            },
            required: ['call_id', 'message'],
          },
        },
        {
          name: 'end_call',
          description: 'End an active call with a closing message.',
          inputSchema: {
            type: 'object',
            properties: {
              call_id: { type: 'string', description: 'The call ID from initiate_call' },
              message: { type: 'string', description: 'Your closing message (say goodbye!)' },
            },
            required: ['call_id', 'message'],
          },
        },
      ],
    };
  });

  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      if (request.params.name === 'initiate_call') {
        const { message } = request.params.arguments as { message: string };
        const result = await callManager.initiateCall(message);
        return {
          content: [{
            type: 'text',
            text: `Call initiated successfully.\n\nCall ID: ${result.callId}\n\nUser's response:\n${result.response}\n\nUse continue_call to ask follow-ups or end_call to hang up.`,
          }],
        };
      }

      if (request.params.name === 'continue_call') {
        const { call_id, message } = request.params.arguments as { call_id: string; message: string };
        const response = await callManager.continueCall(call_id, message);
        return {
          content: [{ type: 'text', text: `User's response:\n${response}` }],
        };
      }

      if (request.params.name === 'speak_to_user') {
        const { call_id, message } = request.params.arguments as { call_id: string; message: string };
        await callManager.speakOnly(call_id, message);
        return {
          content: [{ type: 'text', text: `Message spoken: "${message}"` }],
        };
      }

      if (request.params.name === 'end_call') {
        const { call_id, message } = request.params.arguments as { call_id: string; message: string };
        const { durationSeconds } = await callManager.endCall(call_id, message);
        return {
          content: [{ type: 'text', text: `Call ended. Duration: ${durationSeconds}s` }],
        };
      }

      throw new Error(`Unknown tool: ${request.params.name}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [{ type: 'text', text: `Error: ${errorMessage}` }],
        isError: true,
      };
    }
  });

  return mcpServer;
}

async function main() {
  // Get public URL from environment (required for cloud deployment)
  const publicUrl = process.env.CALLME_PUBLIC_URL;
  if (!publicUrl) {
    console.error('CALLME_PUBLIC_URL is required for cloud deployment.');
    console.error('Set it to your deployment URL, e.g., https://callme.sololink.cloud');
    process.exit(1);
  }

  // Get port (Coolify/Railway set PORT env var)
  const port = parseInt(process.env.PORT || process.env.CALLME_PORT || '3333', 10);

  // Load server config
  let serverConfig: ServerConfig;
  try {
    serverConfig = loadServerConfig(publicUrl);
  } catch (error) {
    console.error('Configuration error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }

  // Create call manager
  const callManager = new CallManager(serverConfig);

  console.error('');
  console.error('CallMe MCP server (SSE mode) starting...');
  console.error(`Public URL: ${publicUrl}`);
  console.error(`Port: ${port}`);
  console.error(`Phone: ${serverConfig.phoneNumber} -> ${serverConfig.userPhoneNumber}`);
  console.error(`Providers: phone=${serverConfig.providers.phone.name}, tts=${serverConfig.providers.tts.name}, stt=${serverConfig.providers.stt.name}`);
  console.error('');

  // Create unified HTTP server
  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);

    // CORS headers for all requests
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // OAuth metadata endpoint (for MCP SSE auth)
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        issuer: publicUrl,
        authorization_endpoint: `${publicUrl}/oauth/authorize`,
        token_endpoint: `${publicUrl}/oauth/token`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code'],
        code_challenge_methods_supported: ['S256'],
      }));
      return;
    }

    // OAuth authorize endpoint - auto-approve and redirect
    if (url.pathname === '/oauth/authorize') {
      const redirectUri = url.searchParams.get('redirect_uri');
      const state = url.searchParams.get('state');
      const code = crypto.randomUUID();

      if (redirectUri) {
        const redirectUrl = new URL(redirectUri);
        redirectUrl.searchParams.set('code', code);
        if (state) redirectUrl.searchParams.set('state', state);
        res.writeHead(302, { Location: redirectUrl.toString() });
        res.end();
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'missing redirect_uri' }));
      }
      return;
    }

    // OAuth token endpoint - return access token
    if (url.pathname === '/oauth/token' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          access_token: crypto.randomUUID(),
          token_type: 'Bearer',
          expires_in: 86400,
        }));
      });
      return;
    }

    // SSE endpoint - Claude Code connects here
    if (url.pathname === '/sse' && req.method === 'GET') {
      console.error('[MCP] New SSE connection');

      const transport = new SSEServerTransport('/messages', res);
      const sessionId = crypto.randomUUID();
      activeTransports.set(sessionId, transport);

      const mcpServer = createMcpServer(callManager);

      res.on('close', () => {
        console.error('[MCP] SSE connection closed');
        activeTransports.delete(sessionId);
        mcpServer.close().catch(console.error);
      });

      try {
        await mcpServer.connect(transport);
        console.error('[MCP] Server connected');
      } catch (error) {
        console.error('[MCP] Connection error:', error);
        activeTransports.delete(sessionId);
      }
      return;
    }

    // Messages endpoint - receives POST requests from Claude Code
    if (url.pathname === '/messages' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', async () => {
        try {
          const sessionId = url.searchParams.get('sessionId');
          let transport = sessionId ? activeTransports.get(sessionId) : undefined;

          if (!transport) {
            // Fallback to most recent transport
            const transports = Array.from(activeTransports.values());
            transport = transports[transports.length - 1];
          }

          if (transport) {
            await transport.handlePostMessage(req, res, body);
          } else {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'No active SSE session' }));
          }
        } catch (error) {
          console.error('[MCP] Message error:', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal error' }));
        }
      });
      return;
    }

    // Phone webhook and health routes (delegated to CallManager)
    if (callManager.handleHttpRequest(req, res)) {
      return;
    }

    // 404 for unknown routes
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  // Attach CallManager for WebSocket handling (/media-stream)
  callManager.attachToServer(httpServer);

  // Start the unified server
  httpServer.listen(port, '0.0.0.0', () => {
    console.error(`Server listening on port ${port}`);
    console.error('');
    console.error('Endpoints:');
    console.error(`  ${publicUrl}/sse         → MCP SSE (Claude Code)`);
    console.error(`  ${publicUrl}/twiml       → Phone webhooks`);
    console.error(`  ${publicUrl}/health      → Health check`);
    console.error('');
    console.error('Connect Claude Code with:');
    console.error(`  claude mcp add -s user --transport sse callme ${publicUrl}/sse`);
    console.error('');
  });

  // Graceful shutdown
  const shutdown = () => {
    console.error('\nShutting down...');
    callManager.shutdown();
    httpServer.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
