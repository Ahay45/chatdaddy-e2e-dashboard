#!/bin/bash
# Auto-run script for launchd scheduler
cd "$(dirname "$0")/.."
/usr/local/bin/node e2e/runner.mjs --headless >> /tmp/chatdaddy-e2e.log 2>&1
