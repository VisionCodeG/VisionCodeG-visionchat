# VisionChat

VisionChat is a custom messenger project built on top of the open-source Tinode messaging stack.

## What already works

- custom VisionChat web UI
- Tinode server + PostgreSQL in Docker
- registration and login
- local email verification flow
- real server-side user accounts
- user search by login/email
- real P2P chat creation
- real-time message send/receive
- contact/chat list from Tinode
- Windows one-click development launcher
- GitHub Actions build check

## Quick start on Windows

Requirements:

- Docker Desktop
- Node.js 22 recommended
- Git

Clone the repository, then run:

```bat
start-visionchat.bat
```

The launcher creates `.env` from `.env.example`, starts PostgreSQL + Tinode, installs npm dependencies on first run, then starts the web client.

Open:

```text
Web UI:  http://localhost:5173
Tinode:  http://localhost:6060
```

## Manual start

```bash
copy .env.example .env
docker compose up -d
npm install
npm run dev
```

## Test two real users

1. Open VisionChat in the normal browser window.
2. Register the first user.
3. Open an Incognito/Private window.
4. Register a second user.
5. In local development, if Tinode asks for an email confirmation code, use the configured value from `.env` (default: `123456`).
6. Press **Новый чат**, search the other user by login, open the result, and send a message.

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

## Important production notes

The current repository is a development build. Before exposing it to the internet:

- generate your own Tinode API key
- replace Tinode default UID/token encryption keys
- replace the PostgreSQL password
- remove the development email verification code
- enable HTTPS/TLS
- configure backups
- add rate limiting / abuse controls
- configure TURN/STUN for calls
- perform a security review

Do not claim end-to-end encryption yet. This starter does not implement E2EE.

## Upstream projects

- Tinode server: https://github.com/tinode/chat
- Tinode JavaScript SDK: https://github.com/tinode/tinode-js
- Tinode reference web client: https://github.com/tinode/webapp

Keep applicable upstream license and attribution requirements when redistributing modified software.

## Next stage

- file/image attachments
- voice messages
- groups
- typing/read indicators
- push notifications
- calls
- Android client
