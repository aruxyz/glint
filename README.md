# Glint

Local Windows desktop game clip manager and editor built with Tauri, Rust, React, TypeScript, and FFmpeg.

## Features

- **Auto-detect 9 recorders:** Scans NVIDIA ShadowPlay, AMD ReLive, OBS Studio, Steam Game Recording, Medal, Ascent, Outplayed, SteelSeries GG, and Xbox Game Bar folders.
- **Fast local player:** Frame-accurate scrubbing, `In`/`Out` trim handles (`I`/`O`), multi-track audio mixer, frame snapshot to clipboard, and instant `Stretch 16:9` preview.
- **Multi-layer Timeline Editor:** Trim and reorder segments, drag Premiere-style bidirectional transitions (`Fade In`, `Crossfade`, `Fade Out`, `0.10s - 3.00s`), add music layers (`MP3`, `WAV`, `AAC`, `M4A`, `FLAC`) with `0% - 200%` volume, tune vibrance/saturation, and save projects to local SQLite.
- **Hardware GPU exports:** Encodes via `NVENC`, `AMF`, or `QuickSync` with automatic `libx264` fallback, Discord `10 MB` / `25 MB` presets, and `9:16` vertical blur or crop.
- **100% private:** Zero accounts, zero telemetry, zero cloud uploads.

## Prerequisites

- **OS:** Windows 10 (1903+) or Windows 11 (64-bit) with Microsoft Edge WebView2
- **Runtime:** [Bun](https://bun.sh/) (`>= 1.2`) and [Rust](https://www.rust-lang.org/tools/install) (stable toolchain)
- **Media engine:** `ffmpeg` and `ffprobe` available on `PATH` (or configured inside Glint Settings)

## Development

```bash
bun install
bun run tauri dev
```

To run frontend type checking and production bundling only:

```bash
bun run build
```

## Production Build

```bash
bun run tauri build
```

Installers (`.exe` / `.msi`) are generated under `src-tauri/target/release/bundle/`.
