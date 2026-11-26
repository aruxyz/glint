# Glint Roadmap

Dokumen ini mencatat status fitur yang sudah selesai di v0.1 dan rencana pengembangan jangka menengah sampai jangka panjang untuk Glint.

## Selesai (v0.1.0)

- **Core Library & Streamer:** Tauri v2 + Rust, SQLite + FTS5 full-text search, Local HTTP Byte-Range video streamer, NTFS Hardlink untuk Collection tanpa duplikasi file.
- **Triage & Gallery UX:** Light Glassmorphism UI, hover scrubbing preview di kartu galeri, Set Frame as Cover, Snapshot PNG otomatis copy ke Windows Clipboard (`CF_DIB`), shortcut keyboard cepat (`Space` force play/pause, `C`, `Shift+F`, `S`, `Delete`), dan menu klik kanan khusus pada Video Stage & TrimBar.
- **Export & Content Tools:** Discord 10 MB / 25 MB, Lossless Trim (`-c copy`), Stretch 16:9, 1-klik Vertical 9:16 (`Blur Background` & `Center Crop`), Audio Normalize (`loudnorm`), dan Merge Clips Montage (`1920x1080` 60fps).
- **Universal Recorders & Multi-Vendor GPU:** Auto-detect 9 recorder (`Scan Recorders`: NVIDIA ShadowPlay, AMD Radeon ReLive, OBS Studio, Steam Game Recording DASH `.m4s`, Medal.tv, Ascent.gg, Outplayed, SteelSeries Moments, Xbox Game Bar) serta hardware encoding multi-vendor (`NVIDIA NVENC`, `AMD AMF`, `Intel QuickSync`, fallback `CPU x264`).
- **Zero-Stutter Game Mode & Low-RAM Tray:** Deteksi game fullscreen (`SHQueryUserNotificationState`), antrean indexing tertunda saat in-game (`BELOW_NORMAL_PRIORITY_CLASS`), dan opsi `Minimize to System Tray on close` yang mematikan WebView2 (~10 MB RAM, 0% GPU).

---

## Jangka Menengah (v0.2+)

- **Verifikasi Hardware & Recorder Nyata:** Pengujian langsung encoding `h264_amf` (GPU AMD), `h264_qsv` (GPU Intel), serta verifikasi path & metadata asli dari AMD ReLive, Steam Game Recording, Medal.tv, Ascent.gg, Outplayed, dan SteelSeries Moments.
- **Auto-Update & Code Signing:** Mekanisme update otomatis aplikasi serta pertimbangan Windows Code Signing untuk menghilangkan peringatan SmartScreen "Unknown publisher".
- **Peningkatan Player & Timeline:** Waveform audio pada TrimBar, bookmark/marker momen di dalam klip panjang, dan batch export.

---

## Jangka Panjang (v1.0+ / Future): Built-in Zero-Copy Instant Replay Engine

Rencana menjadikan Glint mampu merekam Instant Replay secara mandiri (seperti Medal.tv / Ascent.gg) tanpa bergantung pada recorder pihak ketiga, dengan syarat ketat: **aman dari kernel-level anti-cheat (Vanguard, FACEIT AC, EAC, BattlEye)** dan **dampak FPS minimal (~1 sampai 3%)**.

### Prinsip Arsitektur Wajib
1. **Tanpa Game Hook / DLL Injection:** Dilarang menyuntikkan DLL ke DirectX/Vulkan atau membaca memori proses game (`OpenProcess` / `ReadProcessMemory`). Berjalan 100% di user-mode dengan API resmi Windows.
2. **100% Zero-Copy di GPU VRAM (Tanpa Pipe CPU ke FFmpeg):**
   - **Capture:** `DXGI Desktop Duplication (DDA)` atau `Windows Graphics Capture (WGC)` dengan `IsBorderRequired = false` (Windows 11), menghasilkan `ID3D11Texture2D` langsung di VRAM.
   - **Color Conversion di GPU:** `D3D11 Video Processor` mengonversi `BGRA -> NV12` langsung di VRAM (0% beban CPU).
   - **Hardware Encoder Native:** Windows Media Foundation Hardware MFT (`IMFDXGIDeviceManager`) agar satu kode Rust otomatis memakai **NVIDIA NVENC**, **AMD AMF**, dan **Intel QSV** langsung dari tekstur VRAM.
   - **RAM Ring Buffer (Awet SSD):** Hanya bitstream terkompresi H.264/HEVC (~2 MB/detik) yang masuk ke RAM ring buffer (misalnya 30 detik, 60 detik, atau 120 detik) dan baru ditulis menjadi `.mp4` saat hotkey simpan klip ditekan.
3. **Audio Multi-Track Native:**
   - **WASAPI Process Loopback** (Windows 10/11) untuk menangkap audio khusus proses game saja tanpa suara Discord/Spotify bocor.
   - Track **Microphone** terpisah (terintegrasi langsung dengan multi-track audio switcher Glint).
4. **Hotkey & Auto-Detect Game yang Aman:**
   - Hotkey simpan klip menggunakan API resmi Windows `RegisterHotKey` (bukan `SetWindowsHookEx`).
   - Deteksi pasif window game aktif (`GetForegroundWindow`) untuk menyalakan replay buffer hanya saat bermain, dikombinasikan dengan Low-RAM Tray (WebView2 nonaktif saat in-game).

### Risiko & Tantangan Teknis yang Harus Diselesaikan Saat Implementasi
- Sinkronisasi timestamp (PTS) antara frame video DXGI/WGC dan stream audio WASAPI (Game + Mic) agar tidak drift/desync.
- Penanganan *HDR tone-mapping* saat monitor Windows HDR aktif.
- Penanganan *D3D11 device reset* saat Alt-Tab atau perpindahan resolusi stretched (misalnya 4:3 ke 16:9).
- Edukasi mode tampilan: mendukung Borderless Fullscreen (default game modern), dengan fallback aman bila game berjalan di Exclusive Fullscreen lama.
