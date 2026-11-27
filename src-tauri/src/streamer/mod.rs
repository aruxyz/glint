use std::collections::HashMap;
use std::io::SeekFrom;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};

use axum::body::Body;
use axum::extract::{Path as AxumPath, Query, Request, State};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::net::TcpListener;
use tokio::sync::Semaphore;
use tokio_util::io::ReaderStream;
use tower_http::cors::CorsLayer;

use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::media::{
    audio_mime_for_path, extract_audio_track, extract_waveform, generate_thumbnail, tokio_command,
};
use crate::models::WaveformResponse;
use crate::paths::{normalize_windows_path, AppPaths};

#[derive(Clone)]
pub struct StreamerState {
    pub db: Db,
    pub paths: AppPaths,
    pub token: String,
    pub thumb_sem: Arc<Semaphore>,
    pub audio_locks: Arc<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>>,
}

#[derive(Deserialize)]
struct TokenQuery {
    token: Option<String>,
}

#[derive(Deserialize)]
struct LocalAudioQuery {
    path: String,
}

pub fn generate_session_token() -> String {
    let bytes: [u8; 32] = rand::random();
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn start_streamer(
    db: Db,
    paths: AppPaths,
    thumb_sem: Arc<Semaphore>,
) -> AppResult<(String, String)> {
    let token = generate_session_token();
    let std_listener = std::net::TcpListener::bind("127.0.0.1:0")?;
    std_listener.set_nonblocking(true)?;
    let port = std_listener.local_addr()?.port();
    let base_url = format!("http://127.0.0.1:{port}");

    let state = StreamerState {
        db,
        paths,
        token: token.clone(),
        thumb_sem,
        audio_locks: Arc::new(Mutex::new(HashMap::new())),
    };

    let router = build_router(state);

    tauri::async_runtime::spawn(async move {
        let Ok(listener) = TcpListener::from_std(std_listener) else {
            return;
        };
        let _ = axum::serve(listener, router).await;
    });

    Ok((base_url, token))
}

pub fn build_router(state: StreamerState) -> Router {
    Router::new()
        .route("/video/{clipId}", get(stream_video))
        .route("/audio/{clipId}/{trackOrder}", get(stream_audio))
        .route("/local-audio", get(stream_local_audio))
        .route("/local-audio-waveform", get(get_local_audio_waveform))
        .route("/thumb/{clipId}", get(get_thumb))
        .route("/waveform/{clipId}/{trackOrder}", get(get_waveform))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth_middleware))
        .layer(build_cors_layer())
        .layer(middleware::from_fn(security_headers_middleware))
        .with_state(state)
}

fn allowed_cors_origins() -> Vec<HeaderValue> {
    let mut origins = vec![
        HeaderValue::from_static("http://tauri.localhost"),
        HeaderValue::from_static("https://tauri.localhost"),
        HeaderValue::from_static("tauri://localhost"),
    ];
    #[cfg(debug_assertions)]
    {
        origins.push(HeaderValue::from_static("http://localhost:1420"));
        origins.push(HeaderValue::from_static("http://127.0.0.1:1420"));
    }
    origins
}

fn build_cors_layer() -> CorsLayer {
    CorsLayer::new()
        .allow_origin(allowed_cors_origins())
        .allow_methods([Method::GET, Method::HEAD, Method::OPTIONS])
        .allow_headers([header::RANGE, header::CONTENT_TYPE, header::ACCEPT])
        .expose_headers([
            header::CONTENT_RANGE,
            header::ACCEPT_RANGES,
            header::CONTENT_LENGTH,
        ])
}

async fn security_headers_middleware(request: Request, next: Next) -> Response {
    let mut resp = next.run(request).await;
    let headers = resp.headers_mut();
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    resp
}

pub fn validate_clip_id(clip_id: &str) -> AppResult<()> {
    if clip_id.is_empty()
        || clip_id.len() > 128
        || !clip_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err(AppError::InvalidInput("Invalid clipId".to_string()));
    }
    Ok(())
}

