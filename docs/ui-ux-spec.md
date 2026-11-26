# Glint UI/UX Design Specification (Phase 1)

`antislop active: during (global preference)`

## 1. Ringkasan Konteks, Design Read, dan Reason Ledger

**Design Read:**
> Reading this as: Windows 11 desktop media workspace for PC gamers, in a Windows 11 Mica Light Glassmorphism language, dial ENERGY 2 / RHYTHM 2 / MOTION 2.

Glint adalah aplikasi desktop Windows ringan (Tauri v2 + React + TypeScript + Tailwind CSS) untuk mengelola, memutar, memotong (lossless trim), dan mengekspor klip gameplay (fokus Phase 1: NVIDIA ShadowPlay / NVIDIA App) siap tempel ke Discord (`Ctrl+V`) maupun edit lanjutan lewat folder hardlink NTFS.

### Arsitektur Light Glassmorphism yang Patuh Anti-Slop (R-10 & R-37)
Untuk memenuhi preferensi tema Light Glassmorphism sekaligus menjaga aturan dosis blur (`antislop` R-10: maksimal 1 sampai 2 elemen `backdrop-filter: blur` aktif bersamaan) dan keterbacaan tinggi di sekitar area video player:
1. **OS-Level Mica Light Shell (`window-vibrancy`):** Efek kedalaman kaca utama berasal dari API native Windows 11 Mica Light pada root window (`Titlebar` dan `Sidebar` transparan terhadap Mica backdrop), bukan menumpuk CSS `backdrop-filter: blur` di seluruh panel dan kartu.
2. **Porcelain Workspace Canvas (Zero Blur pada Grid):** Area utama galeri memakai permukaan frosted porcelain bernilai opasitas tinggi (`#F9FAFC` / `rgba(249, 250, 252, 0.94)`) tanpa CSS `backdrop-filter: blur` pada setiap kartu klip. Langkah ini menjaga performa scroll 60fps pada ratusan thumbnail dan mempertahankan akurasi warna frame gameplay.
3. **Selective CSS Glass Accents (Maksimal 1 sampai 2 Elemen Aktif):** CSS `backdrop-filter: blur(20px) saturate(150%)` hanya dipakai pada permukaan melayang (floating layers):
   - **Player Control & Trim Dock / Audio Mixer Popover** (saat mode tonton aktif, atau HUD melayang saat fullscreen).
   - **Floating Export Toast / Active Modal** (muncul secara transien saat ekspor atau dialog terbuka).
4. **Cinema Frame Isolator pada Video Player:** Area `<video>` dibingkai di dalam frame matte slate gelap (`#14171F`) berbingkai hairline halus. Kontrol utama diletakkan pada frosted dock tepat di bawah frame (tidak menumpuk di atas video saat mode jendela biasa) sehingga frame gameplay yang sangat terang (flashbang) maupun gelap total tidak pernah merusak kontras label kontrol.

### Reason Ledger (R-31)
- **Mengapa palet Frosted Porcelain + Cobalt Ink (`#1D4ED8`):** Menghindari gradien biru-ungu dan neon gelap khas aplikasi gaming generik (R-01, R-21), sekaligus memberi kontras tinggi pada layar terang siang hari dan membedakan kontrol aktif secara instan.
- **Mengapa pairing `Segoe UI Variable` + `JetBrains Mono` (khusus angka):** `Segoe UI Variable` menyatu native dengan Windows 11 Mica shell untuk label padat yang jernih, sedangkan `JetBrains Mono` dibatasi hanya untuk angka tabular (`tabular-nums`: timecode, durasi, ukuran file, keycaps shortcut) agar angka tidak bergeser saat scrubbing (R-06).
- **Mengapa layout Master Sidebar + Full-Canvas Workspace Switch:** Menggantikan template dashboard 4-stat-card atau preview panel sempit; fokus utama layar adalah menemukan klip atau menonton dengan lega (C-3).
- **Mengapa skala spacing 4px dengan kepadatan rendah:** Memberi ruang napas minimal 16px antar kartu klip dan padding 24px di kanvas utama agar thumbnail gameplay yang sudah ramai visual tetap mudah dipindai tanpa teks padat.
- **Mengapa kartu klip bebas blur dan hanya memakai 1 hairline border:** Menjaga hierarki foreground-background tetap tajam dan memastikan scroll mulus di perangkat laptop gaming maupun desktop (R-10, R-12).
- **Mengapa motion disetel ke `MOTION 2`:** Transisi 120ms sampai 220ms memberi konfirmasi mekanis yang sigap saat mengganti klip, membuka mixer audio, atau memunculkan toast clipboard tanpa animasi dekoratif mengambang (R-19).

---

## 2. Design Tokens (`src/styles/tokens.css`)

### 2.1 Palet Warna & Lapisan Material (Light Glassmorphism)

| Token CSS | Nilai Hex / RGBA | Peran & Penempatan |
|---|---|---|
| `--bg-mica-fallback` | `#EEF2F6` | Latar belakang root jika OS bukan Windows 11 atau Mica tidak aktif (`window-vibrancy` fallback). |
| `--bg-sidebar-tint` | `rgba(238, 242, 246, 0.72)` | Permukaan sidebar di atas Windows 11 Mica Light (memberi tirai terang konsisten di atas wallpaper user). |
| `--surface-canvas` | `#F9FAFC` | Kanvas utama galeri dan halaman Settings. Opak/hampir opak agar teks dan thumbnail tajam. |
| `--surface-card` | `#FFFFFF` | Permukaan kartu klip dan container form di atas kanvas (`--surface-canvas`). |
| `--surface-card-hover` | `#F1F5F9` | Latar tombol sekunder atau baris list saat hover. |
| `--surface-glass-dock` | `rgba(248, 250, 252, 0.88)` | Lapisan kaca buram untuk Player Dock, Audio Mixer Popover, Modal, dan Export Toast (`backdrop-filter: blur(20px) saturate(150%)`). |
| `--surface-glass-fullscreen` | `rgba(248, 250, 252, 0.90)` | Lapisan kaca buram HUD saat Fullscreen Player (`backdrop-filter: blur(24px) saturate(150%)`). |
| `--surface-cinema-frame` | `#14171F` | Frame matte pembungkus `<video>` agar rasio video non-16:9 atau letterbox tetap menyatu rapi. |
| `--surface-scrim-dark` | `rgba(15, 23, 42, 0.82)` | Latar badge durasi di sudut thumbnail agar teks putih terbaca di atas frame video terang. |
| `--text-primary` | `#0F172A` | Judul klip, heading halaman, label kontrol aktif, isi form. |
| `--text-secondary` | `#475569` | Metadata kartu (nama game, tanggal), deskripsi singkat, subjudul Settings. |
| `--text-muted` | `#526075` | Placeholder pencarian, label non-aktif, info kuota sekunder (lolos WCAG AA 4.5:1). |
| `--text-on-glass-video` | `#334155` | Teks sekunder di atas kaca buram yang mungkin melayang di atas video gelap. |
| `--accent-primary` | `#1D4ED8` | Aksi utama (`Fit to Discord (10 MB)`), playhead timeline, indikator item sidebar aktif, focus ring. |
| `--accent-primary-hover` | `#1E40AF` | State hover untuk tombol aksen utama. |
| `--accent-tint-bg` | `rgba(29, 78, 216, 0.10)` | Sorotan halus item navigasi aktif dan rentang seleksi trim pada timeline. |
| `--status-success-fg` | `#15803D` | Ikon dan teks toast keberhasilan clipboard / hardlink selesai. |
| `--status-success-bg` | `#ECFDF5` | Latar badge / banner status sukses. |
| `--status-warning-fg` | `#B45309` | Peringatan kuota penyimpanan penuh atau drive non-NTFS / beda partisi hardlink. |
| `--status-warning-bg` | `#FFFBEB` | Latar banner peringatan. |
| `--status-error-fg` | `#B91C1C` | Pesan gagal encode, folder tidak ditemukan, aksi hapus permanen. |
| `--status-error-bg` | `#FEF2F2` | Latar banner error. |

