# VisionChat

VisionChat is a custom messenger project built on top of the open-source Tinode messaging stack.

## Phase 1

This repository starts with:

- custom VisionChat web client
- Tinode server
- PostgreSQL
- Docker Compose
- Russian-first UI
- login / registration shell
- chat list and messaging foundation
- configuration through environment variables

## Quick start

1. Install Docker Desktop and Node.js 20+
2. Copy `.env.example` to `.env`
3. Start backend:
   ```bash
   docker compose up -d
   ```
4. Install frontend:
   ```bash
   npm install
   npm run dev
   ```
5. Open http://localhost:5173

Tinode backend will be available at http://localhost:6060.

## Architecture

```text
VisionChat Web (React + Vite)
        |
   tinode-sdk
        |
Tinode Server (Go)
        |
   PostgreSQL
```

## Upstream

Backend protocol/server foundation: https://github.com/tinode/chat
JavaScript SDK: https://github.com/tinode/tinode-js
Web client reference: https://github.com/tinode/webapp

Tinode server is GPL-3.0 licensed. Tinode web client and SDK components have their own upstream licenses. Keep upstream notices and review license obligations before distributing a modified production build.

## Status

Early development. Do not use this build for production-sensitive conversations yet. End-to-end encryption is not implemented in this starter.
