/**
 * Telnyx Connection Test Script
 *
 * Run with: bun run test-telnyx.ts
 */

// Load environment variables from .env file (Bun auto-loads .env)
const API_KEY = process.env.CALLME_PHONE_AUTH_TOKEN;
const CONNECTION_ID = process.env.CALLME_PHONE_ACCOUNT_SID;
const FROM_NUMBER = process.env.CALLME_PHONE_NUMBER;
const TO_NUMBER = process.env.CALLME_USER_PHONE_NUMBER;

console.log('=== Telnyx Connection Test ===\n');
console.log('Configuration:');
console.log(`  API Key: ${API_KEY ? API_KEY.substring(0, 10) + '...' : 'NOT SET'}`);
console.log(`  Connection ID: ${CONNECTION_ID || 'NOT SET'}`);
console.log(`  From Number: ${FROM_NUMBER || 'NOT SET'}`);
console.log(`  To Number: ${TO_NUMBER || 'NOT SET'}`);
console.log('');

async function testAuth() {
  console.log('--- Test 1: API Key Authentication ---');
  try {
    const response = await fetch('https://api.telnyx.com/v2/balance', {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
      },
    });

    if (response.ok) {
      const data = await response.json();
      console.log('✓ API Key is valid');
      console.log(`  Balance: $${data.data?.balance || 'unknown'}`);
      return true;
    } else {
      const error = await response.text();
      console.log(`✗ API Key authentication failed: ${response.status}`);
      console.log(`  Error: ${error}`);
      return false;
    }
  } catch (e) {
    console.log(`✗ Request failed: ${e}`);
    return false;
  }
}

async function testListConnections() {
  console.log('\n--- Test 2: List Call Control Applications ---');
  try {
    const response = await fetch('https://api.telnyx.com/v2/call_control_applications', {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
      },
    });

    if (response.ok) {
      const data = await response.json();
      const apps = data.data || [];
      console.log(`✓ Found ${apps.length} Call Control Application(s):`);

      for (const app of apps) {
        console.log(`\n  App: ${app.application_name || 'Unnamed'}`);
        console.log(`    ID: ${app.id}`);
        console.log(`    Webhook URL: ${app.webhook_event_url || 'NOT SET'}`);
        console.log(`    API Version: ${app.webhook_api_version || 'unknown'}`);
        console.log(`    Active: ${app.active}`);

        if (app.id === CONNECTION_ID) {
          console.log(`    *** THIS IS YOUR CONFIGURED CONNECTION ***`);
        }
      }

      // Check if configured connection_id exists
      const configuredApp = apps.find((a: any) => a.id === CONNECTION_ID);
      if (!configuredApp) {
        console.log(`\n⚠ WARNING: Your configured CONNECTION_ID (${CONNECTION_ID}) was NOT found!`);
        console.log('  Please use one of the IDs listed above.');
      }

      return apps;
    } else {
      const error = await response.text();
      console.log(`✗ Failed to list applications: ${response.status}`);
      console.log(`  Error: ${error}`);
      return [];
    }
  } catch (e) {
    console.log(`✗ Request failed: ${e}`);
    return [];
  }
}

async function testListPhoneNumbers() {
  console.log('\n--- Test 3: List Phone Numbers ---');
  try {
    const response = await fetch('https://api.telnyx.com/v2/phone_numbers', {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
      },
    });

    if (response.ok) {
      const data = await response.json();
      const numbers = data.data || [];
      console.log(`✓ Found ${numbers.length} phone number(s):`);

      for (const num of numbers) {
        console.log(`\n  Number: ${num.phone_number}`);
        console.log(`    Connection ID: ${num.connection_id || 'NOT ASSIGNED'}`);
        console.log(`    Status: ${num.status}`);

        if (num.phone_number === FROM_NUMBER) {
          console.log(`    *** THIS IS YOUR CONFIGURED FROM NUMBER ***`);
          if (num.connection_id !== CONNECTION_ID) {
            console.log(`    ⚠ WARNING: This number is assigned to connection ${num.connection_id}, not ${CONNECTION_ID}`);
          }
        }
      }

      return numbers;
    } else {
      const error = await response.text();
      console.log(`✗ Failed to list phone numbers: ${response.status}`);
      console.log(`  Error: ${error}`);
      return [];
    }
  } catch (e) {
    console.log(`✗ Request failed: ${e}`);
    return [];
  }
}

async function testCreateCall() {
  console.log('\n--- Test 4: Create Test Call (DRY RUN) ---');
  console.log('Payload that would be sent:');
  console.log(JSON.stringify({
    connection_id: CONNECTION_ID,
    to: TO_NUMBER,
    from: FROM_NUMBER,
    webhook_url: 'https://uselessly-gonadal-farah.ngrok-free.dev/twiml',
    webhook_url_method: 'POST',
    answering_machine_detection: 'detect',
    timeout_secs: 60,
  }, null, 2));

  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise<void>((resolve) => {
    rl.question('\nDo you want to make an actual test call? (y/n): ', async (answer) => {
      rl.close();

      if (answer.toLowerCase() !== 'y') {
        console.log('Skipping actual call test.');
        resolve();
        return;
      }

      console.log('\nMaking test call...');
      try {
        const response = await fetch('https://api.telnyx.com/v2/calls', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            connection_id: CONNECTION_ID,
            to: TO_NUMBER,
            from: FROM_NUMBER,
            webhook_url: 'https://uselessly-gonadal-farah.ngrok-free.dev/twiml',
            webhook_url_method: 'POST',
            timeout_secs: 30,
          }),
        });

        const data = await response.json();

        if (response.ok) {
          console.log('✓ Call initiated successfully!');
          console.log(`  Call Control ID: ${data.data?.call_control_id}`);
        } else {
          console.log(`✗ Call failed: ${response.status}`);
          console.log(`  Error: ${JSON.stringify(data, null, 2)}`);
        }
      } catch (e) {
        console.log(`✗ Request failed: ${e}`);
      }

      resolve();
    });
  });
}

async function main() {
  if (!API_KEY) {
    console.log('ERROR: CALLME_PHONE_AUTH_TOKEN not set in .env');
    process.exit(1);
  }

  const authOk = await testAuth();
  if (!authOk) {
    console.log('\nStopping tests - API authentication failed.');
    process.exit(1);
  }

  await testListConnections();
  await testListPhoneNumbers();
  await testCreateCall();

  console.log('\n=== Test Complete ===');
}

main();