### 2.2 Verifikasi Kontras WCAG (Dihitung via `contrast-check.py`)

Semua pasangan teks wajib memenuhi minimal `4.5:1` (teks normal) dan batas kontrol interaktif memenuhi `3.0:1` (WCAG 1.4.11 non-text contrast). Simulasi worst-case kaca buram `rgba(248, 250, 252, 0.88)` di atas video hitam pekat (`#000000`) menghasilkan permukaan efektif `#D8DCE2`.

| Pasangan Warna (Teks / Latar) | Rasio Terukur | Target WCAG AA | Status |
|---|---|---|---|
| `#0F172A` di atas `#EEF2F6` (Teks utama di Mica fallback) | `15.87:1` | `>= 4.5:1` | PASS |
| `#475569` di atas `#EEF2F6` (Teks sekunder di Sidebar) | `6.74:1` | `>= 4.5:1` | PASS |
| `#526075` di atas `#EEF2F6` (Teks muted di Sidebar) | `5.68:1` | `>= 4.5:1` | PASS |
| `#475569` di atas `#FFFFFF` (Teks sekunder di Kartu) | `7.58:1` | `>= 4.5:1` | PASS |
| `#0F172A` di atas `#D8DCE2` (Teks utama di Glass Overlay atas frame hitam) | `12.97:1` | `>= 4.5:1` | PASS |
| `#334155` di atas `#D8DCE2` (Teks sekunder di Glass Overlay atas frame hitam) | `7.52:1` | `>= 4.5:1` | PASS |
| `#FFFFFF` di atas `#1D4ED8` (Teks tombol CTA utama) | `6.70:1` | `>= 4.5:1` | PASS |
| `#FFFFFF` di atas `#1E40AF` (Teks tombol CTA hover) | `8.72:1` | `>= 4.5:1` | PASS |
| `#1D4ED8` di atas `#EEF2F6` (Teks/ikon aksen di Sidebar) | `5.96:1` | `>= 4.5:1` | PASS |
| `#1D4ED8` di atas `#F9FAFC` (Teks/ikon aksen di Canvas) | `6.42:1` | `>= 4.5:1` | PASS |
| `#1D4ED8` di atas `#D8DCE2` (Playhead/ikon aksen di Glass Dock) | `4.87:1` | `>= 4.5:1` | PASS |
| `#FFFFFF` di atas `#0F172A` (Durasi di scrim thumbnail) | `17.85:1` | `>= 4.5:1` | PASS |
| `#15803D` di atas `#ECFDF5` (Banner/Toast Sukses) | `4.76:1` | `>= 4.5:1` | PASS |
| `#B45309` di atas `#FFFBEB` (Banner Peringatan) | `4.84:1` | `>= 4.5:1` | PASS |
| `#B91C1C` di atas `#FEF2F2` (Banner Error) | `5.91:1` | `>= 4.5:1` | PASS |
| `#64748B` di atas `#F9FAFC` (Border kontrol input/tombol) | `4.56:1` | `>= 3.0:1` (non-text) | PASS |
| `#64748B` di atas `#EEF2F6` (Border kontrol di Sidebar) | `4.23:1` | `>= 3.0:1` (non-text) | PASS |
| `#64748B` di atas `#D8DCE2` (Border kontrol di Glass Overlay) | `3.46:1` | `>= 3.0:1` (non-text) | PASS |

> **Aturan Keras Token:** Warna `#64748B` hanya dipakai untuk border/garis kontrol interaktif (non-text), dilarang untuk teks normal di atas `#EEF2F6` (`4.23:1` < `4.5:1`). Semua teks muted wajib memakai `#526075` atau lebih gelap.

### 2.3 Border, Specular Highlight, & Elevation

| Token | Nilai | Penggunaan |
|---|---|---|
| `--border-hairline` | `1px solid rgba(15, 23, 42, 0.08)` | Pemisah non-interaktif (batas sidebar, pembatas bagian, kartu statis). |
| `--border-control` | `1px solid #64748B` | Border input, select, checkbox, tombol outline agar batas komponen mencapai >= 3:1. |
| `--border-glass-specular` | `inset 0 1px 0 rgba(255, 255, 255, 0.88)` | Pantulan cahaya tepi atas khusus permukaan kaca buram (Player Dock, Popover, Modal). |
| `--border-focus-ring` | `2px solid #1D4ED8` (`outline-offset: 2px`) | Indikator fokus keyboard `:focus-visible` di seluruh kontrol. |
| `--shadow-card-hover` | `0 6px 18px rgba(15, 23, 42, 0.07)` | Hanya muncul saat hover/focus pada kartu klip. |
| `--shadow-glass-float` | `0 12px 32px rgba(15, 23, 42, 0.12), 0 2px 6px rgba(15, 23, 42, 0.06)` | Khusus popover Audio Mixer, Modal, dan Floating Toast. |

### 2.4 Tipografi, Radius, dan Spacing Scale

- **Font Stack:**
  - `--font-sans`: `'Segoe UI Variable Text', 'Segoe UI', 'Plus Jakarta Sans', system-ui, sans-serif`
  - `--font-display`: `'Segoe UI Variable Display', 'Plus Jakarta Sans', sans-serif`
  - `--font-mono`: `'JetBrains Mono', 'Cascadia Mono', ui-monospace, monospace` (khusus `tabular-nums`: durasi, timecode trim, estimasi ukuran MB/GB, badge FPS, keycap shortcut).
- **Skala Ukuran Teks:**
  - `page-title`: `20px` / `line-height: 28px` / `weight: 600` / `letter-spacing: -0.015em`
  - `section-label`: `12px` / `line-height: 16px` / `weight: 600` / `letter-spacing: 0.02em` (sentence case atau huruf kecil bersih, hindari uppercase ber-tracking lebar per R-06)
  - `card-title`: `14px` / `line-height: 20px` / `weight: 600`
  - `body`: `13px` / `line-height: 19px` / `weight: 400` (desktop utility standard; modal/onboarding paragraph `14px` / `21px`)
  - `meta-mono`: `12px` / `line-height: 16px` / `weight: 500` / `font-variant-numeric: tabular-nums`
- **Radius Scale (R-11):**
  - `--radius-xs`: `4px` (keycaps shortcut, handle trim, badge FPS/durasi di thumbnail)
  - `--radius-sm`: `8px` (tombol, input, item sidebar, dropdown menu)
  - `--radius-md`: `12px` (kartu klip, cinema video frame, toast)
  - `--radius-lg`: `16px` (modal dialog, onboarding card, floating player dock)
  - `--radius-pill`: `9999px` (dibatasi hanya untuk slider thumb dan chip tag filter aktif agar tidak seluruh UI berbentuk kapsul)
- **Spacing Scale:** Basis kelipatan `4px`: `4px`, `8px`, `12px`, `16px`, `20px`, `24px`, `32px`.

---

