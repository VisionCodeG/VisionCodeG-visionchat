# VisionChat

VisionChat is a custom messenger built on top of the open-source Tinode messaging stack with its own web UI and an Android client.

## What already works

- custom VisionChat web UI
- Tinode server + PostgreSQL in Docker
- registration, login, local development verification
- real server-side accounts and user search
- P2P chats and real-time messaging
- group creation with member invites
- photos and generic file attachments
- browser voice-message recording and playback
- reply, edit and delete actions
- typing notifications
- sent/delivered/read indicators
- WebRTC audio and video calls for P2P chats
- incoming call accept/reject UI
- microphone/camera controls during calls
- first Android client with camera, microphone and file-picker support
- Windows one-click development launcher
- GitHub Actions checks for web, backend and Android
- downloadable CI artifacts for the web build and debug APK

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

## Test two real users

1. Open VisionChat in the normal browser window.
2. Register the first user.
3. Open an Incognito/Private window.
4. Register a second user.
5. In local development, if Tinode asks for an email confirmation code, use the configured development code.
6. Create a chat and test text, photo/file, voice, reply/edit/delete and typing/read status.
7. Use the phone/video buttons in a P2P chat to test WebRTC calls.

## Android

Open the `android/` directory in Android Studio. See `android/README.md`.

The first Android version is a native Android shell around the VisionChat web client. It is useful for testing the full current feature set on a phone immediately. A fully native Tinode/Tindroid-derived VisionChat client is a later step.

GitHub Actions also builds a debug APK and publishes it as the `VisionChat-Android-debug` workflow artifact.

## Architecture

```text
VisionChat Web / Android shell
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
- replace development database credentials
- remove the development verification shortcut
- enable HTTPS/WSS
- configure backups
- add rate limiting and abuse controls
- deploy STUN/TURN for reliable calls across the internet
- configure push notifications
- perform a security review

Do not claim end-to-end encryption yet. VisionChat does not currently implement E2EE.

## Upstream projects

- Tinode server: https://github.com/tinode/chat
- Tinode JavaScript SDK: https://github.com/tinode/tinode-js
- Tinode reference web client: https://github.com/tinode/webapp
- Tinode Android client (Tindroid): https://github.com/tinode/tindroid

Keep applicable upstream license and attribution requirements when redistributing modified software.
