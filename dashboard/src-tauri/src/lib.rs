use std::net::UdpSocket;
use std::process::{Child, Command};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

struct Sidecars {
    hermes: Option<Child>,
    claude_proxy: Option<Child>,
}

impl Sidecars {
    fn kill_all(&mut self) {
        if let Some(ref mut child) = self.hermes {
            let _ = child.kill();
        }
        if let Some(ref mut child) = self.claude_proxy {
            let _ = child.kill();
        }
    }
}

fn get_local_ip() -> String {
    let socket = UdpSocket::bind("0.0.0.0:0").ok();
    if let Some(s) = socket {
        if s.connect("8.8.8.8:80").is_ok() {
            if let Ok(addr) = s.local_addr() {
                return addr.ip().to_string();
            }
        }
    }
    "127.0.0.1".to_string()
}

#[tauri::command]
fn get_lan_url() -> String {
    let ip = get_local_ip();
    format!("http://{}:8765", ip)
}

#[tauri::command]
fn get_proxy_status() -> String {
    match reqwest::blocking::get("http://127.0.0.1:8766/health") {
        Ok(resp) => resp.text().unwrap_or_else(|_| r#"{"available":false}"#.to_string()),
        Err(_) => r#"{"available":false,"error":"proxy not running"}"#.to_string(),
    }
}

fn wait_for_hermes(timeout_secs: u64) -> bool {
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(timeout_secs) {
        if reqwest::blocking::get("http://127.0.0.1:8765/health").is_ok() {
            return true;
        }
        thread::sleep(Duration::from_millis(500));
    }
    false
}

fn spawn_hermes() -> Option<Child> {
    let repo_root = std::env::current_exe()
        .ok()
        .and_then(|p| {
            // In dev: dashboard/src-tauri/target/debug/swarm
            // Walk up to find the repo root (contains hermes/)
            let mut dir = p.parent()?.to_path_buf();
            for _ in 0..6 {
                if dir.join("hermes").join("__main__.py").exists() {
                    return Some(dir);
                }
                dir = dir.parent()?.to_path_buf();
            }
            None
        });

    let repo = repo_root.unwrap_or_else(|| {
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .to_path_buf()
    });

    Command::new("python3")
        .args(["-m", "hermes", "serve", "--host", "0.0.0.0", "--port", "8765"])
        .current_dir(&repo)
        .env("PYTHONPATH", &repo)
        .spawn()
        .ok()
}

fn spawn_claude_proxy() -> Option<Child> {
    let repo_root = std::env::current_exe()
        .ok()
        .and_then(|p| {
            let mut dir = p.parent()?.to_path_buf();
            for _ in 0..6 {
                if dir.join("hermes").join("__main__.py").exists() {
                    return Some(dir);
                }
                dir = dir.parent()?.to_path_buf();
            }
            None
        });

    let repo = repo_root.unwrap_or_else(|| {
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .to_path_buf()
    });

    Command::new("python3")
        .args(["-m", "hermes", "claude-proxy", "--port", "8766"])
        .current_dir(&repo)
        .env("PYTHONPATH", &repo)
        .spawn()
        .ok()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let sidecars = Arc::new(Mutex::new(Sidecars {
        hermes: None,
        claude_proxy: None,
    }));

    let sidecars_setup = sidecars.clone();
    let sidecars_event = sidecars.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![get_lan_url, get_proxy_status])
        .setup(move |_app| {
            let sidecars = sidecars_setup;
            // Check if Hermes is already running (e.g., via ./swarm start)
            let hermes_running = reqwest::blocking::get("http://127.0.0.1:8765/health").is_ok();

            if !hermes_running {
                eprintln!("[tauri] Starting Hermes sidecar...");
                let child = spawn_hermes();
                if child.is_some() {
                    if wait_for_hermes(10) {
                        eprintln!("[tauri] Hermes is ready");
                    } else {
                        eprintln!("[tauri] Warning: Hermes did not respond within 10s");
                    }
                }
                if let Ok(mut s) = sidecars.lock() {
                    s.hermes = child;
                }
            } else {
                eprintln!("[tauri] Hermes already running, skipping sidecar spawn");
            }

            // Start Claude proxy
            let proxy_running = reqwest::blocking::get("http://127.0.0.1:8766/health").is_ok();
            if !proxy_running {
                eprintln!("[tauri] Starting Claude proxy sidecar...");
                let child = spawn_claude_proxy();
                if let Ok(mut s) = sidecars.lock() {
                    s.claude_proxy = child;
                }
            }

            Ok(())
        })
        .on_window_event(move |_window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Ok(mut s) = sidecars_event.lock() {
                    eprintln!("[tauri] Shutting down sidecars...");
                    s.kill_all();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error running SWARM");
}