## 3. Information Architecture & Layout Grid

### 3.1 Struktur Shell Jendela Tauri v2 (Custom Titlebar + Mica Backdrop)

```
+----------------------------------------------------------------------------------+
| [Titlebar 36px, data-tauri-drag-region]                                          |
|  [GlintMark] Glint  |  Library > Jett Valorant      [ Search clips... Ctrl+K ] |  [Gear] [_] [□] [X]
+-------------------+--------------------------------------------------------------+
| [Sidebar 240px]   | [Main Workspace Canvas, flex-1, min-width: 0]                |
|  All Clips        |                                                              |
|  Favorites        |  (Mode 1: Library Grid + Filter Strip + Folder Action Bar)   |
|                   |    ATAU                                                      |
|  Games            |  (Mode 2: Immersive Video Player + Queue Rail + Trim Dock)   |
|   - Valorant      |                                                              |
|   - Marvel Rivals |                                                              |
|   - Desktop       |                                                              |
|                   |                                                              |
|  Collections      |                                                              |
|   - Jett Valorant |                                                              |
|   + New Collection|                                                              |
|                   |                                                              |
|  Smart Folders    |                                                              |
|   - Jett Clips    |                                                              |
|   + New Smart     |                                                              |
|                   |                                                              |
| [Storage Quota]   |                                                              |
|  ShadowPlay 42/100|                                                              |
+-------------------+--------------------------------------------------------------+
```

### 3.2 Detail Titlebar Custom Windows
- **Tinggi:** `36px` (sesuai standar tinggi caption bar Windows 11).
- **Kiri (non-drag pada tombol):** Icon geometris Glint (16x16px, bingkai jendela terbelah dua sederhana, bukan ikon AI/sparkle) + wordmark `Glint` (`13px` semibold), diikuti pemisah `/` dan konteks aktif (misal `Jett Valorant` atau tombol `<- Back to Jett Valorant` saat sedang di Video Player).
- **Tengah:** Input Quick Search (`max-width: 360px`, tinggi `26px`, radius `6px`, shortcut `Ctrl+K`). Area kosong kiri-kanan input tetap memiliki `data-tauri-drag-region` untuk menggeser jendela.
- **Kanan (non-drag):**
  - Tombol `Settings` (`36x36px`, `aria-label="Open Settings"`).
  - Window Controls native-style Windows 11 (`46x36px` per tombol: Minimize, Maximize/Restore, Close). Tombol Close memakai hover background `#C42B1C` dan ikon `#FFFFFF` agar konsisten dengan ekspektasi pengguna Windows.

### 3.3 Spesifikasi Grid & Reflow Responsif Desktop (3 State Ukuran Jendela)

| State Ukuran Jendela | Lebar Sidebar | Kolom Grid Galeri | Perilaku Player & Queue Rail |
|---|---|---|---|
| **Compact / Min Window** (`960px` s.d. `1159px` x `640px+`) | Collapsed ke Drawer Overlay (`Ctrl+B` atau tombol `Menu` di titlebar kiri) sehingga kanvas mendapat lebar penuh | 2 sampai 3 kolom (`minmax(270px, 1fr)`, gap `16px`, padding `16px`) | Queue rail disembunyikan di balik tombol `Queue`, dapat dibuka sebagai slide-over drawer. |
| **Standard Laptop** (`1280 x 800`) | `232px` (dapat di-collapse ke `0px` saat fokus atau mode tonton) | 3 kolom nyaman (`minmax(290px, 1fr)`, lebar kartu ~318px, gap `16px`, padding `24px`) | Video stage lega (~`960 x 540px` bila sidebar/queue ditutup), Queue rail opsional `260px`. |
| **Desktop Monitor** (`1920 x 1080`) | `256px` | 4 sampai 5 kolom (`minmax(300px, 1fr)`, gap `20px`, padding `24px`) | Video stage besar (`16:9` proporsional hingga `min(72dvh, 1360px)`), Queue rail `280px` dapat tampil berdampingan tanpa menyempitkan video. |

**Aturan Anti-Overflow:** Semua flex/grid child wajib menggunakan `min-width: 0`. Tinggi container utama memakai `100dvh` (bukan `100vh`) dengan scroll internal hanya pada area kanvas galeri (`overflow-y: auto; overflow-x: hidden`).

---

## 4. Spesifikasi Detail per Layar & Komponen

### 4.1 Screen A: Library & Virtual Folder (Contoh Nyata: `"Jett Valorant"`)

1. **Context Header Bar (Tinggi ~64px, padding horizontal `24px`):**
   - **Kiri:**
     - Judul Folder (`20px` semibold `#0F172A`, contoh: `Jett Valorant`) + Label Jenis Folder yang fungsional (contoh: `Collection` untuk Virtual Folder, `Auto Rule` untuk Smart Folder, atau `Game Folder` untuk auto-group; hanya 1 label netral hairline, tanpa glow atau dot berdenyut per R-09).
     - Sub-info tabular di bawah judul: `[Count] clips · [Total Size]` (contoh fixture spec: `14 clips · 1.84 GB`, diisi data asli hasil scan disk).
   - **Kanan (Aksi Folder):**
     - **Jika melihat Collection / Smart Folder / Game:**
       - **`Open as Real Folder`** (Secondary button dengan icon folder-link, border `#64748B`, tinggi `36px`): Membuat folder mirror berisi NTFS hardlink di lokasi export dan langsung membuka Windows Explorer ke folder tersebut. Memiliki loading state inline (`Linking...`) dan feedback toast.
       - **`Play All`** (Primary accent button `#1D4ED8`, tinggi `36px`): Membuka Video Player pada klip pertama dengan `Auto-Next` aktif.
       - Khusus Smart Folder: tombol ikon+teks `Edit Rules` (`36px`). Khusus Virtual Folder: tombol `+ Add Clips` dan menu `...` (`Rename`, `Delete Collection`).

2. **Filter & Sort Strip (Tinggi `44px`, di bawah Context Header):**
   - Filter cepat sejajar horizontal (dengan `flex-wrap` aman di `960px`):
     - **Tag Selector Dropdown:** Menampilkan daftar tag nyata yang dimiliki klip di folder saat ini (misal `Jett`, `Clutch`, `Ace`), multi-select checkbox.
     - **Favorites Toggle Button:** Chip toggle (`aria-pressed`), menyorot hanya klip berbintang.
     - **Duration Preset Select:** `Any duration`, `Under 30s`, `30s to 2m`, `Over 2m`.
     - **Sort Select (rata kanan):** `Newest first`, `Oldest first`, `Longest`, `Largest size`.
     - **Active Filter Clear:** Link/tombol `Clear filters` hanya muncul saat minimal 1 filter aktif.

