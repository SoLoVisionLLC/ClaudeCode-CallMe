# Phone Call Input Skill

## Description
Enables Claude Code to call the user on the phone when input, clarification, or real-time discussion is needed during a task.

## When to use this skill

Use this skill when:
- You need **real-time voice communication** with the user
- A decision requires **complex explanation** that's easier to discuss verbally
- The user needs to provide **detailed context** that would be cumbersome to type
- You're **blocked** and need urgent clarification to proceed
- The question is **time-sensitive** and requires immediate attention
- Text interaction is **insufficient** for the type of input needed

## When NOT to use this skill

Do NOT use this skill for:
- Simple yes/no questions (use text)
- Questions that can wait for async response
- Minor clarifications
- Information the user has already provided
- Routine status updates

## How to use

Invoke the `call_user_for_input` tool with:

### Parameters:
- **question** (required): Clear, specific description of what you need
  - Be concise but complete
  - Provide context about why you need this information
  - Example: "I need to decide between using PostgreSQL or MongoDB for the new analytics feature. PostgreSQL would be easier to integrate with the existing stack, but MongoDB might handle the time-series data better. Which would you prefer?"

- **urgency** (optional): "normal" or "high"
  - Use "normal" for most cases
  - Use "high" only for critical, blocking decisions

### Example usage:

```typescript
// When you need architectural guidance
const response = await call_user_for_input({
  question: "I'm implementing the payment system. Should I use Stripe or PayPal? Stripe has better API docs but PayPal might be more familiar to users.",
  urgency: "normal"
});

// When you're blocked
const response = await call_user_for_input({
  question: "The database migration is failing with a foreign key constraint error. I need to know if it's safe to drop the constraint on the users table, or should I take a different approach?",
  urgency: "high"
});
```

## What happens

1. User receives a phone call
2. AI voice assistant explains what Claude Code needs
3. User responds verbally
4. AI asks clarifying questions if needed
5. Call ends when complete answer is received
6. Full transcript returns to Claude Code
7. Claude Code continues working with the user's input

## Outputs

The tool returns:
- **transcript**: Full text of the user's response
- **duration**: Call length in seconds
- **status**: "completed", "failed", or "timeout"

## Best practices

- **Be specific** in your question - the clearer you are, the better response you'll get
- **Provide context** - explain why you need the information
- **Offer options** when applicable - makes it easier for user to decide
- **Use sparingly** - phone calls are interruptive, reserve for when truly needed
- **Handle errors gracefully** - if the call fails, fall back to text interaction

## Error handling

If the call fails:
1. Check that MCP server is configured correctly
2. Verify environment variables are set
3. Fall back to asking via text
4. Log the error for debugging

## Configuration required

Before using this skill, ensure:
1. Hey Boss MCP server is installed and configured
2. Twilio account credentials are set
3. OpenAI API key is configured
4. Public URL is accessible (use ngrok for development)

See the main README.md for setup instructions.
