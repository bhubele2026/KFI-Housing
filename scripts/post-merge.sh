#!/bin/bash
set -e
chmod +x node_modules/.bin/* 2>/dev/null || true
pnpm install --frozen-lockfile
chmod +x node_modules/.bin/* 2>/dev/null || true
pnpm --filter db push
