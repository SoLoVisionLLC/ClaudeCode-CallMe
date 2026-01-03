#!/bin/bash

set -e

echo "🎯 Hey Boss - Phone Call Input Plugin for Claude Code"
echo "===================================================="
echo ""

# Check for Bun
if ! command -v bun &> /dev/null; then
    echo "❌ Bun is not installed."
    echo "📦 Installing Bun..."
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
fi

echo "✅ Bun found: $(bun --version)"
echo ""

# Build MCP server
echo "🔨 Building MCP server..."
cd mcp-server
bun install
bun run build
cd ..

echo "✅ MCP server built successfully"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    echo "⚠️  Please edit .env and add your credentials:"
    echo "   - Twilio Account SID, Auth Token, and Phone Number"
    echo "   - Your phone number"
    echo "   - OpenAI API Key"
    echo "   - Public URL (use ngrok for development)"
    echo ""
fi

# Get the absolute path
PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "📍 Plugin directory: $PLUGIN_DIR"
echo ""
echo "🎉 Installation complete!"
echo ""
echo "Next steps:"
echo "1. Edit .env with your credentials:"
echo "   nano $PLUGIN_DIR/.env"
echo ""
echo "2. Add the MCP server to Claude Code:"
echo "   Add this to your Claude Code MCP settings:"
echo ""
echo "   {"
echo "     \"mcpServers\": {"
echo "       \"hey-boss\": {"
echo "         \"command\": \"node\","
echo "         \"args\": [\"$PLUGIN_DIR/mcp-server/dist/index.js\"],"
echo "         \"env\": {"
echo "           \"TWILIO_ACCOUNT_SID\": \"your-sid\","
echo "           \"TWILIO_AUTH_TOKEN\": \"your-token\","
echo "           \"TWILIO_PHONE_NUMBER\": \"+1234567890\","
echo "           \"USER_PHONE_NUMBER\": \"+1234567890\","
echo "           \"OPENAI_API_KEY\": \"sk-...\","
echo "           \"PUBLIC_URL\": \"https://your-ngrok-url.ngrok.io\","
echo "           \"PORT\": \"3000\""
echo "         }"
echo "       }"
echo "     }"
echo "   }"
echo ""
echo "3. For development, start ngrok:"
echo "   ngrok http 3000"
echo ""
echo "📖 See README.md for detailed instructions"