3. **Clip Card Anatomy (`16:9` Thumbnail + Compact Footer):**
   - **Media Container:** `aspect-ratio: 16 / 9`, `background: #14171F`, `border-radius: 10px` di dalam kartu (`padding: 8px`, `border-radius: 12px`, `background: #FFFFFF`, `border: 1px solid rgba(15, 23, 42, 0.08)`).
   - **Overlay di Thumbnail (Maksimal 2 sudut agar frame gameplay tetap bersih):**
     - **Sudut Kanan Bawah:** Badge durasi monospace tabular (`00:28`) di atas `--surface-scrim-dark`.
     - **Sudut Kiri Atas (Hanya muncul jika relevan):** Indikator jumlah track audio jika > 1 track (misal `2 audio tracks` ringkas: ikon speaker + `2ch`) dan bintang `Favorite` (tombol `32x32px` hit area `40x40px`, selalu terlihat bila sudah difavoritkan; saat hover/focus muncul agar dapat diklik tanpa membuka player).
   - **Card Footer (Maksimal 2 baris teks, low text density):**
     - **Baris 1:** Judul klip (`14px` semibold `#0F172A`, `truncate` 1 baris dengan tooltip judul penuh).
     - **Baris 2:** Game / Timestamp relatif + Ukuran file (`12px` `#475569`, angka `tabular-nums`, contoh: `Valorant · Today 21:14 · 142 MB`) + Tombol aksi cepat `...` (`aria-label="Clip actions"`, membuka menu `Add to Collection`, `Edit Tags`, `Reveal Original File`, `Delete Clip`) + Indikator keanggotaan multi-folder (misal badge kecil `+2 collections` jika klip masuk >1 Virtual Folder).
   - **Multi-Membership Collection Popover (`Add to Collection`):**
     - Bisa dibuka dari menu `...` kartu, klik kanan context menu pada kartu, atau tombol di Player.
     - Menampilkan daftar seluruh Virtual Folder dengan **checkbox** sehingga 1 klip dapat dicentang masuk ke banyak Virtual Folder (misal `Jett Valorant` dan `Best Clutches`) tanpa memindahkan atau menduplikasi file `.mp4` asli, plus input cepat `Create new collection...`.

4. **Sidebar Navigasi & Storage Quota Widget:**
   - **Item Aktif:** Latar `--accent-tint-bg`, teks `#1D4ED8` semibold, dan garis aksen vertikal kiri `3px solid #1D4ED8` (membawa informasi state aktif, bukan dekorasi).
   - **Struktur Grup:**
     - Utama: `All Clips`, `Favorites`
     - `Games` (auto-grouped dari subfolder NVIDIA ShadowPlay, misal `Valorant`, `Marvel Rivals`, `Desktop`)
     - `Collections` (Virtual Folders manual, misal `Jett Valorant`, tombol `+` di header grup untuk membuat baru)
     - `Smart Folders` (Rule-based, misal `Jett Valorant Auto`, tombol `+` di header grup)
   - **Storage Quota Widget (Pinned di bawah sidebar):**
     - Menampilkan label `Watch Storage`, angka nyata (`[Used] GB / [Limit] GB` atau `[Used] GB · No limit`), dan progress bar tipis `6px`. Berubah ke status peringatan `--status-warning-fg` bila pemakaian >= 85% kuota. Klik membuka Settings bagian `Storage & Auto-Cleanup`.

---

### 4.2 Screen B: Create / Edit Smart Folder Modal

- **Wadah:** Glass modal terpusat (`max-width: 520px`, `width: calc(100vw - 32px)`, `--surface-glass-dock`, `backdrop-filter: blur(24px)`, `--border-glass-specular`, `--shadow-glass-float`, `border-radius: 16px`). Scrim belakang modal: `rgba(15, 23, 42, 0.28)`.
- **Aksesibilitas Modal:** Focus trap aktif saat terbuka, fokus awal di input `Folder name`, tombol `Esc` menutup modal, tombol close `X` memiliki `aria-label="Close modal"`.
- **Struktur Form:**
  1. **Header:** Judul `New Smart Folder` atau `Edit Smart Folder` + tombol tutup `X`.
  2. **Folder Name:** Visible `<label for="smart-folder-name">Folder name</label>` + input teks (placeholder jujur: `e.g. Valorant clutches under 30s`).
  3. **Match Logic Segmented Control:** `Match all rules (AND)` | `Match any rule (OR)`.
  4. **Rule Builder List (1 hingga 8 baris rule):**
     - Setiap baris memiliki 3 kontrol sejajar + tombol hapus baris:
       - `Field` (`select`): `Game`, `Tag`, `Favorite`, `Duration (seconds)`, `Captured date`, `Audio tracks`.
       - `Operator` (`select`, dinamis per field): contoh `is`, `is not`, `contains`, `greater than`, `less than`.
       - `Value` (input / select sesuai field): dropdown daftar game terdeteksi untuk `Game`, input tag autocomplete untuk `Tag`, numeric input detik untuk `Duration`, toggle `Yes/No` untuk `Favorite`.
     - Tombol `+ Add rule` di bawah daftar.
  5. **Footer Bar:**
     - Kiri: Live preview counter hasil evaluasi index lokal secara real-time (`Matches [N] clips`, atau `0 clips match these rules`).
     - Kanan: Tombol `Cancel` (secondary) + `Save Smart Folder` (primary `#1D4ED8`, `disabled` bila nama kosong atau rule belum valid).

---

### 4.3 Screen C: Built-in Video Player, Multi-Track Audio Mixer & Quick Trim Bar

Mode menonton dirancang lega (mengambil alih area kanvas utama atau penuh jendela) bukan panel preview kecil di sudut.

```
+----------------------------------------------------------------------------------+
| [Player Header 48px]                                                             |
|  <- Back to Jett Valorant | jett_haven_ace_14.mp4 | Clip 3 of 12 | [Auto-Next ON]| [Queue] [Collect] [Fav]
+-------------------------------------------------------------------+--------------+
| [Theater Video Stage, #14171F matte frame]                        | [Optional    |
|                                                                   |  Queue Rail  |
|                                                                   |  272px       |
|                     <video 16:9 unobstructed>                     |  collapsible]|
|                                                                   |  Clip 1      |
|                                                                   |  Clip 2      |
+-------------------------------------------------------------------+  > Clip 3    |
| [Floating Frosted Glass Control & Trim Dock, border-radius: 16px] |  Clip 4      |
|  [In 00:08.40]  [======[========|=========]======]  [Out 00:24.15]|              |
|                 Duration 00:15.75  ·  Est: ~8.4 MB (Discord 10 MB)|              |
|                                                                   |              |
|  [Play] [-5s J] [-1f ,] [+1f .] [+5s L]  00:14.20 / 00:42.10      |              |
|  [1.0x v] [Loop R] [Audio Mixer: 2 Tracks v] [Fullscreen F]       |              |
|  ---------------------------------------------------------------- |              |
|  Trim & Export:  [ Fit to Discord (10 MB) ]  [ 25 MB ]  [ Original (Lossless) ]  |
+-------------------------------------------------------------------+--------------+
```

1. **Player Header Bar (`48px`):**
   - Tombol `<- Back to [Source View]` (`Backspace` atau `Esc` saat tidak ada popover/fullscreen).
   - Judul klip (`15px` semibold) + posisi playlist (`Clip 3 of 12` dalam `tabular-nums`) saat dibuka dari folder/collection.
   - Switch **`Auto-Next`** (`role="switch"`, default `ON` saat diputar dari folder/collection). Ketika video mencapai akhir (atau batas Out trim saat tidak di-loop), tampil countdown halus 1.5 detik atau langsung berpindah ke klip berikutnya.
   - Tombol **`Queue`** (toggle collapsible playlist rail kanan `272px` untuk melompat ke klip lain di folder yang sama), **`Collect`** (membuka Multi-Collection popover), dan **`Favorite`**.