pub fn resolve_safe_thumb_path(paths: &AppPaths, clip_id: &str) -> AppResult<PathBuf> {
    validate_clip_id(clip_id)?;
    let thumb_path = paths.thumb_path(clip_id);
    let thumbs_dir = normalize_windows_path(&paths.thumbs_dir);
    let canon_thumbs_dir = std::fs::canonicalize(&thumbs_dir)
        .map(|p| normalize_windows_path(&p))
        .map_err(|_| AppError::Internal("Thumbnail cache directory unavailable".to_string()))?;

    let parent = thumb_path.parent().ok_or_else(|| {
        AppError::InvalidInput("Invalid thumbnail path".to_string())
    })?;
    let canon_parent = std::fs::canonicalize(parent)
        .map(|p| normalize_windows_path(&p))
        .map_err(|_| AppError::InvalidInput("Invalid thumbnail parent".to_string()))?;
    if canon_parent != canon_thumbs_dir {
        return Err(AppError::InvalidInput(
            "Thumbnail path escapes cache directory".to_string(),
        ));
    }

    if thumb_path.exists() {
        let canon_thumb = std::fs::canonicalize(&thumb_path)
            .map(|p| normalize_windows_path(&p))?;
        if !canon_thumb.starts_with(&canon_thumbs_dir) {
            return Err(AppError::InvalidInput(
                "Thumbnail path escapes cache directory".to_string(),
            ));
        }
    }

    Ok(thumb_path)
}

