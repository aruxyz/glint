use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;
use std::sync::{Arc, Mutex};

use glint_lib::db::{ClipHardlinkSource, Db};
use glint_lib::discovery::index_single_file;
use glint_lib::exporter::{
    calculate_discord_bitrate, execute_editor_export_pipeline, execute_export_pipeline,
    execute_merge_pipeline, save_trimmed_clip_to_library, ActiveJobControl, EditorFraming,
    EditorPresetMode, EditorTransitionMode, EditorTransitionOutMode, EditorVerticalMode,
    MergeClipInput,
    PreparedEditorSegment,
};
use glint_lib::media::{
    capture_frame_snapshot_core, detect_ffmpeg_capabilities, probe_clip, set_clip_thumbnail_core,
};
use glint_lib::models::{
    AspectMode, CollectionKind, ExportPreset, ListClipsQuery, SaveTrimmedClipRequest, SourceType,
    StartExportRequest, WaveformResponse,
};
use glint_lib::paths::AppPaths;
use glint_lib::streamer::{build_router, StreamerState};
use glint_lib::win::clipboard::extract_dib_from_bmp;
use glint_lib::win::hardlink::export_collection_hardlinks;
use glint_lib::win::registry::detect_nvidia_folder;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::Semaphore;
use uuid::Uuid;

struct TempDirGuard(PathBuf);

impl TempDirGuard {
    fn new(prefix: &str) -> Self {
        let dir = std::env::temp_dir().join(format!("{prefix}_{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("create unique temp dir");
        Self(dir)
    }

    fn path(&self) -> &PathBuf {
        &self.0
    }
}

impl Drop for TempDirGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

async fn http_get(addr: std::net::SocketAddr, path: &str, range: Option<&str>) -> (u16, String, Vec<u8>) {
    let mut stream = tokio::net::TcpStream::connect(addr).await.expect("tcp connect");
    let mut req = format!("GET {path} HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n");
    if let Some(r) = range {
        req.push_str(&format!("Range: {r}\r\n"));
    }
    req.push_str("\r\n");
    stream.write_all(req.as_bytes()).await.expect("write");

    let mut raw = Vec::new();
    stream.read_to_end(&mut raw).await.expect("read");
    let split = raw
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .expect("http header separator");
    let header_str = String::from_utf8_lossy(&raw[..split]).to_string();
    let status_line = header_str.lines().next().unwrap_or("");
    let status: u16 = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let body = raw[split + 4..].to_vec();
    (status, header_str, body)
}

#[tokio::test]
async fn qa_end_to_end_media_streamer_hardlink_and_nvenc_export() {
    let temp_guard = TempDirGuard::new("glint_qa_it");
    let root = temp_guard.path();

    let watch_dir = root.join("watch");
    let game_dir = watch_dir.join("SyntheticGame");
    std::fs::create_dir_all(&game_dir).expect("create watch/SyntheticGame");

    let mp4_path = game_dir.join("SyntheticGame 2026.11.25 - 23.00.00.01.mp4");
    let gen_status = Command::new("ffmpeg")
        .args([
            "-y",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc=duration=3:size=1920x1080:rate=60",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=3:sample_rate=48000",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=880:duration=3:sample_rate=48000",
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-map",
            "2:a:0",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-metadata:s:a:0",
            "title=System sounds",
            "-metadata:s:a:1",
            "title=Microphone",
            &mp4_path.to_string_lossy(),
        ])
        .status()
        .expect("run ffmpeg lavfi generator");
    assert!(gen_status.success(), "synthetic MP4 generation failed");
    assert!(mp4_path.exists(), "synthetic mp4 missing at {}", mp4_path.display());

    // 1. Capabilities & read-only registry detection
    let caps = detect_ffmpeg_capabilities();
    let hw_encoders = caps.hardware_encoders();
    println!(
        "CAPABILITIES: available={}, nvenc={}, amf={}, qsv={}, encoders={:?}",
        caps.available, caps.has_nvenc, caps.has_amf, caps.has_qsv, hw_encoders
    );
    assert!(caps.available, "ffmpeg must be available");
    assert!(caps.has_nvenc, "RTX 3070 h264_nvenc must be detected");

    let nv_detect = detect_nvidia_folder();
    println!(
        "DETECT_NVIDIA: found={}, source={:?}, path={:?}",
        nv_detect.found, nv_detect.source, nv_detect.path
    );

    // 2. ffprobe metadata & multi-track detection
    let probe = probe_clip(&mp4_path).await.expect("probe_clip");
    println!(
        "PROBE: dur={:.3}s, {}x{}, fps={:.2}, codec={}, audio_tracks={}",
        probe.duration_sec,
        probe.width,
        probe.height,
        probe.fps,
        probe.video_codec,
        probe.audio_tracks.len()
    );
    assert_eq!(probe.width, 1920);
    assert_eq!(probe.height, 1080);
    assert!((probe.duration_sec - 3.0).abs() < 0.25);
    assert_eq!(probe.audio_tracks.len(), 2);
    assert_eq!(probe.audio_tracks[0].label, "System sounds");
    assert_eq!(probe.audio_tracks[1].label, "Microphone");

    // 3. DB indexing + thumbnail + FTS5 search
    let app_base = root.join("appdata");
    let export_dir = root.join("exports");
    let paths = AppPaths::from_base_and_export(app_base, export_dir.clone()).expect("AppPaths");
    let db = Db::open(&paths.db_path).expect("Db::open");
    let wf = db
        .add_watch_folder(&watch_dir.to_string_lossy(), SourceType::Nvidia)
        .expect("add_watch_folder");
    let thumb_sem = Arc::new(Semaphore::new(2));

    let indexed = index_single_file(&db, &paths, &thumb_sem, &wf, &mp4_path)
        .await
        .expect("index_single_file")
        .expect("clip indexed");
    let clip_id = indexed.0;
    assert!(indexed.1, "expected is_new = true");

    let list_res = db
        .list_clips(&ListClipsQuery::default(), "http://127.0.0.1:0", "tok")
        .expect("list_clips");
    assert_eq!(list_res.total, 1);
    assert_eq!(list_res.items[0].game_name, "SyntheticGame");
    assert_eq!(list_res.items[0].audio_track_count, 2);

    let fts_res = db
        .list_clips(
            &ListClipsQuery {
                search: Some("SyntheticGame".to_string()),
                ..Default::default()
            },
            "http://127.0.0.1:0",
            "tok",
        )
        .expect("fts search");
    assert_eq!(fts_res.total, 1);

    let thumb_file = paths.thumb_path(&clip_id);
    assert!(thumb_file.exists(), "thumb file should exist after indexing");

    // 4. Local HTTP Streamer (video Range 206, audio extraction x2 + Range 206, thumb, waveform)
    let token = "b".repeat(64);
    let streamer_state = StreamerState {
        db: db.clone(),
        paths: paths.clone(),
        token: token.clone(),
        thumb_sem: thumb_sem.clone(),
        audio_locks: Arc::new(Mutex::new(HashMap::new())),
    };
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind streamer");
    let addr = listener.local_addr().expect("local_addr");
    let router = build_router(streamer_state);
    let server = tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });

