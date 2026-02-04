#!/bin/bash
# TRON Grid UI - Setup Script
# Copies assets to workspace and installs dependencies

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
ASSETS_DIR="$SKILL_DIR/assets"

# Determine target directory
TARGET_DIR="${TRON_UI_DIR:-$HOME/clawd/tron-ui}"

echo "⚡ TRON Grid UI Setup"
echo "   Source: $ASSETS_DIR"
echo "   Target: $TARGET_DIR"
echo ""

# Create target directory
mkdir -p "$TARGET_DIR"

# Copy assets
cp "$ASSETS_DIR/index.html" "$TARGET_DIR/"
cp "$ASSETS_DIR/server.js" "$TARGET_DIR/"
cp "$ASSETS_DIR/package.json" "$TARGET_DIR/"

# Create start script
cat > "$TARGET_DIR/start.sh" << 'EOF'
#!/bin/bash
cd "$(dirname "$0")"
node server.js
EOF
chmod +x "$TARGET_DIR/start.sh"

# Install dependencies
cd "$TARGET_DIR"
npm install --production

echo ""
echo "✅ TRON Grid UI installed at $TARGET_DIR"
echo ""
echo "To start:"
echo "   cd $TARGET_DIR && node server.js"
echo "   Open http://localhost:3100"