2. **Theater Video Stage & Fullscreen HUD:**
   - Dalam mode jendela normal, **nol teks/kontrol menumpuk di atas video** (kecuali indikator Play/Pause ikon sesaat 350ms di tengah saat user menekan `Space`, dan toast kecil jika baru saja berganti klip di playlist).
   - Dalam **Fullscreen Mode (`F`)**: `<video>` mengisi `100vw x 100dvh` di atas `#000000`. Saat kursor bergerak, tombol keyboard ditekan, atau video di-pause, **Floating Frosted Glass HUD (`--surface-glass-fullscreen`, `blur(24px)`)** muncul di bagian bawah layar (`max-width: 960px`, margin bawah `24px`, radius `16px`) berisi scrubber, kontrol gamer, dan tombol Exit Fullscreen. HUD otomatis sembunyi setelah 2.5 detik tidak ada interaksi selama video diputar.

3. **Trim & Scrubber Timeline Bar (Di dalam Frosted Glass Dock):**
   - **Visual Track:** Tinggi `36px` hit area (`6px` visual track + `20px` area seleksi trim). Bagian di luar rentang `[Start, End]` diredupkan (`rgba(15, 23, 42, 0.22)`), sedangkan rentang terpilih disorot aksen `--accent-primary` (`rgba(29, 78, 216, 0.22)` dengan tepi atas-bawah `#1D4ED8`).
   - **Handles:**
     - **Start Handle (`[`)** dan **End Handle (`]`)**: Lebar visual `10px`, hit box `24x36px`, dapat di-drag mouse maupun digerakkan lewat keyboard saat terfokus (`ArrowLeft`/`ArrowRight` geser 0.1s, `Shift+Arrow` geser 1 frame). Pintasan cepat di mana saja: tekan `I` untuk set Start ke posisi playhead saat ini, `O` untuk set End ke posisi playhead saat ini.
     - **Playhead Needle:** Garis vertikal `2px` `#1D4ED8` dengan kepala segitiga/lingkaran atas. Klik di mana saja pada track langsung melompatkan playhead (dan menjaga agar Start < End).
   - **Live Trim Telemetry Strip (1 baris rapi di bawah scrubber):**
     - Kiri: `In 00:08.40` (klik atau edit cepat) / `Out 00:24.15` / `Selected 00:15.75` + tombol teks `Reset trim` (muncul hanya jika In > 0 atau Out < total duration).
     - Kanan: **`Est. output: ~8.4 MB`** (`tabular-nums`). Jika preset aktif adalah Original Lossless dan estimasi > 10 MB, tampil catatan ringkas netral: `~64 MB lossless (exceeds 10 MB Discord limit)`.

4. **Transport & Gamer Controls Row:**
   - **Transport Kiri:**
     - Play / Pause (`Space` atau `K`), tombol `40x40px`
     - Skip `-5s` (`J`), `-1 frame` (`,`), `+1 frame` (`.`), Skip `+5s` (`L`) dengan tooltip menampilkan shortcut keycap
     - Timecode `00:14.20 / 00:42.10` (`JetBrains Mono`, `tabular-nums`)
   - **Controls Kanan:**
     - **Playback Speed (`select` / popover):** `0.25x`, `0.5x`, `1x`, `1.5x`, `2x`
     - **Loop Toggle (`R`):** Mengulang hanya rentang trim `[Start, End]` (bila ada) atau seluruh klip (`aria-pressed`)
     - **Audio Mixer Button:** Menampilkan `Audio Mixer · 2 tracks` (dinamis sesuai jumlah stream audio di file). Klik membuka **Live Multi-Track Audio Mixer Popover**.
     - **Fullscreen Button (`F`)**

5. **Live Multi-Track Audio Mixer Popover:**
   - Muncul menempel di atas tombol `Audio Mixer` (`width: 320px`, `--surface-glass-dock`, `backdrop-filter: blur(20px)`, `border-radius: 12px`, `--shadow-glass-float`).
   - **Daftar Track (Dinamis 1 sampai 4 stream dari FFprobe, contoh ShadowPlay 2-track):**
     - Setiap baris track memiliki:
       - Nama Track (`Track 1 · Game Audio`, `Track 2 · Mic / Discord`, atau nama stream fallback `Track [N]`)
       - Tombol **Mute (`M`)** dengan ikon jelas (`aria-pressed`, warna merah `#B91C1C` + badge `Muted` saat aktif)
       - Tombol **Solo (`S`)** untuk mendengar 1 track saja saat review audio
       - **Volume Slider** (`0%` s.d. `200%` gain) + nilai persentase `tabular-nums` (`100%`)
     - **Footer Popover:** Keterangan 1 kalimat: `"Playback levels also apply when exporting to Discord."` (sehingga user tahu jika mic di-mute di mixer, hasil ekspor ke Discord juga tidak menyertakan suara mic).
     - **Single-track state:** Jika file hanya punya 1 track audio, tampilkan 1 baris slider volume + catatan singkat: `"Single audio track in this file."`

6. **1-Klik Export Preset Strip:**
   - Terletak terintegrasi di baris paling bawah dock (atau sisi kanan dock pada layar lebar `>= 1280px`) dengan pembatas hairline halus:
   - Tiga tombol aksi langsung (1 klik langsung memproses segmen trim aktif):
     1. **`Fit to Discord (10 MB)`** (Primary CTA `#1D4ED8`, tinggi `38px`): Menghitung target bitrate video+audio dari durasi trim aktif agar hasil akhir aman di bawah `10 MB` (target `9.5 MB` margin aman), encode via NVENC (dengan fallback CPU bila perlu), lalu otomatis menulis file `.mp4` ke **Windows Clipboard** (`CF_HDROP`).
     2. **`25 MB`** (Secondary button `#FFFFFF`, border `#64748B`, tinggi `38px`): Target aman di bawah `25 MB` (target `23.8 MB` untuk Discord Nitro/server boost) + otomatis salin ke Windows Clipboard.
     3. **`Original (Lossless Trim)`** (Secondary button `#FFFFFF`, border `#64748B`, tinggi `38px`): Stream copy (`-c copy`) tanpa re-encode untuk kualitas penuh + otomatis salin ke Windows Clipboard.

---

### 4.4 Screen D: Export Progress, NVENC Feedback & Windows Clipboard Toast

Ekspor tidak mengunci antarmuka (non-blocking). Progress dan hasil tampil di pojok kanan bawah (`bottom: 24px, right: 24px`, lebar `360px`) di atas `--surface-glass-dock` (`blur(20px)`):

1. **State 1: Encoding in Progress (NVENC)**
   - Header: Nama file target (truncate) + Badge encoder (`NVENC H.264` atau `x264 CPU` jika fallback).
   - Progress Bar: Determinate bar `#1D4ED8` (`0%` hingga `100%`), label status konkret: `Encoding for Discord (10 MB) · 64%` dan estimasi waktu `~3s left` (hanya tampil jika tersedia dari progress FFmpeg, bila belum terhitung tampil `Calculating...`).
   - Aksi: Tombol `Cancel` (menghentikan proses FFmpeg dan menghapus file sementara).

2. **State 2: Export Complete + Copied to Windows Clipboard**
   - Border aksen halus atau ikon centang `--status-success-fg` (`#15803D`) di atas latar `--status-success-bg` badge kecil (bukan seluruh kartu hijau pekat).
   - Judul: **`Copied to clipboard, ready to paste in Discord`**
   - Subteks: `jett_haven_ace_14_10mb.mp4 · 9.1 MB · Press Ctrl+V in Discord`
   - Tombol aksi: `Copy Again` (menulis ulang `CF_HDROP` jika user menyalin hal lain), `Show in Folder` (membuka Explorer ke file hasil ekspor), dan tombol tutup `X`.
   - Auto-dismiss setelah `7 detik`, otomatis pause timer saat pointer hover atau fokus keyboard berada di dalam toast.

