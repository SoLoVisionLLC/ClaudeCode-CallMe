#!/usr/bin/env bun

/**
 * CallMe MCP Server - HTTP Transport (for cloud deployment)
 *
 * Single unified HTTP server that handles:
 * - /mcp          -> MCP Streamable HTTP (newer protocol 2025-11-25)
 * - /sse          -> MCP SSE connection (legacy protocol 2024-11-05)
 * - /messages     -> MCP message posting (for SSE)
 * - /twiml        -> Phone provider webhooks (Twilio/Telnyx)
 * - /media-stream -> WebSocket for real-time audio
 * - /health       -> Health check
 *
 * Designed for deployment on Coolify, Railway, or similar platforms.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { CallManager, loadServerConfig, type ServerConfig } from './phone-call.js';
import { createServer, IncomingMessage, ServerResponse } from 'http';

// Store active transports by session ID
const transports = new Map<string, SSEServerTransport | StreamableHTTPServerTransport>();

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
  console.error('CallMe MCP server (HTTP mode) starting...');
  console.error(`Public URL: ${publicUrl}`);
  console.error(`Port: ${port}`);
  console.error(`Phone: ${serverConfig.phoneNumber} -> ${serverConfig.userPhoneNumber}`);
  console.error(`Providers: phone=${serverConfig.providers.phone.name}, tts=${serverConfig.providers.tts.name}, stt=${serverConfig.providers.stt.name}`);
  console.error('');

  // Helper to read request body
  const readBody = (req: IncomingMessage): Promise<string> => {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
  };

  // Create unified HTTP server
  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);

    // CORS headers for all requests
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, Mcp-Session-Id');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Type, Authorization, Mcp-Session-Id');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // OAuth metadata endpoint (for MCP SSE auth) - DISABLED FOR TESTING
    if (false && url.pathname === '/.well-known/oauth-authorization-server') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        issuer: publicUrl,
        authorization_endpoint: `${publicUrl}/oauth/authorize`,
        token_endpoint: `${publicUrl}/oauth/token`,
        registration_endpoint: `${publicUrl}/oauth/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
      }));
      return;
    }

    // OAuth dynamic client registration (RFC 7591)
    if (url.pathname === '/oauth/register' && req.method === 'POST') {
      const body = await readBody(req);
      let requestData: any = {};
      try { requestData = JSON.parse(body); } catch {}

      const clientId = crypto.randomUUID();
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        client_id: clientId,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code'],
        response_types: ['code'],
        redirect_uris: requestData.redirect_uris || [],
        client_name: requestData.client_name || 'Claude Code',
        scope: requestData.scope || '',
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
      await readBody(req); // consume body
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        access_token: crypto.randomUUID(),
        token_type: 'Bearer',
        expires_in: 86400,
      }));
      return;
    }

    //=========================================================================
    // STREAMABLE HTTP TRANSPORT (Protocol 2025-11-25) - NEW
    //=========================================================================
    if (url.pathname === '/mcp') {
      console.error(`[MCP] ${req.method} /mcp`);

      try {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        let transport: StreamableHTTPServerTransport | undefined;

        // Check for existing session
        if (sessionId) {
          const existing = transports.get(sessionId);
          if (existing instanceof StreamableHTTPServerTransport) {
            transport = existing;
            console.error(`[MCP] Reusing session: ${sessionId}`);
          }
        }

        // For new sessions (POST with initialize request)
        if (!transport && req.method === 'POST') {
          const body = await readBody(req);
          const parsed = body ? JSON.parse(body) : undefined;

          if (isInitializeRequest(parsed)) {
            console.error('[MCP] New Streamable HTTP session');
            transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => crypto.randomUUID(),
              onsessioninitialized: (sid) => {
                console.error(`[MCP] Session initialized: ${sid}`);
                transports.set(sid, transport!);
              }
            });

            transport.onclose = () => {
              const sid = transport!.sessionId;
              if (sid) {
                console.error(`[MCP] Session closed: ${sid}`);
                transports.delete(sid);
              }
            };

            const mcpServer = createMcpServer(callManager);
            await mcpServer.connect(transport);
          }

          if (transport) {
            await transport.handleRequest(req, res, parsed);
            return;
          }
        }

        // Handle other requests with existing transport
        if (transport) {
          const body = req.method === 'POST' ? await readBody(req) : undefined;
          const parsed = body ? JSON.parse(body) : undefined;
          await transport.handleRequest(req, res, parsed);
          return;
        }

        // No valid session
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: No valid session' },
          id: null
        }));
      } catch (error) {
        console.error('[MCP] Error:', error);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null
          }));
        }
      }
      return;
    }

    //=========================================================================
    // SSE TRANSPORT (Protocol 2024-11-05) - LEGACY/DEPRECATED
    //=========================================================================
    if (url.pathname === '/sse' && req.method === 'GET') {
      console.error('[MCP] New SSE connection (legacy)');

      const transport = new SSEServerTransport('/messages', res);
      transports.set(transport.sessionId, transport);
      console.error(`[MCP] SSE Session: ${transport.sessionId}`);

      res.on('close', () => {
        console.error(`[MCP] SSE closed: ${transport.sessionId}`);
        transports.delete(transport.sessionId);
      });

      const mcpServer = createMcpServer(callManager);
      await mcpServer.connect(transport);
      return;
    }

    // SSE messages endpoint
    if (url.pathname === '/messages' && req.method === 'POST') {
      const sessionId = url.searchParams.get('sessionId');
      console.error(`[MCP] POST /messages, session: ${sessionId}`);

      const existing = sessionId ? transports.get(sessionId) : undefined;
      if (existing instanceof SSEServerTransport) {
        const body = await readBody(req);
        await existing.handlePostMessage(req, res, body);
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid or missing session' }));
      }
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
    console.error(`  ${publicUrl}/mcp          -> MCP Streamable HTTP (new)`);
    console.error(`  ${publicUrl}/sse          -> MCP SSE (legacy)`);
    console.error(`  ${publicUrl}/twiml        -> Phone webhooks`);
    console.error(`  ${publicUrl}/health       -> Health check`);
    console.error('');
    console.error('Connect Claude Code with:');
    console.error(`  claude mcp add -s user --transport sse callme ${publicUrl}/sse`);
    console.error('');
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.error('\nShutting down...');
    callManager.shutdown();
    for (const [sid, transport] of transports) {
      try {
        await transport.close();
      } catch (e) {
        console.error(`Error closing session ${sid}:`, e);
      }
    }
    transports.clear();
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