async fn auth_middleware(
    State(state): State<StreamerState>,
    Query(q): Query<TokenQuery>,
    request: Request,
    next: Next,
) -> Response {
    let provided = q.token.as_deref().unwrap_or("");
    if !constant_time_eq(provided.as_bytes(), state.token.as_bytes()) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    next.run(request).await
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (&x, &y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

async fn stream_video(
    State(state): State<StreamerState>,
    AxumPath(clip_id): AxumPath<String>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    validate_clip_id(&clip_id)?;
    let clip = state
        .db
        .get_clip_file_info(&clip_id)?
        .ok_or_else(|| AppError::NotFound(format!("Clip '{clip_id}' not found")))?;

    if clip.is_missing {
        return Err(AppError::NotFound("Clip file is missing".to_string()));
    }

    let path = normalize_windows_path(Path::new(&clip.file_path));
    if !path.exists() {
        return Err(AppError::NotFound("Clip file does not exist".to_string()));
    }

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    if ext == "mkv" {
        return stream_mkv_remux(&path).await;
    }

    let mime = match ext.as_str() {
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        _ => "video/mp4",
    };

    serve_file_with_range(&path, mime, headers.get(header::RANGE)).await
}

async fn stream_mkv_remux(path: &Path) -> Result<Response, AppError> {
    let path_str = path.to_string_lossy().to_string();
    let mut child = tokio_command("ffmpeg")
        .args([
            "-v",
            "error",
            "-i",
            &path_str,
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-movflags",
            "frag_keyframe+empty_moov",
            "-f",
            "mp4",
            "pipe:1",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| AppError::Process(format!("Failed to remux mkv: {e}")))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Process("Missing ffmpeg remux stdout".to_string()))?;

    let stream = child_stdout_stream(child, stdout);
    let mut resp = Response::new(Body::from_stream(stream));
    *resp.status_mut() = StatusCode::OK;
    resp.headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static("video/mp4"));
    Ok(resp)
}

fn child_stdout_stream(
    child: tokio::process::Child,
    stdout: tokio::process::ChildStdout,
) -> ReaderStream<impl tokio::io::AsyncRead + Send> {
    struct ChildReader {
        _child: tokio::process::Child,
        stdout: tokio::process::ChildStdout,
    }
    impl tokio::io::AsyncRead for ChildReader {
        fn poll_read(
            mut self: std::pin::Pin<&mut Self>,
            cx: &mut std::task::Context<'_>,
            buf: &mut tokio::io::ReadBuf<'_>,
        ) -> std::task::Poll<std::io::Result<()>> {
            std::pin::Pin::new(&mut self.stdout).poll_read(cx, buf)
        }
    }
    ReaderStream::new(ChildReader {
        _child: child,
        stdout,
    })
}

async fn stream_audio(
    State(state): State<StreamerState>,
    AxumPath((clip_id, track_order)): AxumPath<(String, i32)>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    validate_clip_id(&clip_id)?;
    let clip = state
        .db
        .get_clip_file_info(&clip_id)?
        .ok_or_else(|| AppError::NotFound(format!("Clip '{clip_id}' not found")))?;
    let track = state
        .db
        .get_audio_track(&clip_id, track_order)?
        .ok_or_else(|| AppError::NotFound("Audio track not found".to_string()))?;

    let cache_path = state.paths.audio_cache_path(&clip_id, track_order);
    if !cache_path.exists() {
        let lock = get_audio_lock(&state.audio_locks, &format!("{clip_id}_{track_order}"));
        let _guard = lock.lock().await;
        if !cache_path.exists() {
            let src_path = normalize_windows_path(Path::new(&clip.file_path));
            if !src_path.exists() {
                return Err(AppError::NotFound("Source video missing".to_string()));
            }
            extract_audio_track(&src_path, track.stream_index, &cache_path).await?;
        }
    }

    serve_file_with_range(&cache_path, "audio/mp4", headers.get(header::RANGE)).await
}

async fn resolve_safe_local_audio_path(raw_path: &str) -> AppResult<(PathBuf, &'static str)> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() || trimmed.contains('\0') {
        return Err(AppError::InvalidInput("Invalid audio path".to_string()));
    }

    let normalized = normalize_windows_path(Path::new(trimmed));
    let canon_path = tokio::fs::canonicalize(&normalized)
        .await
        .map(|p| normalize_windows_path(&p))
        .map_err(|_| AppError::NotFound("Audio file not found".to_string()))?;

    let meta = tokio::fs::metadata(&canon_path).await?;
    if !meta.is_file() {
        return Err(AppError::InvalidInput(
            "Audio path is not a file".to_string(),
        ));
    }

    let mime = audio_mime_for_path(&canon_path).ok_or_else(|| {
        AppError::InvalidInput("Unsupported audio file extension".to_string())
    })?;

    Ok((canon_path, mime))
}

fn hash_path_fnv1a(path: &Path) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in path.to_string_lossy().to_ascii_lowercase().as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

async fn stream_local_audio(
    Query(q): Query<LocalAudioQuery>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    let (canon_path, mime) = resolve_safe_local_audio_path(&q.path).await?;
    serve_file_with_range(&canon_path, mime, headers.get(header::RANGE)).await
}

async fn get_local_audio_waveform(
    State(state): State<StreamerState>,
    Query(q): Query<LocalAudioQuery>,
) -> Result<Json<WaveformResponse>, AppError> {
    let (canon_path, _) = resolve_safe_local_audio_path(&q.path).await?;
    let path_hash = hash_path_fnv1a(&canon_path);
    let cache_path = state
        .paths
        .waveform_cache_dir
        .join(format!("local_{path_hash}.json"));
    let peaks = extract_waveform(&canon_path, 0, &cache_path, 160).await?;
    Ok(Json(WaveformResponse { peaks }))
}

