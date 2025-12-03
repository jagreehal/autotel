#!/bin/bash

# Build Lambda Layer for autotel-aws
# This script creates a Lambda Layer zip file with autotel-aws and all dependencies
#
# Usage:
#   ./scripts/build-layer.sh [output-dir]
#
# The layer will be created at: {output-dir}/autotel-aws-layer.zip
# Default output directory is ./dist/layer
#
# Layer structure:
#   /opt/nodejs/node_modules/
#     autotel/
#     autotel-aws/
#     @opentelemetry/
#     ...

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="${1:-$PACKAGE_DIR/dist/layer}"
LAYER_NAME="autotel-aws-layer"
TEMP_DIR=$(mktemp -d)

echo "Building Lambda Layer for autotel-aws"
echo "========================================"
echo "Output directory: $OUTPUT_DIR"
echo "Temp directory: $TEMP_DIR"
echo ""

# Clean up on exit
cleanup() {
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

# Create layer directory structure
echo "Creating layer structure..."
mkdir -p "$TEMP_DIR/nodejs/node_modules"

# Build the package first
echo "Building autotel-aws package..."
cd "$PACKAGE_DIR"
pnpm build

# Get the monorepo root
MONOREPO_ROOT="$(cd "$PACKAGE_DIR/../.." && pwd)"

# Copy autotel-aws and its built output
echo "Copying autotel-aws..."
mkdir -p "$TEMP_DIR/nodejs/node_modules/autotel-aws"
cp -r "$PACKAGE_DIR/dist" "$TEMP_DIR/nodejs/node_modules/autotel-aws/"
cp "$PACKAGE_DIR/package.json" "$TEMP_DIR/nodejs/node_modules/autotel-aws/"

# Copy autotel (dependency)
echo "Copying autotel..."
mkdir -p "$TEMP_DIR/nodejs/node_modules/autotel"
cp -r "$MONOREPO_ROOT/packages/autotel/dist" "$TEMP_DIR/nodejs/node_modules/autotel/"
cp "$MONOREPO_ROOT/packages/autotel/package.json" "$TEMP_DIR/nodejs/node_modules/autotel/"

# Install production dependencies
echo "Installing production dependencies..."
cd "$TEMP_DIR/nodejs"

# Create a minimal package.json for dependency installation
cat > package.json << 'EOF'
{
  "name": "autotel-aws-layer",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "@opentelemetry/api": "^1.9.0",
    "@opentelemetry/semantic-conventions": "^1.38.0",
    "@opentelemetry/propagator-aws-xray": "^1.3.1",
    "@opentelemetry/sdk-node": "^0.208.0",
    "@opentelemetry/sdk-trace-base": "^2.0.0",
    "@opentelemetry/sdk-trace-node": "^2.0.0",
    "@opentelemetry/exporter-trace-otlp-http": "^0.208.0",
    "@opentelemetry/resources": "^2.0.0"
  }
}
EOF

npm install --production --no-save 2>/dev/null

# Create the layer zip
echo "Creating layer zip..."
mkdir -p "$OUTPUT_DIR"
cd "$TEMP_DIR"
zip -r "$OUTPUT_DIR/$LAYER_NAME.zip" nodejs -x "*.ts" -x "*.map" -x "node_modules/.package-lock.json"

# Calculate size
LAYER_SIZE=$(du -h "$OUTPUT_DIR/$LAYER_NAME.zip" | cut -f1)
echo ""
echo "========================================"
echo "Lambda Layer built successfully!"
echo "Location: $OUTPUT_DIR/$LAYER_NAME.zip"
echo "Size: $LAYER_SIZE"
echo ""
echo "To deploy with AWS CLI:"
echo "  aws lambda publish-layer-version \\"
echo "    --layer-name autotel-aws \\"
echo "    --zip-file fileb://$OUTPUT_DIR/$LAYER_NAME.zip \\"
echo "    --compatible-runtimes nodejs18.x nodejs20.x nodejs22.x \\"
echo "    --compatible-architectures x86_64 arm64"
echo ""
echo "To use in your Lambda function:"
echo "  1. Attach the layer ARN to your function"
echo "  2. Import autotel-aws normally in your code"
echo ""
echo "Example handler:"
echo "  import { init } from 'autotel';"
echo "  import { wrapHandler } from 'autotel-aws/lambda';"
echo ""
echo "  init({ service: 'my-service' });"
echo ""
echo "  export const handler = wrapHandler(async (event) => {"
echo "    return { statusCode: 200 };"
echo "  });"