3. **State 3: Export Error / Fallback**
   - **NVENC Gagal / Busy:** `"Hardware encoder (NVENC) unavailable. Retry using CPU encoder?"` + tombol `Retry with CPU` dan `Dismiss`.
   - **Durasi Terlalu Panjang untuk 10 MB:** `"Selection (04:12) is too long for 10 MB without severe quality loss. Trim shorter or export at 25 MB."` + tombol `Export 25 MB`.

4. **State Khusus "Open as Real Folder" (NTFS Hardlink Feedback):**
   - Saat tombol `Open as Real Folder` diklik pada `Jett Valorant`:
     - Menampilkan toast ringkas: `Creating hardlink folder for Jett Valorant...`
     - Saat selesai: `Opened in Explorer · 14 clips linked (0 MB extra disk used)` + tombol `Open Folder Again`.
     - **Error Cross-Drive NTFS (Penting di Windows):** Jika folder ShadowPlay di `D:\` tetapi lokasi export hardlink di Settings diset ke `C:\` (atau drive bukan NTFS), tampilkan dialog/toast error jelas: `"Cannot create hardlinks across different drives (clips are on D:\, export path is on C:\). Choose a folder on D:\ in Settings."` + tombol `Open Settings`.

---

### 4.5 Screen E: Onboarding, Empty States, & Panel Settings

#### 4.5.1 First-Run Onboarding (Single Focused Glass Card)
- Ditampilkan hanya saat Glint belum memiliki Watch Folder tersimpan.
- Layout: Kartu tunggal terpusat (`max-width: 540px`, `--surface-glass-dock`, `border-radius: 16px`, `padding: 32px`) di atas Windows 11 Mica Light backdrop.
- **Isi Onboarding:**
  1. **Header:** `[GlintMark] Glint` + Heading `Connect your ShadowPlay folder` + 1 kalimat jelas: `Glint reads your existing clips locally without moving or copying original files.`
  2. **Deteksi Folder ShadowPlay:**
     - Otomatis memeriksa path standar Windows (`%USERPROFILE%\Videos\NVIDIA` atau konfigurasi Windows Videos).
     - **Jika ditemukan:** Menampilkan kotak verifikasi path (`D:\Videos\NVIDIA`), badge status hijau `Folder found · [N] video files detected`, dan tombol `Change Folder`.
     - **Jika tidak ditemukan:** Menampilkan pesan netral `Default NVIDIA folder not found` + tombol utama `Choose ShadowPlay Folder`.
  3. **Hardlink Export Location (Ringkas di kartu yang sama):**
     - Default otomatis ke subfolder pada drive yang sama dengan Watch Folder (misal `D:\Videos\Glint Links`) disertai 1 baris alasan: `Placed on the same NTFS drive so Premiere and CapCut folders use zero extra space.` + tombol `Change`.
  4. **Primary CTA:** `Start Browsing Clips` (`disabled` sampai minimal 1 folder valid dipilih; jika user ingin masuk dulu tanpa folder, tersedia link sekunder `Skip setup for now`).

#### 4.5.2 Empty, Loading, & Error States (R-27)
Setiap view memiliki pesan penyebab yang jelas dan satu aksi lanjutan:

| Kondisi | Judul State | Pesan & Aksi Selanjutnya |
|---|---|---|
| **Belum ada Watch Folder (Skip Onboarding)** | `No clip folders connected` | `Add your NVIDIA ShadowPlay folder to load clips.` + Tombol `Add Watch Folder` |
| **Watch Folder valid tetapi kosong** | `No clips found in this folder` | `Record a clip with ShadowPlay or check another folder.` + Tombol `Rescan Folder` & `Folder Settings` |
| **Hasil Search / Filter kosong** | `No matching clips` | `No clips match "[query]" and your active filters.` + Tombol `Clear Filters` |
| **Virtual Folder kosong (`Jett Valorant`)** | `This collection is empty` | `Add clips from your library without moving original files.` + Tombol `Browse All Clips` |
| **Smart Folder 0 hasil** | `No clips match these rules` | `Adjust the folder rules or wait until new matching clips are recorded.` + Tombol `Edit Rules` |
| **Loading Scan Awal** | `Scanning [Folder Name]...` | Grid skeleton 16:9 berukuran tetap (`aspect-video`, `aria-busy="true"`), tanpa teks palsu. |
| **Error Izin / Drive Terlepas** | `Cannot read [D:\Videos\NVIDIA]` | `The folder may be disconnected or missing read permission.` + Tombol `Retry` & `Change Path` |

#### 4.5.3 Panel Settings
Dapat dibuka dari ikon gear di titlebar (mengisi kanvas utama dengan header `<- Back to Library` dan navigasi tab kiri ringkas 4 kategori):
1. **Watch Folders:**
   - Daftar folder yang dipantau (path lengkap, label filesystem `NTFS`, jumlah klip terindeks, tombol `Rescan`, tombol `Remove` dengan konfirmasi aman).
   - Tombol `+ Add Watch Folder`.
2. **Storage & Auto-Cleanup:**
   - Toggle `Enable storage quota limit`.
   - Input & slider batas kuota (contoh rentang `20 GB` sampai `2000 GB`, atau `Custom GB`).
   - Checkbox pelindung (Default ON): `Never auto-delete Favorites or clips in Collections`.
   - Preview dampak nyata sebelum aksi: `[N] oldest unprotected clips ([X] GB) would be removed to meet limit.` (hanya jika melebihi kuota) + tombol `Run Cleanup Now` (wajib dialog konfirmasi sebelum hapus permanen / kirim ke Recycle Bin).
   - Opsi hapus: `Move to Windows Recycle Bin (Recommended)` vs `Delete permanently`.
3. **Export & Hardlinks:**
   - `Hardlink Folder Location`: Input path + tombol `Browse` + indikator validasi real-time `Same NTFS drive as clips (OK)` atau peringatan kuning jika beda drive.
   - `Default Discord Preset`: Radio `Fit to Discord (10 MB)` | `25 MB` | `Original (Lossless)`.
   - `Hardware Encoder`: Radio `NVIDIA NVENC (Fast, Recommended)` | `CPU (x264 Fallback)`.
   - `Temporary Export Retention`: Dropdown `Clear temp clipboard exports after 24h` | `7 days` | `Keep in Exports folder`.
4. **Shortcuts:**
   - Tabel referensi 2 kolom (Aksi | Pintasan Keyboard) yang sinkron dengan shortcut aktif.

---

## 5. Interaksi, Keyboard Shortcuts, dan Motion Specs

### 5.1 Peta Keyboard Shortcuts (Tanpa Bentrok)

Perhatikan pemisahan tombol `J`/`L` (skip) dan `R` (loop) agar tidak bentrok dengan tombol skip `+5s`:

| Konteks | Shortcut | Aksi |
|---|---|---|
| **Global** | `Ctrl + K` | Fokus ke Quick Search bar di Titlebar |
| **Global** | `Ctrl + B` | Collapse / Expand Sidebar navigasi |
| **Global** | `Ctrl + ,` | Buka / Tutup halaman Settings |
| **Player** | `Space` atau `K` | Play / Pause video |
| **Player** | `J` / `ArrowLeft` | Mundur `-5 detik` |
| **Player** | `L` / `ArrowRight` | Maju `+5 detik` |
| **Player** | `,` (Koma) | Geser mundur `-1 frame` (video di-pause otomatis agar presisi) |
| **Player** | `.` (Titik) | Geser maju `+1 frame` (video di-pause otomatis agar presisi) |
| **Player** | `I` | Set Start Trim handle ke posisi playhead saat ini |
| **Player** | `O` | Set End Trim handle ke posisi playhead saat ini |
| **Player** | `R` | Toggle Loop (mengulang rentang trim atau seluruh klip) |
| **Player** | `M` | Mute / Unmute master playback audio |
| **Player** | `F` | Masuk / Keluar Fullscreen mode |
| **Player** | `Shift + P` / `Shift + N` | Klip sebelumnya / berikutnya di folder aktif |
| **Modal / Overlay** | `Escape` | Tutup Modal, Audio Mixer Popover, Collection Menu, atau keluar Fullscreen (urut prioritas lapisan teratas) |

### 5.2 Aksesibilitas & Interaction Affordances (R-32 & R-39)
- **Pointer Cursor:** Seluruh elemen interaktif aktif (`button`, `a[href]`, `select`, `label[for]`, slider thumb, kartu klip yang dapat diklik) wajib memakai `cursor: pointer`; elemen `disabled` memakai `cursor: not-allowed`.
- **Native Elements:** Semua aksi memakai `<button type="button">` atau `<button type="submit">`. Kartu klip memakai tombol utama/link semantik untuk membuka player dan tombol terpisah untuk aksi sekunder (`Favorite`, `...`) agar tidak terjadi nested interactive invalid.
- **Icon-Only Buttons:** Wajib memiliki `aria-label` (contoh `aria-label="Step forward 1 frame"`), dan ikon SVG di dalamnya diberi `aria-hidden="true"`.
- **Keyboard Trim Scrubbing:** Start/End Trim handle harus berupa kontrol fokus (`role="slider"`, `aria-label="Trim start time"`, `aria-valuemin`, `aria-valuemax`, `aria-valuenow`, `aria-valuetext="00:08.40"`).

### 5.3 Motion Choreography (`MOTION 2`)

Setiap animasi memakai GPU-composited properties (`transform`, `opacity`) dan kurva decelerate Windows Fluent (`--ease-fluent: cubic-bezier(0.2, 0, 0, 1)`). Dilarang memakai kurva bounce/elastic atau animasi loop tanpa henti.

| Elemen & Trigger | Properti yang Dianimasikan | Durasi & Easing | Tujuan UX |
|---|---|---|---|
| **Clip Card Hover** | `transform: translateY(-2px)`, `box-shadow` | `140ms`, `--ease-fluent` | Mengonfirmasi target kartu sebelum klik di grid padat. |
| **View Switch (Library <-> Player)** | `opacity: 0 -> 1`, `transform: scale(0.985) -> scale(1)` | `180ms`, `--ease-fluent` | Memberi transisi fokus ke theater player tanpa memutus konteks ruang. |
| **Audio Mixer & Collection Popover** | `opacity: 0 -> 1`, `transform: translateY(6px) -> translateY(0)` | `150ms` masuk / `110ms` keluar, `--ease-fluent` | Menunjukkan asal jangkar popover dari tombol pemicunya. |
| **Smart Folder / Confirm Modal** | Backdrop `opacity`, Dialog `scale(0.97) -> 1` + `opacity` | `200ms` masuk / `140ms` keluar, `--ease-fluent` | Memfokuskan perhatian ke dialog modal. |
| **Export & Clipboard Toast** | `transform: translateX(16px) -> 0`, `opacity: 0 -> 1` | `200ms`, `--ease-fluent` | Menarik perhatian ke pojok kanan bawah tanpa menutupi player. |
| **Frame Step (`,`/`.`) & Trim Drag** | Langsung ke frame/posisi | `0ms` (Instan) | Presisi editor video tidak boleh terasa tertinggal oleh interpolasi CSS. |

**Reduced Motion (`prefers-reduced-motion: reduce`):**
Semua transisi `transform` dan `scale` dinonaktifkan (`0.01ms`) atau diganti crossfade `opacity` super singkat (`80ms`), serta countdown Auto-Next tetap berjalan jelas secara teks tanpa efek gerak.

---

## 6. UX Copy Guidelines & Copy Deck

### 6.1 Aturan Bahasa Antarmuka
- **Bahasa UI Aplikasi:** Bahasa Inggris ringkas dan langsung (1 sampai 3 kata per label tombol), selaras dengan istilah standar aplikasi Windows/gaming dan label yang diminta user (`"Open as Real Folder"`, `"Fit to Discord (10 MB)"`, `"Auto-Next"`). Catatan: nama seperti `"Jett Valorant"` di seluruh dokumen ini hanya contoh ilustrasi; saat instalasi awal daftar `Collections` dan `Smart Folders` kosong dan sepenuhnya generik untuk game atau topik apa pun yang dibuat user.
- **Larangan Mutlak:**
  - Nol em dash (karakter U+2014) dan nol pengganti double-hyphen di seluruh teks UI maupun dokumentasi (R-02).
  - Nol buzzword pemasaran AI (`Seamless`, `Revolutionary`, `Next-Gen`, `Intelligent`, `Effortless`) maupun badge dekoratif (`AI Powered`, `Beta`) (R-09, R-16).
  - Nol emoji dekoratif di judul, tombol, atau daftar sidebar (R-04).
  - Selalu sebutkan subjek/aksi nyata pada tombol (`Save Smart Folder`, `Add Watch Folder`, bukan `Submit` atau `OK`).

### 6.2 Copy Deck Komponen Kunci

| Lokasi UI | Label / Copy Final | Catatan & Tujuan |
|---|---|---|
| **Sidebar Group** | `All Clips`, `Favorites`, `Games`, `Collections`, `Smart Folders` | Konsisten dengan struktur virtual vs auto-grouped. |
| **Folder Primary Actions** | `Open as Real Folder`, `Play All`, `Add Clips`, `Edit Rules` | Menjelaskan aksi konkret tanpa jargon teknis `NTFS symlink/hardlink` di label tombol utama. |
| **Trim & Export Presets** | `Fit to Discord (10 MB)`, `25 MB`, `Original (Lossless)` | Angka batas ukuran langsung terbaca agar gamer tidak ragu memilih preset. |
| **Audio Mixer Helper** | `Playback levels also apply when exporting to Discord.` | Menjawab pertanyaan implisit user tentang efek slider mixer terhadap hasil ekspor. |
| **Clipboard Toast Success** | `Ready to paste in Discord` / `[filename] ([size]) copied to clipboard. Press Ctrl+V.` | Menjelaskan status dan langkah selanjutnya secara instan. |
| **Auto-Cleanup Warning** | `Favorites and clips inside Collections are protected.` | Memberi rasa aman sebelum user mengaktifkan kuota hapus otomatis. |
| **NTFS Cross-Drive Error** | `Hardlinks require the export folder to be on the same NTFS drive as your clips ([Drive]).` | Menjelaskan akar masalah teknis secara jelas dengan solusi langsung (`Change in Settings`). |

---

## 7. Antislop Delivery Gate Report (Tahap Spec Desain)

Seluruh pemeriksaan dilakukan terhadap spesifikasi di [ui-ux-spec.md](file:///C:/Users/bebas/OpenBot/Shared/glint/docs/ui-ux-spec.md) sebelum diserahkan ke Frontend Engineer dan Design Critic.

### Block 1: Hard Gate
- **R-02 PASS:** Zero karakter em dash (U+2014) dan zero double-hyphen sebagai pemisah kalimat di seluruh teks spesifikasi maupun copy deck UI.
- **R-03 PASS:** Tiga state ukuran jendela desktop (`960px+` compact drawer, `1280x800`, `1920x1080`) dispesifikasikan dengan `min-width: 0`, `100dvh`, dan nol overflow horizontal.
- **R-17 PASS:** Tidak ada statistik atau metrik produk karangan; contoh di UI memakai nama contoh dari brief (`Valorant`, `Marvel Rivals`, `Jett Valorant`) serta marker `[Count]`, `[Used]`, `[N]` untuk data dinamis.
- **R-18 PASS:** Tidak ada testimoni atau profil pengguna fiktif.
- **R-23 PASS:** Ikon merek dispesifikasikan secara eksplisit sebagai mark geometris jendela sederhana `[GlintMark]` dan hanya memakai aset hasil scan video asli pengguna.
- **R-24 PASS:** Setiap item navigasi sidebar (`All Clips`, `Favorites`, `Games`, `Collections`, `Smart Folders`) dan titlebar (`Settings`) memetakan ke view nyata yang dispesifikasikan lengkap.
- **R-25 PASS:** 18 pasangan warna teks dan batas kontrol diverifikasi langsung dengan `contrast-check.py`, termasuk simulasi kaca buram di atas frame video hitam (`#D8DCE2`), seluruh teks >= `4.5:1` dan non-text >= `3.0:1`.
- **R-26 PASS:** Seluruh kontrol interaktif (Play/Pause, Skip, Frame Step, Mixer Mute/Solo/Slider, Trim In/Out, Export Preset, Open as Real Folder, Smart Folder builder) memiliki perilaku dan state lengkap.
- **R-27 PASS:** 7 skenario state (First-run empty, folder kosong, filter nihil, virtual folder kosong, smart folder nihil, loading skeleton terukur, dan error izin/drive/NVENC/NTFS) didefinisikan lengkap beserta tombol aksi lanjutan.
- **R-28 PASS:** Tidak ada bagian FAQ generik.
- **R-32 PASS:** Peta shortcut keyboard lengkap tanpa konflik (`J`/`L` untuk skip, `R` untuk loop, `,`/`.` frame step, `I`/`O` trim, `Esc` bertingkat), fokus ring `2px solid #1D4ED8`, dan `role="slider"` untuk trim handle.
- **R-33 PASS:** Tahap spesifikasi murni, tidak ada skrip patching CSS/source.
- **R-34 PASS:** Aplikasi bertema tunggal Light Glassmorphism sesuai preferensi keras user, dengan frame cinema `#14171F` yang konsisten di sekitar `<video>`.
- **R-35 PASS (Mode Spec):** Deliverable berupa dokumen spesifikasi desain (belum ada kode aplikasi untuk di-build/run); seluruh komponen dan interaksi diaudit lewat inspeksi spesifikasi dan verifikasi skrip kontras `contrast-check.py`.
- **R-36 PASS:** Tidak ada klaim keamanan, kepatuhan, atau performa karangan.
- **R-37 PASS:** Arah visual mengikuti brief Light Glassmorphism + Mica Light secara eksplisit; potensi benturan dosis blur R-10 diselesaikan lewat pemisahan Windows 11 native Mica Light + porcelain matte canvas + maksimal 1 sampai 2 floating CSS blur layers.
- **R-38 PASS:** Label dinamis dan placeholder jujur (`[N]`, `[Drive]`, `e.g. Valorant clutches under 30s`) dipakai tanpa angka palsu.
- **R-39 PASS:** Aturan `cursor: pointer`, elemen native `<button>`, `aria-label` tombol ikon, `<label for>`, dan `prefers-reduced-motion` tercantum eksplisit di Section 5.
- **R-40 PASS:** Thumbnail dan video stage memakai `aspect-ratio: 16 / 9` untuk mencegah layout shift saat loading; tidak ada klaim Lighthouse/Web Vitals yang belum diukur.