async fn get_thumb(
    State(state): State<StreamerState>,
    AxumPath(clip_id): AxumPath<String>,
) -> Result<Response, AppError> {
    let thumb_path = resolve_safe_thumb_path(&state.paths, &clip_id)?;
    let clip = state
        .db
        .get_clip_file_info(&clip_id)?
        .ok_or_else(|| AppError::NotFound(format!("Clip '{clip_id}' not found")))?;

    if !thumb_path.exists() {
        let src_path = normalize_windows_path(Path::new(&clip.file_path));
        if !src_path.exists() {
            return Err(AppError::NotFound("Source video missing".to_string()));
        }
        generate_thumbnail(&src_path, clip.duration_sec, &thumb_path, &state.thumb_sem).await?;
    }

    let bytes = tokio::fs::read(&thumb_path).await?;
    let mut resp = Response::new(Body::from(bytes));
    *resp.status_mut() = StatusCode::OK;
    resp.headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static("image/jpeg"));
    resp.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=86400"),
    );
    Ok(resp)
}

async fn get_waveform(
    State(state): State<StreamerState>,
    AxumPath((clip_id, track_order)): AxumPath<(String, i32)>,
) -> Result<Json<WaveformResponse>, AppError> {
    validate_clip_id(&clip_id)?;
    let clip = state
        .db
        .get_clip_file_info(&clip_id)?
        .ok_or_else(|| AppError::NotFound(format!("Clip '{clip_id}' not found")))?;
    let track = state
        .db
        .get_audio_track(&clip_id, track_order)?
        .ok_or_else(|| AppError::NotFound("Audio track not found".to_string()))?;

    let cache_path = state.paths.waveform_cache_path(&clip_id, track_order);
    let src_path = normalize_windows_path(Path::new(&clip.file_path));
    if !cache_path.exists() && !src_path.exists() {
        return Err(AppError::NotFound("Source video missing".to_string()));
    }

    let peaks = extract_waveform(&src_path, track.stream_index, &cache_path, 160).await?;
    Ok(Json(WaveformResponse { peaks }))
}

fn get_audio_lock(
    map: &Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    key: &str,
) -> Arc<tokio::sync::Mutex<()>> {
    let mut guard = map.lock().expect("audio locks poisoned");
    guard
        .entry(key.to_string())
        .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
        .clone()
}

async fn serve_file_with_range(
    path: &Path,
    content_type: &'static str,
    range_header: Option<&HeaderValue>,
) -> Result<Response, AppError> {
    let mut file = tokio::fs::File::open(path).await?;
    let file_len = file.metadata().await?.len();

    if let Some(raw_range) = range_header.and_then(|v| v.to_str().ok()) {
        if let Some((start, end)) = parse_byte_range(raw_range, file_len) {
            let chunk_len = end - start + 1;
            file.seek(SeekFrom::Start(start)).await?;
            let limited = file.take(chunk_len);
            let stream = ReaderStream::new(limited);

            let mut resp = Response::new(Body::from_stream(stream));
            *resp.status_mut() = StatusCode::PARTIAL_CONTENT;
            let h = resp.headers_mut();
            h.insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
            h.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
            h.insert(
                header::CONTENT_LENGTH,
                HeaderValue::from_str(&chunk_len.to_string())
                    .map_err(|e| AppError::Internal(e.to_string()))?,
            );
            h.insert(
                header::CONTENT_RANGE,
                HeaderValue::from_str(&format!("bytes {start}-{end}/{file_len}"))
                    .map_err(|e| AppError::Internal(e.to_string()))?,
            );
            return Ok(resp);
        }

        let mut resp = Response::new(Body::empty());
        *resp.status_mut() = StatusCode::RANGE_NOT_SATISFIABLE;
        resp.headers_mut().insert(
            header::CONTENT_RANGE,
            HeaderValue::from_str(&format!("bytes */{file_len}"))
                .map_err(|e| AppError::Internal(e.to_string()))?,
        );
        return Ok(resp);
    }

    let stream = ReaderStream::new(file);
    let mut resp = Response::new(Body::from_stream(stream));
    *resp.status_mut() = StatusCode::OK;
    let h = resp.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    h.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    h.insert(
        header::CONTENT_LENGTH,
        HeaderValue::from_str(&file_len.to_string())
            .map_err(|e| AppError::Internal(e.to_string()))?,
    );
    Ok(resp)
}

