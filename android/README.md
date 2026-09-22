# VisionChat Android

This is the first Android client for VisionChat.

It is intentionally a lightweight native Android shell around the VisionChat web client so the same server, chats, files, voice messages, groups and WebRTC calls can be tested on Android immediately.

## Current capabilities

- VisionChat login and registration
- real Tinode chats
- images and files
- voice messages
- groups
- reply/edit/delete
- read and typing indicators
- microphone and camera permissions
- audio/video calls
- Android file picker

## Open in Android Studio

Open the `android/` folder as an Android project.

The project uses:

- Android Gradle Plugin 9.2.1
- Java 17
- compileSdk/targetSdk 36
- minSdk 27

## Emulator development

The default app URL is configured in `app/build.gradle`:

```text
http://10.0.2.2:5173/?tinode=10.0.2.2:6060&secure=false
```

`10.0.2.2` is the Android Emulator alias for the host computer.

Before opening the Android app, start VisionChat on Windows:

```text
start-visionchat.bat
```

Then run the Android app from Android Studio.

## Physical Android phone

Replace `10.0.2.2` in `app/build.gradle` with the LAN IP of the PC/server, for example:

```text
http://192.168.1.50:5173/?tinode=192.168.1.50:6060&secure=false
```

The phone and PC must be able to reach each other on the network and the firewall must allow the development ports.

For production, do not ship clear-text HTTP. Deploy VisionChat behind HTTPS/WSS and change the URL to the production domain.

## Next Android stage

The current shell is useful for testing the full VisionChat feature set quickly. The next stage is a fully native branded client based on the Apache-2.0 Tinode Android client (Tindroid), with VisionChat package IDs, icons, colors, server defaults and Firebase configuration replaced.
