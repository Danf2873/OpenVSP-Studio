//! Persistent app settings (JSON in the app config dir) and OpenVSP root discovery.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Density {
    Compact,
    Comfortable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub python: String,
    pub openvsp_root: String,
    pub theme: Theme,
    pub density: Density,
    pub recent_files: Vec<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            python: default_python(),
            openvsp_root: default_openvsp_root().to_string_lossy().into_owned(),
            theme: Theme::System,
            density: Density::Comfortable,
            recent_files: Vec::new(),
        }
    }
}

/// An OpenVSP root holds the vsp.exe launcher and the bundled python/openvsp package.
fn is_openvsp_root(dir: &Path) -> bool {
    dir.join("vsp.exe").is_file() && dir.join("python").join("openvsp").is_dir()
}

/// Strip the Windows verbatim prefix that canonicalize() adds.
fn clean(p: PathBuf) -> PathBuf {
    match p.canonicalize() {
        Ok(c) => {
            let s = c.to_string_lossy().into_owned();
            PathBuf::from(s.strip_prefix(r"\?\").unwrap_or(&s))
        }
        Err(_) => p,
    }
}

/// Directory holding the running executable (where an installer puts resources).
fn exe_dir() -> Option<PathBuf> {
    std::env::current_exe().ok().and_then(|e| e.parent().map(Path::to_path_buf))
}

/// Installed layout: `<install>/openvsp` (resource) holds the OpenVSP files.
fn bundled_root() -> Option<PathBuf> {
    let dir = exe_dir()?.join("openvsp");
    is_openvsp_root(&dir).then(|| clean(dir))
}

/// Installed layout: `<install>/python/python.exe` is the bundled interpreter.
fn bundled_python() -> Option<PathBuf> {
    let py = exe_dir()?.join("python").join("python.exe");
    py.is_file().then(|| clean(py))
}

/// The bundled interpreter when installed, else `python` from PATH.
pub fn default_python() -> String {
    bundled_python()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| "python".to_string())
}

/// Installed: the bundled `openvsp` resource folder. Debug builds: the parent of
/// the project dir (`<root>/openvsp_gui/src-tauri/../..`). Otherwise walk up from
/// the executable until a directory looks like an OpenVSP root.
pub fn default_openvsp_root() -> PathBuf {
    if let Some(root) = bundled_root() {
        return root;
    }
    let dev = clean(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join(".."));
    if cfg!(debug_assertions) && is_openvsp_root(&dev) {
        return dev;
    }
    if let Ok(exe) = std::env::current_exe() {
        for ancestor in exe.ancestors().skip(1) {
            if is_openvsp_root(ancestor) {
                return clean(ancestor.to_path_buf());
            }
        }
    }
    dev
}

/// Replace saved paths that no longer work (e.g. written by a dev build) with defaults.
fn repair(mut s: Settings) -> Settings {
    if !is_openvsp_root(Path::new(&s.openvsp_root)) {
        s.openvsp_root = default_openvsp_root().to_string_lossy().into_owned();
    }
    let py = Path::new(&s.python);
    if s.python == "python" || (py.is_absolute() && !py.is_file()) {
        s.python = default_python();
    }
    s
}

/// Load settings; a missing or unreadable file yields defaults.
pub fn load(path: &Path) -> Settings {
    match std::fs::read_to_string(path) {
        Ok(text) => repair(serde_json::from_str(&text).unwrap_or_else(|e| {
            eprintln!("settings: ignoring invalid {}: {e}", path.display());
            Settings::default()
        })),
        Err(_) => Settings::default(),
    }
}

pub fn save(path: &Path, settings: &Settings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create config dir: {e}"))?;
    }
    let text = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(path, text).map_err(|e| format!("write settings: {e}"))
}
