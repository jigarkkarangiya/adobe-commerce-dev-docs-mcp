#!/bin/bash
#
# One-liner setup for Adobe Commerce Developer Docs MCP in Cursor
# Run: bash setup-cursor.sh
#

MCP_FILE="$HOME/.cursor/mcp.json"
SERVER_NAME="adobe-commerce-dev-docs"
PKG_NAME="adobe-commerce-dev-docs-mcp"

echo "Setting up Adobe Commerce Developer Docs MCP for Cursor..."
echo ""

if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js is not installed."
    echo "Install it from https://nodejs.org/ (v18 or later) and try again."
    exit 1
fi

NODE_MAJOR=$(node -v | cut -d. -f1 | tr -d 'v')
if [ "$NODE_MAJOR" -lt 18 ]; then
    echo "ERROR: Node.js 18+ is required. You have $(node -v)."
    echo "Update from https://nodejs.org/"
    exit 1
fi

echo "  Node.js $(node -v) ... OK"

echo "  Checking npm registry ..."
if npm view "$PKG_NAME" version &> /dev/null; then
    PKG_VERSION=$(npm view "$PKG_NAME" version 2>/dev/null)
    echo "  Package v$PKG_VERSION found on npm ... OK"
else
    echo "  (Package not yet on npm — will use local build if available)"
fi

mkdir -p "$(dirname "$MCP_FILE")"

if [ -f "$MCP_FILE" ]; then
    if grep -q "$SERVER_NAME" "$MCP_FILE" 2>/dev/null; then
        echo "  $SERVER_NAME is already in $MCP_FILE ... SKIP"
        echo ""
        echo "Done! Restart Cursor to activate."
        exit 0
    fi

    echo "  Existing $MCP_FILE found — adding server ..."

    node -e "
const fs = require('fs');
const path = '$MCP_FILE';
let config;
try { config = JSON.parse(fs.readFileSync(path, 'utf8')); } catch { config = {}; }
if (!config.mcpServers) config.mcpServers = {};
config.mcpServers['$SERVER_NAME'] = {
  command: 'npx',
  args: ['-y', '$PKG_NAME']
};
fs.writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
console.log('  Server added successfully.');
"
else
    echo "  Creating $MCP_FILE ..."
    cat > "$MCP_FILE" << MCPJSON
{
  "mcpServers": {
    "$SERVER_NAME": {
      "command": "npx",
      "args": ["-y", "$PKG_NAME"]
    }
  }
}
MCPJSON
    echo "  Config file created."
fi

echo ""
echo "====================================="
echo "  Setup complete!"
echo "====================================="
echo ""
echo "Next steps:"
echo "  1. Restart Cursor"
echo "  2. Open a chat (Agent mode)"
echo "  3. Try any of these:"
echo ""
echo "     \"Search Adobe Commerce dev docs for dependency injection\""
echo "     \"Show me the GraphQL product query schema\""
echo "     \"How do I create a webhook in Adobe Commerce?\""
echo "     \"Get code examples for plugin observers\""
echo ""
echo "Indexes: developer.adobe.com/commerce (~2,374 dev pages, 11 sections)"
echo ""