pub fn parse_byte_range(header_val: &str, file_len: u64) -> Option<(u64, u64)> {
    if file_len == 0 {
        return None;
    }
    let spec = header_val.trim().strip_prefix("bytes=")?;
    let first = spec.split(',').next()?.trim();
    let (start_str, end_str) = first.split_once('-')?;

    if start_str.is_empty() {
        let suffix: u64 = end_str.parse().ok()?;
        if suffix == 0 {
            return None;
        }
        let start = file_len.saturating_sub(suffix);
        return Some((start, file_len - 1));
    }

    let start: u64 = start_str.parse().ok()?;
    if start >= file_len {
        return None;
    }

    let end = if end_str.is_empty() {
        file_len - 1
    } else {
        let parsed: u64 = end_str.parse().ok()?;
        parsed.min(file_len - 1)
    };

    if start > end {
        None
    } else {
        Some((start, end))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[test]
    fn parses_http_byte_ranges_correctly() {
        assert_eq!(parse_byte_range("bytes=0-99", 1000), Some((0, 99)));
        assert_eq!(parse_byte_range("bytes=500-", 1000), Some((500, 999)));
        assert_eq!(parse_byte_range("bytes=-200", 1000), Some((800, 999)));
        assert_eq!(parse_byte_range("bytes=1000-", 1000), None);
        assert_eq!(parse_byte_range("bytes=500-100", 1000), None);
    }

    #[tokio::test]
    async fn streamer_rejects_missing_or_wrong_token_with_401() {
        let db = Db::open_in_memory().expect("db");
        let tmp_dir = std::env::temp_dir().join(format!("glint_test_{}", uuid::Uuid::new_v4()));
        let paths = AppPaths::from_base_and_export(tmp_dir.clone(), tmp_dir.join("out"))
            .expect("paths");
        let token = "a".repeat(64);
        let state = StreamerState {
            db,
            paths,
            token: token.clone(),
            thumb_sem: Arc::new(Semaphore::new(2)),
            audio_locks: Arc::new(Mutex::new(HashMap::new())),
        };

        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("addr");
        let router = build_router(state);
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });

        let resp_no_tok = send_raw_get(addr, "/thumb/missing", None).await;
        assert!(
            resp_no_tok.starts_with("HTTP/1.1 401"),
            "expected 401 without token, got: {resp_no_tok}"
        );

        let resp_bad_tok = send_raw_get(addr, "/thumb/missing?token=badtoken", None).await;
        assert!(
            resp_bad_tok.starts_with("HTTP/1.1 401"),
            "expected 401 with bad token, got: {resp_bad_tok}"
        );

        let resp_good_tok = send_raw_get(
            addr,
            &format!("/thumb/missing?token={token}"),
            Some("tauri://localhost"),
        )
        .await;
        assert!(
            resp_good_tok.starts_with("HTTP/1.1 404"),
            "expected 404 (passed auth) with valid token, got: {resp_good_tok}"
        );
        let lower_resp = resp_good_tok.to_ascii_lowercase();
        assert!(
            lower_resp.contains("access-control-allow-origin: tauri://localhost"),
            "expected whitelisted CORS header on response, got: {resp_good_tok}"
        );
        assert!(
            lower_resp.contains("referrer-policy: no-referrer"),
            "expected Referrer-Policy header"
        );
        assert!(
            lower_resp.contains("x-content-type-options: nosniff"),
            "expected X-Content-Type-Options header"
        );

        server.abort();
        let _ = std::fs::remove_dir_all(tmp_dir);
    }

    #[tokio::test]
    async fn streamer_blocks_thumb_path_traversal_and_unregistered_files() {
        let db = Db::open_in_memory().expect("db");
        let tmp_dir = std::env::temp_dir().join(format!("glint_trav_{}", uuid::Uuid::new_v4()));
        let paths = AppPaths::from_base_and_export(tmp_dir.clone(), tmp_dir.join("out"))
            .expect("paths");
        let rogue_thumb = paths.thumbs_dir.join("rogue_untracked.jpg");
        std::fs::write(&rogue_thumb, b"secret").expect("write rogue");

        assert!(resolve_safe_thumb_path(&paths, "").is_err());
        assert!(resolve_safe_thumb_path(&paths, "../secret").is_err());
        assert!(resolve_safe_thumb_path(&paths, r"..\secret").is_err());
        assert!(resolve_safe_thumb_path(&paths, "a/b").is_err());
        assert!(resolve_safe_thumb_path(&paths, "clip.jpg").is_err());
        assert!(resolve_safe_thumb_path(&paths, "valid_clip-123").is_ok());

        let token = "c".repeat(64);
        let state = StreamerState {
            db,
            paths,
            token: token.clone(),
            thumb_sem: Arc::new(Semaphore::new(2)),
            audio_locks: Arc::new(Mutex::new(HashMap::new())),
        };
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("addr");
        let router = build_router(state);
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });

        let resp_trav = send_raw_get(
            addr,
            &format!("/thumb/..%2F..%2Fetc%2Fpasswd?token={token}"),
            None,
        )
        .await;
        assert!(
            resp_trav.starts_with("HTTP/1.1 400") || resp_trav.starts_with("HTTP/1.1 404"),
            "traversal clipId must be rejected, got: {resp_trav}"
        );

        let resp_dot = send_raw_get(addr, &format!("/thumb/foo..bar?token={token}"), None).await;
        assert!(
            resp_dot.starts_with("HTTP/1.1 400"),
            "dot clipId must return 400, got: {resp_dot}"
        );

        let resp_untracked =
            send_raw_get(addr, &format!("/thumb/rogue_untracked?token={token}"), None).await;
        assert!(
            resp_untracked.starts_with("HTTP/1.1 404"),
            "untracked file in thumbs_dir must not be served, got: {resp_untracked}"
        );

        server.abort();
        let _ = std::fs::remove_dir_all(tmp_dir);
    }

    #[tokio::test]
    async fn streamer_enforces_cors_origin_whitelist() {
        let db = Db::open_in_memory().expect("db");
        let tmp_dir = std::env::temp_dir().join(format!("glint_cors_{}", uuid::Uuid::new_v4()));
        let paths = AppPaths::from_base_and_export(tmp_dir.clone(), tmp_dir.join("out"))
            .expect("paths");
        let token = "d".repeat(64);
        let state = StreamerState {
            db,
            paths,
            token: token.clone(),
            thumb_sem: Arc::new(Semaphore::new(2)),
            audio_locks: Arc::new(Mutex::new(HashMap::new())),
        };
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("addr");
        let router = build_router(state);
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });

        for allowed in [
            "http://tauri.localhost",
            "https://tauri.localhost",
            "tauri://localhost",
        ] {
            let resp = send_raw_get(addr, &format!("/thumb/missing?token={token}"), Some(allowed))
                .await
                .to_ascii_lowercase();
            assert!(
                resp.contains(&format!("access-control-allow-origin: {allowed}")),
                "expected origin {allowed} to be allowed, got: {resp}"
            );
        }

        let evil_resp = send_raw_get(
            addr,
            &format!("/thumb/missing?token={token}"),
            Some("https://evil.example"),
        )
        .await
        .to_ascii_lowercase();
        assert!(
            !evil_resp.contains("access-control-allow-origin"),
            "evil origin must not receive access-control-allow-origin, got: {evil_resp}"
        );

        server.abort();
        let _ = std::fs::remove_dir_all(tmp_dir);
    }

    async fn send_raw_get(
        addr: std::net::SocketAddr,
        path: &str,
        origin: Option<&str>,
    ) -> String {
        let mut stream = tokio::net::TcpStream::connect(addr).await.expect("connect");
        let mut req = format!("GET {path} HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n");
        if let Some(org) = origin {
            req.push_str(&format!("Origin: {org}\r\n"));
        }
        req.push_str("\r\n");
        stream.write_all(req.as_bytes()).await.expect("write");
        let mut buf = Vec::new();
        stream.read_to_end(&mut buf).await.expect("read");
        String::from_utf8_lossy(&buf).to_string()
    }

    #[tokio::test]
    async fn streamer_local_audio_enforces_token_extension_and_supports_range() {
        let db = Db::open_in_memory().expect("db");
        let tmp_dir = std::env::temp_dir().join(format!("glint_aud_{}", uuid::Uuid::new_v4()));
        let paths = AppPaths::from_base_and_export(tmp_dir.clone(), tmp_dir.join("out"))
            .expect("paths");
        let mp3_path = tmp_dir.join("bgm track.mp3");
        std::fs::write(&mp3_path, b"0123456789abcdef").expect("write mp3");
        let txt_path = tmp_dir.join("secret.txt");
        std::fs::write(&txt_path, b"not audio").expect("write txt");

        let token = "e".repeat(64);
        let state = StreamerState {
            db,
            paths,
            token: token.clone(),
            thumb_sem: Arc::new(Semaphore::new(2)),
            audio_locks: Arc::new(Mutex::new(HashMap::new())),
        };
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("addr");
        let router = build_router(state);
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });

        let encoded_mp3: String = mp3_path
            .to_string_lossy()
            .replace('\\', "%5C")
            .replace(':', "%3A")
            .replace(' ', "%20");
        let encoded_txt: String = txt_path
            .to_string_lossy()
            .replace('\\', "%5C")
            .replace(':', "%3A");

        let unauth = send_raw_get(addr, &format!("/local-audio?path={encoded_mp3}"), None).await;
        assert!(unauth.starts_with("HTTP/1.1 401"));

        let bad_ext = send_raw_get(
            addr,
            &format!("/local-audio?token={token}&path={encoded_txt}"),
            None,
        )
        .await;
        assert!(bad_ext.starts_with("HTTP/1.1 400"), "got: {bad_ext}");

        let unauth_wf = send_raw_get(
            addr,
            &format!("/local-audio-waveform?path={encoded_mp3}"),
            None,
        )
        .await;
        assert!(unauth_wf.starts_with("HTTP/1.1 401"), "got: {unauth_wf}");

        let bad_ext_wf = send_raw_get(
            addr,
            &format!("/local-audio-waveform?token={token}&path={encoded_txt}"),
            None,
        )
        .await;
        assert!(bad_ext_wf.starts_with("HTTP/1.1 400"), "got: {bad_ext_wf}");

        let ok_resp = send_raw_get(
            addr,
            &format!("/local-audio?token={token}&path={encoded_mp3}"),
            None,
        )
        .await;
        assert!(ok_resp.starts_with("HTTP/1.1 200"), "got: {ok_resp}");
        assert!(ok_resp.to_ascii_lowercase().contains("content-type: audio/mpeg"));
        assert!(ok_resp.ends_with("0123456789abcdef"));

        let mut stream = tokio::net::TcpStream::connect(addr).await.expect("connect");
        let range_req = format!(
            "GET /local-audio?token={token}&path={encoded_mp3} HTTP/1.1\r\nHost: {addr}\r\nRange: bytes=2-5\r\nConnection: close\r\n\r\n"
        );
        stream.write_all(range_req.as_bytes()).await.expect("write");
        let mut range_buf = Vec::new();
        stream.read_to_end(&mut range_buf).await.expect("read");
        let range_resp = String::from_utf8_lossy(&range_buf).to_string();
        assert!(range_resp.starts_with("HTTP/1.1 206"), "got: {range_resp}");
        assert!(range_resp.to_ascii_lowercase().contains("content-range: bytes 2-5/16"));
        assert!(range_resp.ends_with("2345"));

        server.abort();
        let _ = std::fs::remove_dir_all(tmp_dir);
    }
}