    let orig_bytes = std::fs::read(&mp4_path).expect("read original mp4");
    let (st_unauth, _, _) = http_get(addr, &format!("/video/{clip_id}"), None).await;
    assert_eq!(st_unauth, 401);

    let (st_206, hdr_206, body_206) = http_get(
        addr,
        &format!("/video/{clip_id}?token={token}"),
        Some("bytes=0-1023"),
    )
    .await;
    println!("STREAMER_VIDEO_206: status={st_206}, body_len={}", body_206.len());
    assert_eq!(st_206, 206);
    assert_eq!(body_206.len(), 1024);
    assert_eq!(&body_206[..], &orig_bytes[..1024]);
    assert!(hdr_206.to_ascii_lowercase().contains("accept-ranges: bytes"));
    assert!(hdr_206
        .to_ascii_lowercase()
        .contains(&format!("content-range: bytes 0-1023/{}", orig_bytes.len())));

    let (st_416, _, _) = http_get(
        addr,
        &format!("/video/{clip_id}?token={token}"),
        Some("bytes=999999999-"),
    )
    .await;
    assert_eq!(st_416, 416);

    let (st_thumb, hdr_thumb, body_thumb) =
        http_get(addr, &format!("/thumb/{clip_id}?token={token}"), None).await;
    println!("STREAMER_THUMB: status={st_thumb}, bytes={}", body_thumb.len());
    assert_eq!(st_thumb, 200);
    assert!(hdr_thumb.to_ascii_lowercase().contains("image/jpeg"));
    assert!(body_thumb.len() > 1000);
    assert_eq!(&body_thumb[0..3], &[0xFF, 0xD8, 0xFF]);

