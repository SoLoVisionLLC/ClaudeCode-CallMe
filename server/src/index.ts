#!/usr/bin/env node

/**
 * Hey Boss SaaS Server
 *
 * Modes:
 * - Self-host: Set SELF_HOST_PHONE, no Stripe/database needed
 * - SaaS: Full multi-user with Stripe payments
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { IncomingMessage, ServerResponse } from 'http';
import { CallManager, loadServerConfig } from './phone-call.js';
import { initDatabase, recordUsage } from './database.js';
import { initAuth, validateApiKey, isSelfHostMode } from './auth.js';
import { loadBillingConfig, getMonthlyMinutes, getMinutesRemaining, hasMinutesRemaining } from './billing.js';
import { initStripe, isStripeEnabled } from './stripe.js';
import { handleWebRequest } from './web.js';

// Initialize components
const dbPath = process.env.DATABASE_PATH || './heyboss.db';
if (!process.env.SELF_HOST_PHONE) {
  initDatabase(dbPath);
}

initAuth();
loadBillingConfig();

// Initialize Stripe if configured
if (process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET && process.env.STRIPE_PRICE_ID) {
  initStripe({
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    priceId: process.env.STRIPE_PRICE_ID,
    monthlyMinutes: getMonthlyMinutes(),
    monthlyPriceCents: parseInt(process.env.MONTHLY_PRICE_CENTS || '2000', 10),
  });
}

const serverConfig = loadServerConfig();
const callManager = new CallManager(serverConfig);

// Create MCP server
const mcpServer = new Server(
  { name: 'hey-boss', version: '2.0.0' },
  { capabilities: { tools: {} } }
);

// Track authenticated user for current request
let currentUser: {
  id: string;
  phoneNumber: string;
  subscriptionStatus: 'active' | 'cancelled' | 'none';
  minutesUsed: number;
} | null = null;

// List available tools
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  const subscriptionInfo = isSelfHostMode() ? '' : ' Uses your monthly minutes.';

  return {
    tools: [
      {
        name: 'initiate_call',
        description: `Start a phone call with the user.${subscriptionInfo} Use when you need voice input, want to report completed work, or need real-time discussion.`,
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

// Handle tool calls
mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (!currentUser) {
    return {
      content: [{ type: 'text', text: 'Error: Not authenticated. Please check your HEY_BOSS_API_KEY.' }],
      isError: true,
    };
  }

  // Check subscription (skip in self-host mode)
  if (!isSelfHostMode()) {
    if (currentUser.subscriptionStatus !== 'active') {
      return {
        content: [{
          type: 'text',
          text: 'Error: No active subscription. Please subscribe at heyboss.io',
        }],
        isError: true,
      };
    }

    if (!hasMinutesRemaining(currentUser.minutesUsed)) {
      return {
        content: [{
          type: 'text',
          text: 'Error: Monthly minutes exhausted. Minutes reset at the start of your next billing period.',
        }],
        isError: true,
      };
    }
  }

  try {
    if (request.params.name === 'initiate_call') {
      const { message } = request.params.arguments as { message: string };
      const result = await callManager.initiateCall(currentUser.id, currentUser.phoneNumber, message);

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

    if (request.params.name === 'end_call') {
      const { call_id, message } = request.params.arguments as { call_id: string; message: string };
      const { durationSeconds } = await callManager.endCall(call_id, message);

      // Record usage (skip in self-host mode)
      if (!isSelfHostMode()) {
        recordUsage(currentUser.id, call_id, durationSeconds);

        const minutesUsed = Math.ceil(durationSeconds / 60);
        const newTotalMinutes = currentUser.minutesUsed + minutesUsed;
        const remaining = getMinutesRemaining(newTotalMinutes);

        return {
          content: [{
            type: 'text',
            text: `Call ended. Duration: ${durationSeconds}s (${minutesUsed} min)\n\n${remaining} minutes remaining this month.`,
          }],
        };
      }

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

// HTTP handler
async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  // Health check
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      mode: isSelfHostMode() ? 'self-host' : 'saas',
      stripe: isStripeEnabled(),
    }));
    return;
  }

  // MCP endpoint
  if (url.pathname === '/mcp') {
    handleMcpRequest(req, res);
    return;
  }

  // Twilio TwiML
  if (url.pathname === '/twiml') {
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${new URL(serverConfig.publicUrl).host}/media-stream" />
  </Connect>
</Response>`;
    res.writeHead(200, { 'Content-Type': 'application/xml' });
    res.end(twiml);
    return;
  }

  // Web pages (signup, dashboard, etc.) - skip in self-host mode
  if (!isSelfHostMode()) {
    const handled = await handleWebRequest(req, res);
    if (handled) return;
  }

  res.writeHead(404);
  res.end('Not Found');
}

function handleMcpRequest(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end('Method Not Allowed');
    return;
  }

  // Authenticate
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing API key. Set HEY_BOSS_API_KEY.' }));
    return;
  }

  const apiKey = authHeader.slice(7);
  const user = validateApiKey(apiKey);
  if (!user) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid API key' }));
    return;
  }

  currentUser = {
    id: user.id,
    phoneNumber: user.phone_number,
    subscriptionStatus: user.subscription_status,
    minutesUsed: user.minutes_used,
  };

  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', async () => {
    try {
      const message = JSON.parse(body);

      if (message.method === 'tools/list') {
        const result = await mcpServer.requestHandlers.get(ListToolsRequestSchema.shape.method.value)?.(
          { method: message.method, params: message.params || {} },
          {}
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
      } else if (message.method === 'tools/call') {
        const result = await mcpServer.requestHandlers.get(CallToolRequestSchema.shape.method.value)?.(
          { method: message.method, params: message.params },
          {}
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {} }));
      }
    } catch (error) {
      console.error('MCP error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    } finally {
      currentUser = null;
    }
  });
}

// Start server
callManager.setMcpHandler(handleRequest);
callManager.startServer();

// Graceful shutdown
process.on('SIGINT', () => {
  console.error('\nShutting down...');
  callManager.shutdown();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('\nShutting down...');
  callManager.shutdown();
  process.exit(0);
});

console.error('');
console.error('Hey Boss server ready');
console.error(`Mode: ${isSelfHostMode() ? 'Self-host' : 'SaaS'}`);
console.error(`Stripe: ${isStripeEnabled() ? 'Enabled' : 'Disabled'}`);
console.error('');
