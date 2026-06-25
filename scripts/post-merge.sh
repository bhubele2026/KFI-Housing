#!/bin/bash
set -e
chmod +x node_modules/.bin/* 2>/dev/null || true
pnpm install --frozen-lockfile
chmod +x node_modules/.bin/* 2>/dev/null || true
pnpm --filter db push
# Fail fast if the committed generated API code drifted from openapi.yaml
# (the class of bug that broke past deploys with "No matching export").
pnpm run verify:codegen