    for track_order in [0, 1] {
        let (st_aud, _, body_aud) = http_get(
            addr,
            &format!("/audio/{clip_id}/{track_order}?token={token}"),
            Some("bytes=0-511"),
        )
        .await;
        println!(
            "STREAMER_AUDIO_TRACK_{track_order}: status={st_aud}, body_len={}",
            body_aud.len()
        );
        assert_eq!(st_aud, 206);
        assert_eq!(body_aud.len(), 512);
        let cache_m4a = paths.audio_cache_path(&clip_id, track_order);
        assert!(cache_m4a.exists(), "audio cache missing for track {track_order}");

        let (st_wf, _, body_wf) = http_get(
            addr,
            &format!("/waveform/{clip_id}/{track_order}?token={token}"),
            None,
        )
        .await;
        assert_eq!(st_wf, 200);
        let wf_json: WaveformResponse = serde_json::from_slice(&body_wf).expect("waveform json");
        let max_peak = wf_json.peaks.iter().copied().fold(0.0f32, f32::max);
        println!(
            "STREAMER_WAVEFORM_TRACK_{track_order}: bins={}, max_peak={max_peak:.3}",
            wf_json.peaks.len()
        );
        assert_eq!(wf_json.peaks.len(), 160);
        assert!(max_peak > 0.05, "sine wave should produce non-zero waveform peaks");
    }

    server.abort();

    // 5. NTFS Hardlink creation on same drive (0 extra bytes)
    let col = db
        .create_collection("QA Hardlink Test", CollectionKind::Manual, None, None, None)
        .expect("create_collection");
    db.modify_collection_clips(&col.id, Some(vec![clip_id.clone()]), None)
        .expect("modify_collection_clips");

    let link_target = root.join("linked_out_qa_unique");
    let hardlink_res = export_collection_hardlinks(
        &col.name,
        &[ClipHardlinkSource {
            id: clip_id.clone(),
            file_path: mp4_path.to_string_lossy().to_string(),
            file_name: "SyntheticGame 2026.11.25 - 23.00.00.01.mp4".to_string(),
        }],
        Some(&link_target.to_string_lossy()),
        &paths.default_hardlink_dir,
    )
    .expect("export_collection_hardlinks");
    println!(
        "HARDLINK_SAME_DRIVE: linked={}, skipped={}, cross_drive={}",
        hardlink_res.linked_count, hardlink_res.skipped_count, hardlink_res.cross_drive_clips
    );
    assert_eq!(hardlink_res.linked_count, 1);
    assert_eq!(hardlink_res.skipped_count, 0);
    assert_eq!(hardlink_res.cross_drive_clips, 0);

    let linked_file = link_target.join("SyntheticGame 2026.11.25 - 23.00.00.01.mp4");
    assert!(linked_file.exists());
    let fsutil_out = Command::new("fsutil")
        .args(["hardlink", "list", &linked_file.to_string_lossy()])
        .output()
        .expect("fsutil hardlink list");
    let fsutil_str = String::from_utf8_lossy(&fsutil_out.stdout);
    let link_lines: Vec<&str> = fsutil_str.lines().filter(|l| !l.trim().is_empty()).collect();
    println!("FSUTIL_HARDLINKS: count={}", link_lines.len());
    assert_eq!(
        link_lines.len(),
        2,
        "NTFS hardlink must show 2 directory entries pointing to same inode"
    );

