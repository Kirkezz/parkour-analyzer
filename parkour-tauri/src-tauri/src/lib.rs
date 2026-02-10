use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::fs;
use std::path::PathBuf;
use std::sync::mpsc::channel;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

fn get_log_path() -> Option<PathBuf> {
    let candidates: Vec<PathBuf> = if cfg!(target_os = "windows") {
        let appdata = std::env::var("APPDATA").ok()?;
        vec![
            PathBuf::from(&appdata).join(".minecraft\\logs\\latest.log"),
            PathBuf::from(&appdata).join(".lunarclient\\offline\\multiver\\logs\\latest.log"),
        ]
    } else if cfg!(target_os = "macos") {
        let home = dirs::home_dir()?;
        vec![
            home.join("Library/Application Support/minecraft/logs/latest.log"),
            home.join(".lunarclient/offline/multiver/logs/latest.log"),
        ]
    } else {
        let home = dirs::home_dir()?;
        vec![
            home.join(".minecraft/logs/latest.log"),
            home.join(".lunarclient/offline/multiver/logs/latest.log"),
        ]
    };
    candidates.into_iter().find(|p| p.exists())
}

fn hash_content(s: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    s.len().hash(&mut hasher);
    let bytes = s.as_bytes();
    if bytes.len() > 1024 {
        bytes[..512].hash(&mut hasher);
        bytes[bytes.len() - 512..].hash(&mut hasher);
    } else {
        bytes.hash(&mut hasher);
    }
    hasher.finish()
}

#[tauri::command]
fn get_log_content() -> Result<String, String> {
    let path = get_log_path().ok_or("Could not find Minecraft log file")?;
    fs::read_to_string(&path).map_err(|e| format!("Failed to read log: {}", e))
}

#[tauri::command]
fn get_log_location() -> Result<String, String> {
    let path = get_log_path().ok_or("Could not find Minecraft log file")?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn get_default_paths() -> Vec<String> {
    let mut paths = Vec::new();
    if cfg!(target_os = "windows") {
        if let Ok(appdata) = std::env::var("APPDATA") {
            paths.push(format!("{}\\.minecraft\\logs\\latest.log", appdata));
            paths.push(format!("{}\\.lunarclient\\offline\\multiver\\logs\\latest.log", appdata));
        }
    } else if cfg!(target_os = "macos") {
        if let Some(home) = dirs::home_dir() {
            let h = home.to_string_lossy();
            paths.push(format!("{}/Library/Application Support/minecraft/logs/latest.log", h));
            paths.push(format!("{}/.lunarclient/offline/multiver/logs/latest.log", h));
        }
    } else {
        if let Some(home) = dirs::home_dir() {
            let h = home.to_string_lossy();
            paths.push(format!("{}/.minecraft/logs/latest.log", h));
            paths.push(format!("{}/.lunarclient/offline/multiver/logs/latest.log", h));
        }
    }
    paths
}

#[tauri::command]
fn validate_path(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

#[tauri::command]
fn watch_path(path: String, app: AppHandle) -> Result<(), String> {
    if !std::path::Path::new(&path).exists() {
        return Err("File not found".into());
    }
    let _ = app.emit("log-location", path.clone());
    if let Ok(content) = fs::read_to_string(&path) {
        let _ = app.emit("log-update", content);
    }
    Ok(())
}

fn start_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        let path = loop {
            if let Some(p) = get_log_path() {
                break p;
            }
            let _ = app.emit("log-error", "Minecraft log file not found");
            std::thread::sleep(Duration::from_secs(5));
        };

        let _ = app.emit("log-location", path.to_string_lossy().to_string());

        let mut last_hash: u64 = 0;
        if let Ok(content) = fs::read_to_string(&path) {
            last_hash = hash_content(&content);
            let _ = app.emit("log-update", content);
        }

        let (tx, rx) = channel::<Result<Event, notify::Error>>();
        let mut watcher = match RecommendedWatcher::new(
            tx,
            Config::default().with_poll_interval(Duration::from_secs(2)),
        ) {
            Ok(w) => w,
            Err(e) => {
                let _ = app.emit("log-error", format!("Watcher error: {}", e));
                return;
            }
        };

        if let Err(e) = watcher.watch(path.parent().unwrap(), RecursiveMode::NonRecursive) {
            let _ = app.emit("log-error", format!("Watch error: {}", e));
            return;
        }

        let mut last_emit = Instant::now();
        let debounce = Duration::from_secs(2);

        loop {
            match rx.recv_timeout(Duration::from_secs(3)) {
                Ok(Ok(event)) => {
                    let is_log = event
                        .paths
                        .iter()
                        .any(|p| p.file_name().map(|f| f == "latest.log").unwrap_or(false));

                    if is_log && last_emit.elapsed() >= debounce {
                        if let Ok(content) = fs::read_to_string(&path) {
                            let new_hash = hash_content(&content);
                            if new_hash != last_hash {
                                last_hash = new_hash;
                                last_emit = Instant::now();
                                let _ = app.emit("log-update", content);
                            }
                        }
                    }
                }
                Ok(Err(_)) => {}
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                Err(_) => break,
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_log_content,
            get_log_location,
            get_default_paths,
            validate_path,
            watch_path
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            start_watcher(handle);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