### Block 2: Purpose-Gate
- **R-01 PASS:** Palet bebas gradien biru-ungu generik dan bebas glow berlebih; memakai netral frosted porcelain dengan satu aksen `#1D4ED8`.
- **R-04 PASS:** Tidak ada ikon AI generik (sparkle/magic/robot) dan tidak ada emoji dekoratif di UI; ikon hanya fungsional untuk kontrol media dan folder.
- **R-06 PASS:** `Segoe UI Variable` dipilih untuk harmoni Windows 11 native; `JetBrains Mono` dibatasi untuk timecode dan ukuran file (`tabular-nums`).
- **R-07 PASS:** Tidak ada grid titik, blueprint, atau noise dekoratif di latar belakang.
- **R-08 PASS:** Tidak ada panah dekoratif pada tombol CTA (hanya panah kembali `<- Back to...` yang berfungsi navigasi).
- **R-09 PASS:** Tidak ada capsule badge buzzword (`Beta`, `AI Powered`, `New`); badge hanya untuk status nyata (jumlah track audio, durasi, jenis folder netral).
- **R-10 PASS:** CSS `backdrop-filter: blur` dibatasi maksimal 1 sampai 2 permukaan melayang aktif (Player Control Dock / Mixer / Toast / Modal), sementara grid kartu galeri tetap padat/tajam di atas kanvas porcelain dan shell memakai Mica Light OS.
- **R-12 PASS:** Shadow dibatasi pada 2 momen saja: hover kartu klip dan floating popover/toast/modal.
- **R-13 PASS:** Nol efek glow dekoratif pada tombol, kartu, atau ikon.
- **R-14 PASS:** Kartu klip homogen karena merepresentasikan item galeri homogen yang dibandingkan seragam oleh pengguna.
- **R-19 PASS:** Motion `MOTION 2` memakai kurva Fluent decelerate terukur (`110ms` sampai `200ms`) dan `0ms` instan untuk frame-step serta scrubbing.
- **R-22 PASS:** Tidak ada ilustrasi stok (Undraw/Storyset); visual berasal dari thumbnail gameplay nyata pengguna.