    // 6. Export pipeline: NVENC Discord 10 MB with 2-track audio mix + Lossless trim
    std::fs::create_dir_all(&export_dir).expect("create export dir");
    let plan = calculate_discord_bitrate(ExportPreset::Discord10mb, 3.0, 1080, true)
        .expect("bitrate plan");
    println!(
        "BITRATE_PLAN_10MB: video_kbps={}, audio_kbps={}, downscale_720p={}",
        plan.video_kbps, plan.audio_kbps, plan.downscale_720p
    );
    let out_nvenc = export_dir.join("qa_discord_10mb_nvenc.mp4");
    let maxrate = ((plan.video_kbps as f64) * 1.25).round() as i64;
    let bufsize = plan.video_kbps * 2;
    let nvenc_status = Command::new("ffmpeg")
        .args([
            "-y",
            "-v",
            "error",
            "-ss",
            "0.000",
            "-i",
            &mp4_path.to_string_lossy(),
            "-t",
            "3.000",
            "-c:v",
            "h264_nvenc",
            "-preset",
            "p4",
            "-rc",
            "vbr",
            "-b:v",
            &format!("{}k", plan.video_kbps),
            "-maxrate",
            &format!("{maxrate}k"),
            "-bufsize",
            &format!("{bufsize}k"),
            "-pix_fmt",
            "yuv420p",
            "-filter_complex",
            "[0:1]volume=1.000[a0];[0:2]volume=0.600[a1];[a0][a1]amix=inputs=2:duration=longest:normalize=0[aout]",
            "-map",
            "0:v:0",
            "-map",
            "[aout]",
            "-c:a",
            "aac",
            "-b:a",
            &format!("{}k", plan.audio_kbps),
            "-movflags",
            "+faststart",
            &out_nvenc.to_string_lossy(),
        ])
        .status()
        .expect("run ffmpeg nvenc");
    assert!(nvenc_status.success(), "NVENC export command failed");

    let out_size = std::fs::metadata(&out_nvenc).expect("out metadata").len();
    println!("NVENC_EXPORT_SIZE_BYTES={out_size} (limit 10485760)");
    assert!(out_size > 10_000 && out_size <= 10 * 1024 * 1024);

    let out_probe = probe_clip(&out_nvenc).await.expect("probe exported mp4");
    println!(
        "NVENC_EXPORT_PROBE: dur={:.3}s, {}x{}, codec={}, audio_tracks={}",
        out_probe.duration_sec,
        out_probe.width,
        out_probe.height,
        out_probe.video_codec,
        out_probe.audio_tracks.len()
    );
    assert_eq!(out_probe.width, 1920);
    assert_eq!(out_probe.height, 1080);
    assert_eq!(out_probe.video_codec, "h264");
    assert_eq!(out_probe.audio_tracks.len(), 1);

    let out_lossless = export_dir.join("qa_lossless_trim.mp4");
    let lossless_status = Command::new("ffmpeg")
        .args([
            "-y",
            "-v",
            "error",
            "-ss",
            "0.500",
            "-i",
            &mp4_path.to_string_lossy(),
            "-t",
            "1.500",
            "-c",
            "copy",
            "-map",
            "0:v:0",
            "-map",
            "0:a?",
            "-movflags",
            "+faststart",
            &out_lossless.to_string_lossy(),
        ])
        .status()
        .expect("run ffmpeg lossless trim");
    assert!(lossless_status.success(), "Lossless trim command failed");
    let lossless_probe = probe_clip(&out_lossless).await.expect("probe lossless trim");
    println!(
        "LOSSLESS_TRIM_PROBE: dur={:.3}s, audio_tracks={}",
        lossless_probe.duration_sec,
        lossless_probe.audio_tracks.len()
    );
    assert_eq!(lossless_probe.audio_tracks.len(), 2);

    // 7. Save trimmed 1.2s clip directly to library + collection
    let saved_detail = save_trimmed_clip_to_library(
        &db,
        &paths,
        &thumb_sem,
        &hw_encoders,
        "http://127.0.0.1:0",
        &token,
        SaveTrimmedClipRequest {
            clip_id: clip_id.clone(),
            start_sec: 0.90,
            end_sec: 2.10,
            title: Some("  Clean 1.2s Cut  ".to_string()),
            audio_mix: Vec::new(),
            collection_ids: Some(vec![col.id.clone()]),
            aspect_mode: AspectMode::Original,
            normalize_audio: false,
        },
    )
    .await
    .expect("save_trimmed_clip_to_library");

    println!(
        "SAVE_TRIMMED_CLIP: id={}, dur={:.3}s, tracks={}, path={}",
        saved_detail.clip.id,
        saved_detail.clip.duration_sec,
        saved_detail.audio_tracks.len(),
        saved_detail.clip.file_path
    );
    assert_ne!(saved_detail.clip.id, clip_id);
    assert!(mp4_path.exists(), "original clip must stay untouched");
    assert!(saved_detail
        .clip
        .file_path
        .starts_with(&paths.saved_clips_dir.to_string_lossy().to_string()));
    assert_eq!(saved_detail.clip.title.as_deref(), Some("Clean 1.2s Cut"));
    assert!(
        (saved_detail.clip.duration_sec - 1.2).abs() < 0.15,
        "expected ~1.2s duration, got {}",
        saved_detail.clip.duration_sec
    );
    assert_eq!(saved_detail.audio_tracks.len(), 2);
    assert!(paths.thumb_path(&saved_detail.clip.id).exists());
    assert!(saved_detail.collection_ids.contains(&col.id));

