//! OpenVSP Studio desktop shell: Tauri 2 host for the Python engine sidecar.

mod engine;
mod settings;

use engine::Engine;
use serde::Serialize;
use serde_json::Value;
use settings::Settings;
use tauri::{AppHandle, Manager, RunEvent, State, WebviewUrl, WebviewWindowBuilder};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EngineStatus {
    running: bool,
    pid: Option<u32>,
}

/// Run blocking work off the async runtime and flatten the join result.
async fn blocking<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r)
}

/// Call an engine method and await its result. `Err` carries the engine's error message.
#[tauri::command]
async fn vsp_call(
    engine: State<'_, Engine>,
    method: String,
    params: Value,
) -> Result<Value, String> {
    engine.call(method, params).await
}

/// Kill and relaunch the engine.
#[tauri::command]
async fn engine_restart(engine: State<'_, Engine>) -> Result<(), String> {
    let e = engine.inner().clone();
    blocking(move || e.restart()).await
}

#[tauri::command]
fn engine_status(engine: State<'_, Engine>) -> EngineStatus {
    let (running, pid) = engine.status();
    EngineStatus { running, pid }
}

#[tauri::command]
fn get_settings(engine: State<'_, Engine>) -> Settings {
    engine.settings()
}

/// Persist settings; restarts the engine when python or openvspRoot changed.
#[tauri::command]
async fn set_settings(engine: State<'_, Engine>, settings: Settings) -> Result<(), String> {
    let e = engine.inner().clone();
    blocking(move || e.apply_settings(settings)).await
}

/// Open an extra window (e.g. the cross-section editor pop-out) at `url`,
/// a path inside the app bundle such as "index.html#/xsec".
#[tauri::command]
async fn open_window(
    app: AppHandle,
    label: String,
    title: String,
    url: String,
) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(&label) {
        existing.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
        .title(title)
        .inner_size(1000.0, 720.0)
        .min_inner_size(640.0, 480.0)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let config_path = app.path().app_config_dir()?.join("settings.json");
            let settings = settings::load(&config_path);
            let engine = Engine::new(app.handle().clone(), config_path, settings);
            // Failure is logged as engine://log; the UI can retry via engine_restart.
            let _ = engine.start();
            app.manage(engine);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            vsp_call,
            engine_restart,
            engine_status,
            get_settings,
            set_settings,
            open_window
        ])
        .build(tauri::generate_context!())
        .expect("error while building OpenVSP Studio");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            app_handle.state::<Engine>().shutdown();
        }
    });
}