### Block 3: Liveliness
- **Dials & Design Read:** `ENERGY 2 / RHYTHM 2 / MOTION 2` dinyatakan dan diterapkan konsisten.
- **Focal Point:** Galeri memusatkan perhatian pada grid thumbnail 16:9 + tombol `Open as Real Folder` / `Play All`; Player memusatkan perhatian pada Video Stage dan tombol `Fit to Discord (10 MB)`.
- **Structural Whitespace & Deliberate Accent:** Kanvas lapang `24px` padding dengan 1 aksen Cobalt (`#1D4ED8`).
- **Identity Motif:** Frosted specular top rim (`inset 0 1px 0 rgba(255,255,255,0.88)`) di atas lapisan Windows 11 Mica Light + precision playhead needle.

### Block 4: Craftsmanship & Quality Locks
- **C-1 s.d. C-5 & R-05, R-11, R-15, R-16, R-20, R-21, R-29, R-30, R-31 PASS:** Layout disusun dari alur kerja nyata gamer ShadowPlay (bukan template dashboard atau landing page), variasi radius `4/8/12/16px` sesuai hierarki komponen, CTA spesifik aksi (`Fit to Discord (10 MB)`, `Open as Real Folder`, `Save Smart Folder`), palet dibatasi ke 1 warna aksen + netral + semantik status, serta setiap keputusan utama tercatat di Reason Ledger.

**Status Delivery Gate Keseluruhan: PASS**