    // 8. Non-16:9 (1568x1080) clip stretched to true 1920x1080 via AspectMode::Stretch169
    let stretched_src = game_dir.join("Valorant 2026.11.25 - 23.05.00.01.mp4");
    let gen_4_3 = Command::new("ffmpeg")
        .args([
            "-y",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc=duration=1.5:size=1568x1080:rate=60",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=1.5:sample_rate=48000",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            &stretched_src.to_string_lossy(),
        ])
        .status()
        .expect("generate 1568x1080 clip");
    assert!(gen_4_3.success());

    let (src_4_3_id, _) = index_single_file(&db, &paths, &thumb_sem, &wf, &stretched_src)
        .await
        .expect("index 1568x1080")
        .expect("1568x1080 clip");

    let stretched_detail = save_trimmed_clip_to_library(
        &db,
        &paths,
        &thumb_sem,
        &hw_encoders,
        "http://127.0.0.1:0",
        &token,
        SaveTrimmedClipRequest {
            clip_id: src_4_3_id.clone(),
            start_sec: 0.2,
            end_sec: 1.2,
            title: Some("Stretched 16:9".to_string()),
            audio_mix: Vec::new(),
            collection_ids: None,
            aspect_mode: AspectMode::Stretch169,
            normalize_audio: false,
        },
    )
    .await
    .expect("save_trimmed_clip stretch_16_9");
    println!(
        "STRETCH_16_9_SAVE: {}x{}, dur={:.3}s",
        stretched_detail.clip.width,
        stretched_detail.clip.height,
        stretched_detail.clip.duration_sec
    );
    assert_eq!(stretched_detail.clip.width, 1920);
    assert_eq!(stretched_detail.clip.height, 1080);

    // 9. set_clip_thumbnail + cache-buster URL + streamer ?token=...&v=... serving
    let thumb_res = set_clip_thumbnail_core(
        &db,
        &paths,
        &thumb_sem,
        "http://127.0.0.1:0",
        &token,
        &clip_id,
        1.25,
    )
    .await
    .expect("set_clip_thumbnail_core");
    assert_eq!(thumb_res.clip_id, clip_id);
    assert!(thumb_res.thumb_url.contains("&v="));
    assert!(paths.thumb_path(&clip_id).exists());

    let thumb_streamer_state = StreamerState {
        db: db.clone(),
        paths: paths.clone(),
        token: token.clone(),
        thumb_sem: thumb_sem.clone(),
        audio_locks: Arc::new(Mutex::new(HashMap::new())),
    };
    let thumb_listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let thumb_addr = thumb_listener.local_addr().expect("addr");
    let thumb_router = build_router(thumb_streamer_state);
    let thumb_server = tokio::spawn(async move {
        let _ = axum::serve(thumb_listener, thumb_router).await;
    });
    let (st_v, _, body_v) = http_get(
        thumb_addr,
        &format!("/thumb/{clip_id}?token={token}&v=123456789"),
        None,
    )
    .await;
    assert_eq!(st_v, 200);
    assert_eq!(&body_v[0..3], &[0xFF, 0xD8, 0xFF]);
    thumb_server.abort();

    // 10. capture_frame_snapshot (PNG 1920x1080 stretch + BMP DIB header strip check)
    let snap_res = capture_frame_snapshot_core(
        &db,
        &export_dir,
        &src_4_3_id,
        0.50,
        Some(AspectMode::Stretch169),
        false,
    )
    .await
    .expect("capture_frame_snapshot_core");
    assert!(!snap_res.copied_to_clipboard);
    let snap_bytes = std::fs::read(&snap_res.output_path).expect("read snapshot png");
    assert_eq!(&snap_bytes[0..4], b"\x89PNG");
    let snap_probe = probe_clip(std::path::Path::new(&snap_res.output_path))
        .await
        .expect("probe snapshot png");
    assert_eq!(snap_probe.width, 1920);
    assert_eq!(snap_probe.height, 1080);

