/**
 * Authentication
 *
 * Supports two modes:
 * 1. Self-host mode: Single user, no database needed
 * 2. SaaS mode: Multiple users with database
 */

import { getUserByApiKey as dbGetUserByApiKey, User } from './database.js';

let selfHostMode = false;
let selfHostUser: User | null = null;

export function initAuth(): void {
  // Check if running in self-host mode
  const selfHostPhone = process.env.SELF_HOST_PHONE;
  const selfHostKey = process.env.SELF_HOST_API_KEY || 'self-host';

  if (selfHostPhone) {
    selfHostMode = true;
    selfHostUser = {
      id: 'self-host',
      email: 'self-host@localhost',
      phone_number: selfHostPhone,
      api_key: selfHostKey,
      stripe_customer_id: null,
      stripe_subscription_id: null,
      subscription_status: 'active',  // Always active in self-host
      period_start: null,
      period_end: null,
      minutes_used: 0,  // Unlimited in self-host mode
      created_at: new Date().toISOString(),
      enabled: true,
    };
    console.error(`Self-host mode: calls will go to ${selfHostPhone}`);
    console.error(`API key: ${selfHostKey}`);
  } else {
    console.error('SaaS mode: users managed via database');
  }
}

export function isSelfHostMode(): boolean {
  return selfHostMode;
}

export function validateApiKey(apiKey: string): User | null {
  if (selfHostMode && selfHostUser) {
    // In self-host mode, accept any key or the configured key
    if (apiKey === selfHostUser.api_key || apiKey === 'self-host') {
      return selfHostUser;
    }
    return null;
  }

  // SaaS mode: look up in database
  return dbGetUserByApiKey(apiKey);
}

export function getSelfHostUser(): User | null {
  return selfHostUser;
}
