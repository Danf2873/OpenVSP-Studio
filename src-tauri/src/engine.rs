//! Supervises the Python JSON-RPC engine process and bridges it to the frontend.
//!
//! Wire format: newline-delimited JSON on the engine's stdin/stdout.
//!   request  -> {"id", "method", "params"}
//!   response <- {"id", "result"} | {"id", "error": {"message", ...}}
//!   event    <- {"event", "data"}   (forwarded as "engine://event")
//!   stderr   -> "engine://log"

use crate::settings::{self, Settings};
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStderr, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

const MAX_RESTARTS_PER_MINUTE: usize = 5;
const RESTART_DELAY: Duration = Duration::from_secs(1);
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

type Reply = Result<Value, String>;

/// A line read from the engine's stdout, classified.
#[derive(Debug, PartialEq)]
pub enum Incoming {
    Response { id: u64, result: Reply },
    Event { event: String, data: Value },
    Invalid(String),
}

/// Route one stdout line: has "id" -> response, has "event" -> event.
pub fn classify(line: &str) -> Incoming {
    let v: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(e) => return Incoming::Invalid(format!("{e}: {line}")),
    };
    if let Some(id) = v.get("id").and_then(Value::as_u64) {
        let result = match v.get("error") {
            Some(err) if !err.is_null() => Err(err
                .get("message")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .unwrap_or_else(|| err.to_string())),
            _ => Ok(v.get("result").cloned().unwrap_or(Value::Null)),
        };
        return Incoming::Response { id, result };
    }
    if let Some(event) = v.get("event").and_then(Value::as_str) {
        return Incoming::Event {
            event: event.to_owned(),
            data: v.get("data").cloned().unwrap_or(Value::Null),
        };
    }
    Incoming::Invalid(format!("unrecognized engine message: {line}"))
}

/// Level for an engine log line.
pub fn log_level(line: &str) -> &'static str {
    if line.contains("Traceback") || line.contains("Error") {
        "error"
    } else {
        "info"
    }
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Current child process. `gen` changes whenever a process is started or killed,
/// so a supervisor thread can tell whether its exit was expected.
struct Session {
    gen: u64,
    pid: Option<u32>,
    stdin: Option<ChildStdin>,
}

struct Inner {
    app: AppHandle,
    config_path: PathBuf,
    settings: Mutex<Settings>,
    session: Mutex<Session>,
    /// Serializes spawn / kill / restart decisions.
    lifecycle: Mutex<()>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Reply>>>,
    next_id: AtomicU64,
    restarts: Mutex<VecDeque<Instant>>,
    stopping: AtomicBool,
}

/// Tauri-managed handle to the engine supervisor. Cheap to clone.
#[derive(Clone)]
pub struct Engine(Arc<Inner>);

impl Engine {
    pub fn new(app: AppHandle, config_path: PathBuf, settings: Settings) -> Engine {
        Engine(Arc::new(Inner {
            app,
            config_path,
            settings: Mutex::new(settings),
            session: Mutex::new(Session { gen: 0, pid: None, stdin: None }),
            lifecycle: Mutex::new(()),
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            restarts: Mutex::new(VecDeque::new()),
            stopping: AtomicBool::new(false),
        }))
    }

    pub fn settings(&self) -> Settings {
        lock(&self.0.settings).clone()
    }

    /// (running, pid)
    pub fn status(&self) -> (bool, Option<u32>) {
        let s = lock(&self.0.session);
        (s.pid.is_some(), s.pid)
    }

    /// Start the engine if it is not already running.
    pub fn start(&self) -> Result<(), String> {
        let result = {
            let _lc = lock(&self.0.lifecycle);
            if self.status().0 {
                return Ok(());
            }
            self.spawn_locked()
        };
        if let Err(e) = &result {
            self.log("error", e);
        }
        result
    }

    /// Kill the current engine (if any) and start a fresh one.
    pub fn restart(&self) -> Result<(), String> {
        let result = {
            let _lc = lock(&self.0.lifecycle);
            self.kill_locked();
            self.spawn_locked()
        };
        if let Err(e) = &result {
            self.log("error", e);
        }
        result
    }