    let bmp_out = Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-i",
            &snap_res.output_path,
            "-frames:v",
            "1",
            "-f",
            "image2pipe",
            "-vcodec",
            "bmp",
            "pipe:1",
        ])
        .output()
        .expect("convert png to bmp");
    assert!(bmp_out.status.success());
    let dib = extract_dib_from_bmp(&bmp_out.stdout).expect("valid DIB");
    assert_eq!(dib.len(), bmp_out.stdout.len() - 14);

    // 11. Flat watch folder without game subfolders uses root folder name
    let flat_root = root.join("Captures");
    std::fs::create_dir_all(&flat_root).expect("create flat Captures");
    let flat_clip = flat_root.join("flat_clip.mp4");
    std::fs::copy(&stretched_src, &flat_clip).expect("copy flat clip");
    let flat_wf = db
        .add_watch_folder(&flat_root.to_string_lossy(), SourceType::Custom)
        .expect("add flat watch folder");
    let (flat_id, _) = index_single_file(&db, &paths, &thumb_sem, &flat_wf, &flat_clip)
        .await
        .expect("index flat clip")
        .expect("flat clip indexed");
    let flat_detail = db
        .get_clip_detail(&flat_id, "http://127.0.0.1:0", &token)
        .expect("flat detail");
    assert_eq!(flat_detail.clip.game_name, "Captures");

    // 12. Vertical 9:16 blur export (1080x1920) with loudnorm audio normalization
    let out_vertical = export_dir.join("qa_vertical_blur_9_16.mp4");
    let v_req = StartExportRequest {
        clip_id: clip_id.clone(),
        preset: ExportPreset::VerticalBlur916,
        start_sec: 0.0,
        end_sec: 1.5,
        audio_mix: Vec::new(),
        copy_to_clipboard: false,
        aspect_mode: AspectMode::Original,
        normalize_audio: true,
        custom_preset_id: None,
    };
    let (v_size, v_enc) = execute_export_pipeline(
        None,
        "qa_v_blur",
        &mp4_path,
        &out_vertical,
        0.0,
        1.5,
        1080,
        2,
        &v_req,
        &hw_encoders,
        &ActiveJobControl::default(),
    )
    .await
    .unwrap_or_else(|_| panic!("vertical_blur_9_16 export failed"));
    assert!(v_size > 10_000);
    let v_probe = probe_clip(&out_vertical).await.expect("probe vertical blur");
    println!(
        "VERTICAL_BLUR_9_16: {}x{}, dur={:.3}s, enc={v_enc}, audio_tracks={}",
        v_probe.width,
        v_probe.height,
        v_probe.duration_sec,
        v_probe.audio_tracks.len()
    );
    assert_eq!(v_probe.width, 1080);
    assert_eq!(v_probe.height, 1920);
    assert_eq!(v_probe.audio_tracks.len(), 1);

    // 13. Merge 2 clips (1920x1080 3.0s + 1568x1080 1.5s) -> 1 MP4 1920x1080 (~4.5s) with loudnorm
    let out_merge = export_dir.join("qa_merged_montage.mp4");
    let merge_inputs = vec![
        MergeClipInput {
            file_path: mp4_path.to_string_lossy().to_string(),
            duration_sec: 3.0,
            has_audio: true,
        },
        MergeClipInput {
            file_path: stretched_src.to_string_lossy().to_string(),
            duration_sec: 1.5,
            has_audio: true,
        },
    ];
    let (m_size, m_enc) = execute_merge_pipeline(
        None,
        "qa_merge",
        &merge_inputs,
        &out_merge,
        4.5,
        AspectMode::Original,
        true,
        &hw_encoders,
        &ActiveJobControl::default(),
    )
    .await
    .unwrap_or_else(|_| panic!("merge_clips pipeline failed"));
    assert!(m_size > 10_000);
    let m_probe = probe_clip(&out_merge).await.expect("probe merged montage");
    println!(
        "MERGE_CLIPS: {}x{}, dur={:.3}s, enc={m_enc}, audio_tracks={}",
        m_probe.width,
        m_probe.height,
        m_probe.duration_sec,
        m_probe.audio_tracks.len()
    );
    assert_eq!(m_probe.width, 1920);
    assert_eq!(m_probe.height, 1080);
    assert!(
        (m_probe.duration_sec - 4.5).abs() < 0.35,
        "expected ~4.5s merged duration, got {}",
        m_probe.duration_sec
    );
    assert_eq!(m_probe.audio_tracks.len(), 1);

    // 14. Editor Mode pipeline: 2 segments (speed 1.5x + crossfade 0.35s + vertical blur 1080x1920 + loudnorm)
    let out_editor = export_dir.join("qa_editor_export.mp4");
    let editor_segs = vec![
        PreparedEditorSegment {
            clip_id: clip_id.clone(),
            file_path: mp4_path.to_string_lossy().to_string(),
            start_sec: 0.0,
            raw_dur: 2.0,
            effective_dur: 2.0,
            speed: 1.0,
            src_height: 1080,
            track_count: 2,
            audio_mix: Vec::new(),
            master_volume: 100.0,
            master_muted: false,
            transition_in: EditorTransitionMode::Cut,
            transition_out: EditorTransitionOutMode::Cut,
            vibrance: 0.0,
            saturation: 100.0,
            framing: EditorFraming::Fit,
        },
        PreparedEditorSegment {
            clip_id: src_4_3_id.clone(),
            file_path: stretched_src.to_string_lossy().to_string(),
            start_sec: 0.0,
            raw_dur: 1.5,
            effective_dur: 1.0,
            speed: 1.5,
            src_height: 1080,
            track_count: 1,
            audio_mix: Vec::new(),
            master_volume: 85.0,
            master_muted: false,
            transition_in: EditorTransitionMode::Crossfade(0.35),
            transition_out: EditorTransitionOutMode::Cut,
            vibrance: 25.0,
            saturation: 115.0,
            framing: EditorFraming::Fill,
        },
    ];
    let (ed_size, ed_enc) = execute_editor_export_pipeline(
        None,
        "qa_editor",
        &editor_segs,
        &[],
        &out_editor,
        2.65,
        EditorPresetMode::Original,
        EditorVerticalMode::Blur,
        true,
        &hw_encoders,
        &ActiveJobControl::default(),
    )
    .await
    .unwrap_or_else(|e| panic!("editor export pipeline failed: {e:?}"));
    assert!(ed_size > 10_000);
    let ed_probe = probe_clip(&out_editor).await.expect("probe editor mp4");
    println!(
        "EDITOR_EXPORT: {}x{}, dur={:.3}s, enc={ed_enc}, audio_tracks={}",
        ed_probe.width,
        ed_probe.height,
        ed_probe.duration_sec,
        ed_probe.audio_tracks.len()
    );
    assert_eq!(ed_probe.width, 1080);
    assert_eq!(ed_probe.height, 1920);
    assert!(
        (ed_probe.duration_sec - 2.65).abs() < 0.35,
        "expected ~2.65s editor duration, got {}",
        ed_probe.duration_sec
    );
    assert_eq!(ed_probe.audio_tracks.len(), 1);

    // 15. Editor Mode v2 Discord 10 MB + Stretch framing + negative vibrance + saturation + crossfade
    let out_editor_discord = export_dir.join("qa_editor_discord_stretch.mp4");
    let editor_discord_segs = vec![
        PreparedEditorSegment {
            clip_id: clip_id.clone(),
            file_path: mp4_path.to_string_lossy().to_string(),
            start_sec: 0.0,
            raw_dur: 2.0,
            effective_dur: 2.0,
            speed: 1.0,
            src_height: 1080,
            track_count: 2,
            audio_mix: Vec::new(),
            master_volume: 100.0,
            master_muted: false,
            transition_in: EditorTransitionMode::Cut,
            transition_out: EditorTransitionOutMode::Cut,
            vibrance: -25.0,
            saturation: 135.0,
            framing: EditorFraming::Fit,
        },
        PreparedEditorSegment {
            clip_id: src_4_3_id.clone(),
            file_path: stretched_src.to_string_lossy().to_string(),
            start_sec: 0.0,
            raw_dur: 1.5,
            effective_dur: 1.5,
            speed: 1.0,
            src_height: 1080,
            track_count: 1,
            audio_mix: Vec::new(),
            master_volume: 100.0,
            master_muted: false,
            transition_in: EditorTransitionMode::Crossfade(0.35),
            transition_out: EditorTransitionOutMode::Cut,
            vibrance: 30.0,
            saturation: 90.0,
            framing: EditorFraming::Stretch,
        },
    ];
    let (ed_disc_size, ed_disc_enc) = execute_editor_export_pipeline(
        None,
        "qa_editor_discord",
        &editor_discord_segs,
        &[],
        &out_editor_discord,
        3.15,
        EditorPresetMode::Discord(ExportPreset::Discord10mb),
        EditorVerticalMode::None,
        false,
        &hw_encoders,
        &ActiveJobControl::default(),
    )
    .await
    .unwrap_or_else(|e| panic!("editor discord stretch export failed: {e:?}"));
    assert!(ed_disc_size > 10_000 && ed_disc_size <= 10 * 1024 * 1024);
    let ed_disc_probe = probe_clip(&out_editor_discord)
        .await
        .expect("probe editor discord mp4");
    println!(
        "EDITOR_DISCORD_STRETCH: {}x{}, dur={:.3}s, size={ed_disc_size}, enc={ed_disc_enc}",
        ed_disc_probe.width,
        ed_disc_probe.height,
        ed_disc_probe.duration_sec
    );
    assert_eq!(ed_disc_probe.width, 1920);
    assert_eq!(ed_disc_probe.height, 1080);
    assert!(
        (ed_disc_probe.duration_sec - 3.15).abs() < 0.35,
        "expected ~3.15s editor discord duration, got {}",
        ed_disc_probe.duration_sec
    );

    // 16. Real FFmpeg verification for 9:16 Crop + Stretch and 9:16 Blur + Stretch
    let out_crop_stretch = export_dir.join("qa_editor_crop_stretch_9_16.mp4");
    let stretch_only_seg = vec![PreparedEditorSegment {
        clip_id: src_4_3_id.clone(),
        file_path: stretched_src.to_string_lossy().to_string(),
        start_sec: 0.0,
        raw_dur: 1.2,
        effective_dur: 1.2,
        speed: 1.0,
        src_height: 1080,
        track_count: 1,
        audio_mix: Vec::new(),
        master_volume: 100.0,
        master_muted: false,
        transition_in: EditorTransitionMode::Cut,
        transition_out: EditorTransitionOutMode::Cut,
        vibrance: 0.0,
        saturation: 100.0,
        framing: EditorFraming::Stretch,
    }];
    let (crop_st_size, crop_st_enc) = execute_editor_export_pipeline(
        None,
        "qa_editor_crop_stretch",
        &stretch_only_seg,
        &[],
        &out_crop_stretch,
        1.2,
        EditorPresetMode::Original,
        EditorVerticalMode::Crop,
        false,
        &hw_encoders,
        &ActiveJobControl::default(),
    )
    .await
    .unwrap_or_else(|e| panic!("editor 9:16 crop+stretch export failed: {e:?}"));
    assert!(crop_st_size > 10_000);
    let crop_st_probe = probe_clip(&out_crop_stretch)
        .await
        .expect("probe editor crop+stretch mp4");
    println!(
        "EDITOR_9_16_CROP_STRETCH: {}x{}, dur={:.3}s, enc={crop_st_enc}",
        crop_st_probe.width, crop_st_probe.height, crop_st_probe.duration_sec
    );
    assert_eq!(crop_st_probe.width, 1080);
    assert_eq!(crop_st_probe.height, 1920);

    let out_blur_stretch = export_dir.join("qa_editor_blur_stretch_9_16.mp4");
    let (blur_st_size, blur_st_enc) = execute_editor_export_pipeline(
        None,
        "qa_editor_blur_stretch",
        &stretch_only_seg,
        &[],
        &out_blur_stretch,
        1.2,
        EditorPresetMode::Original,
        EditorVerticalMode::Blur,
        false,
        &hw_encoders,
        &ActiveJobControl::default(),
    )
    .await
    .unwrap_or_else(|e| panic!("editor 9:16 blur+stretch export failed: {e:?}"));
    assert!(blur_st_size > 10_000);
    let blur_st_probe = probe_clip(&out_blur_stretch)
        .await
        .expect("probe editor blur+stretch mp4");
    println!(
        "EDITOR_9_16_BLUR_STRETCH: {}x{}, dur={:.3}s, enc={blur_st_enc}",
        blur_st_probe.width, blur_st_probe.height, blur_st_probe.duration_sec
    );
    assert_eq!(blur_st_probe.width, 1080);
    assert_eq!(blur_st_probe.height, 1920);
}
