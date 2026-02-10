# Parkour Analyzer

Desktop app that monitors your Minecraft logs and visualizes Parkour Duels checkpoint times in real-time.

## Features
- **Live monitoring** — watches `latest.log` automatically, updates as you play
- **Multi-game support** — detects all parkour games in a session
- **Player comparison** — select any 2+ players to compare
- **3 chart views** — Progress, Gap (2 players), Segments
- **Paste mode** — also works with manually pasted logs
- **Cross-platform** — Windows, macOS, Linux

## Log file locations (auto-detected)
- **Windows:** `%APPDATA%\.minecraft\logs\latest.log`
- **macOS:** `~/Library/Application Support/minecraft/logs/latest.log`
- **Linux:** `~/.minecraft/logs/latest.log`
- Also checks Lunar Client paths

## Prerequisites
- [Node.js 20+](https://nodejs.org/)
- [Rust](https://rustup.rs/)
- System dependencies for Tauri:
  - **Linux:** `sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`
  - **macOS:** Xcode Command Line Tools (`xcode-select --install`)
  - **Windows:** [Microsoft Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/), WebView2 (included in Windows 11)

## Build

```bash
# Install frontend dependencies
npm install

# Run in dev mode (hot reload)
npm run tauri dev

# Build release binary
npm run tauri build
```

The built binary will be in `src-tauri/target/release/`.
Installer packages (`.deb`, `.msi`, `.dmg`) will be in `src-tauri/target/release/bundle/`.