    /// Persist new settings; restart the engine if the interpreter or OpenVSP root changed.
    pub fn apply_settings(&self, new: Settings) -> Result<(), String> {
        settings::save(&self.0.config_path, &new)?;
        let changed = {
            let mut cur = lock(&self.0.settings);
            let changed = cur.python != new.python || cur.openvsp_root != new.openvsp_root;
            *cur = new;
            changed
        };
        if changed {
            self.restart()
        } else {
            Ok(())
        }
    }

    /// Send a request and await its response. No timeout; long jobs return a jobId at once.
    pub async fn call(&self, method: String, params: Value) -> Reply {
        let id = self.0.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        lock(&self.0.pending).insert(id, tx);

        let line = json!({ "id": id, "method": method, "params": params }).to_string();
        let me = self.clone();
        let written = tauri::async_runtime::spawn_blocking(move || me.write_line(&line))
            .await
            .map_err(|e| e.to_string())
            .and_then(|r| r);
        if let Err(e) = written {
            lock(&self.0.pending).remove(&id);
            return Err(e);
        }
        match rx.await {
            Ok(reply) => reply,
            Err(_) => Err("engine restarted".to_string()),
        }
    }

    /// Stop the engine for good (app exit).
    pub fn shutdown(&self) {
        self.0.stopping.store(true, Ordering::SeqCst);
        let _lc = lock(&self.0.lifecycle);
        self.kill_locked();
    }

    fn emit(&self, event: &str, payload: Value) {
        let _ = self.0.app.emit(event, payload);
    }

    fn log(&self, level: &str, text: &str) {
        self.emit("engine://log", json!({ "level": level, "text": text }));
    }

    fn write_line(&self, line: &str) -> Result<(), String> {
        let mut s = lock(&self.0.session);
        let stdin = s
            .stdin
            .as_mut()
            .ok_or_else(|| "engine is not running".to_string())?;
        let mut buf = Vec::with_capacity(line.len() + 1);
        buf.extend_from_slice(line.as_bytes());
        buf.push(b'\n');
        stdin
            .write_all(&buf)
            .map_err(|e| format!("engine write failed: {e}"))?;
        stdin.flush().map_err(|e| format!("engine write failed: {e}"))
    }

    fn fail_pending(&self, message: &str) {
        let drained: Vec<_> = lock(&self.0.pending).drain().collect();
        for (_, tx) in drained {
            let _ = tx.send(Err(message.to_string()));
        }
    }

    /// Caller holds `lifecycle`. Bumps the generation so the old supervisor stays quiet.
    fn kill_locked(&self) {
        let pid = {
            let mut s = lock(&self.0.session);
            s.gen += 1;
            s.stdin = None;
            s.pid.take()
        };
        self.fail_pending("engine restarted");
        if let Some(pid) = pid {
            kill_tree(pid);
            self.emit("engine://status", json!({ "running": false, "code": Value::Null }));
        }
    }

    /// Caller holds `lifecycle`.
    fn spawn_locked(&self) -> Result<(), String> {
        let st = self.settings();
        let root = PathBuf::from(&st.openvsp_root);
        let script = root.join("openvsp_gui").join("engine").join("vsp_engine.py");

        // Unsaved models write solver output (VSPAERO etc.) to the working dir, which
        // must be writable even when installed under Program Files.
        let work = std::env::temp_dir().join("OpenVSP Studio");
        let _ = std::fs::create_dir_all(&work);

        let mut cmd = Command::new(&st.python);
        cmd.arg("-u")
            .arg(&script)
            .current_dir(&work)
            .env("OPENVSP_ROOT", &root)
            .env("PYTHONIOENCODING", "utf-8")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = cmd.spawn().map_err(|e| {
            format!("failed to start engine `{} -u {}`: {e}", st.python, script.display())
        })?;
        let pid = child.id();
        let (stdin, stdout, stderr) = match (child.stdin.take(), child.stdout.take(), child.stderr.take()) {
            (Some(i), Some(o), Some(e)) => (i, o, e),
            _ => {
                kill_tree(pid);
                return Err("engine started without piped stdio".to_string());
            }
        };

        let gen = {
            let mut s = lock(&self.0.session);
            s.gen += 1;
            s.pid = Some(pid);
            s.stdin = Some(stdin);
            s.gen
        };

        let me = self.clone();
        thread::Builder::new()
            .name("engine-stdout".into())
            .spawn(move || me.read_stdout(stdout))
            .map_err(|e| e.to_string())?;
        let me = self.clone();
        thread::Builder::new()
            .name("engine-stderr".into())
            .spawn(move || me.read_stderr(stderr))
            .map_err(|e| e.to_string())?;
        let me = self.clone();
        thread::Builder::new()
            .name("engine-supervisor".into())
            .spawn(move || me.supervise(child, gen))
            .map_err(|e| e.to_string())?;

        self.emit("engine://status", json!({ "running": true, "pid": pid }));
        Ok(())
    }

