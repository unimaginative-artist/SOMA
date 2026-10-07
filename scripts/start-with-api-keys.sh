#!/bin/bash
# start-with-api-keys.sh
# Loads API keys from config and starts the cluster node

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
CONFIG_DIR="$SCRIPT_DIR/../config"

# Load environment variables from api-keys.env
if [ -f "$CONFIG_DIR/api-keys.env" ]; then
    echo "📦 Loading API keys from config..."
    export $(grep -v '^#' "$CONFIG_DIR/api-keys.env" | grep -v '^$' | xargs)
    echo "✅ API keys loaded"
else
    echo "⚠️  No API keys file found at $CONFIG_DIR/api-keys.env"
    echo "   Please add your keys to config/api-keys.env"
fi

# Determine if coordinator or worker
if [ "$1" == "coordinator" ]; then
    echo "🧠 Starting SOMA Coordinator..."
    node "$SCRIPT_DIR/start-cluster-coordinator.cjs"
elif [ "$1" == "worker" ]; then
    echo "🤖 Starting SOMA Worker..."
    node "$SCRIPT_DIR/start-cluster-worker.cjs"
else
    echo "Usage: $0 [coordinator|worker]"
    exit 1
fi