    fn read_stdout(&self, stdout: ChildStdout) {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            if line.trim().is_empty() {
                continue;
            }
            match classify(&line) {
                Incoming::Response { id, result } => {
                    let tx = lock(&self.0.pending).remove(&id);
                    if let Some(tx) = tx {
                        let _ = tx.send(result);
                    }
                }
                Incoming::Event { event, data } => {
                    self.emit("engine://event", json!({ "event": event, "data": data }));
                }
                Incoming::Invalid(msg) => {
                    self.log(log_level(&msg), &msg);
                }
            }
        }
    }

    fn read_stderr(&self, stderr: ChildStderr) {
        for line in BufReader::new(stderr).lines() {
            let Ok(line) = line else { break };
            self.log(log_level(&line), &line);
        }
    }

    /// Owns the Child: waits for exit, then either stays quiet (expected) or
    /// reports the death and schedules an automatic restart.
    fn supervise(&self, mut child: Child, gen: u64) {
        let code = child.wait().ok().and_then(|s| s.code());
        {
            let mut s = lock(&self.0.session);
            if s.gen != gen {
                return; // killed or replaced on purpose
            }
            s.pid = None;
            s.stdin = None;
        }
        self.fail_pending("engine restarted");
        self.emit("engine://status", json!({ "running": false, "code": code }));
        if !self.0.stopping.load(Ordering::SeqCst) {
            self.auto_restart(gen);
        }
    }

    fn auto_restart(&self, dead_gen: u64) {
        {
            let mut times = lock(&self.0.restarts);
            let now = Instant::now();
            while times
                .front()
                .is_some_and(|t| now.duration_since(*t) > Duration::from_secs(60))
            {
                times.pop_front();
            }
            if times.len() >= MAX_RESTARTS_PER_MINUTE {
                self.log(
                    "error",
                    "engine keeps crashing (5 restarts in a minute); not restarting automatically. Use engine_restart to retry.",
                );
                return;
            }
            times.push_back(now);
        }
        thread::sleep(RESTART_DELAY);
        let _lc = lock(&self.0.lifecycle);
        {
            let s = lock(&self.0.session);
            if s.gen != dead_gen || s.pid.is_some() || self.0.stopping.load(Ordering::SeqCst) {
                return; // someone already restarted or stopped the engine
            }
        }
        if let Err(e) = self.spawn_locked() {
            self.log("error", &e);
        }
    }
}

/// Kill a process and its children (the engine may spawn VSPAERO).
fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill").args(["-9", &pid.to_string()]).status();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes_response_ok() {
        match classify(r#"{"id":7,"result":"pong"}"#) {
            Incoming::Response { id, result } => {
                assert_eq!(id, 7);
                assert_eq!(result, Ok(json!("pong")));
            }
            other => panic!("expected response, got {other:?}"),
        }
    }

    #[test]
    fn routes_response_error_message() {
        let line = r#"{"id":3,"error":{"code":1,"message":"no model","traceback":null}}"#;
        match classify(line) {
            Incoming::Response { id, result } => {
                assert_eq!(id, 3);
                assert_eq!(result, Err("no model".to_string()));
            }
            other => panic!("expected response, got {other:?}"),
        }
    }

    #[test]
    fn routes_event() {
        match classify(r#"{"event":"ready","data":{"version":"3.54.0"}}"#) {
            Incoming::Event { event, data } => {
                assert_eq!(event, "ready");
                assert_eq!(data["version"], "3.54.0");
            }
            other => panic!("expected event, got {other:?}"),
        }
    }

    #[test]
    fn invalid_lines_are_not_routed() {
        assert!(matches!(classify("not json"), Incoming::Invalid(_)));
        assert!(matches!(classify(r#"{"foo":1}"#), Incoming::Invalid(_)));
    }

    #[test]
    fn stderr_level() {
        assert_eq!(log_level("Traceback (most recent call last):"), "error");
        assert_eq!(log_level("ValueError: bad"), "error");
        assert_eq!(log_level("loaded geometry"), "info");
    }
}
