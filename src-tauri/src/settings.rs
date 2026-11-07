use crate::error::AppError;
use notify::{RecursiveMode, Watcher};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::mpsc::channel;

pub fn settings_path(data_dir: &Path) -> PathBuf {
    data_dir.join("settings.json")
}

pub fn default_settings() -> Value {
    json!({
        "theme": {
            "active": { "type": "preset", "id": "github-dark" },
            "customThemes": []
        },
        "fontSize": { "ui": 12, "diffView": 14 },
        "diffViewTheme": null
    })
}

pub fn read_or_init_settings(path: &Path) -> Result<Value, AppError> {
    if !path.exists() {
        let defaults = default_settings();
        write_settings_to_disk(path, &defaults)?;
        return Ok(defaults);
    }
    let raw = std::fs::read_to_string(path)?;
    serde_json::from_str(&raw)
        .map_err(|e| AppError::Operation(format!("invalid settings.json: {e}")))
}

pub fn write_settings_to_disk(path: &Path, value: &Value) -> Result<(), AppError> {
    if !value.is_object() {
        return Err(AppError::Operation("settings must be a JSON object".to_string()));
    }
    let pretty = serde_json::to_string_pretty(value)
        .map_err(|e| AppError::Operation(format!("failed to serialize settings: {e}")))?;
    std::fs::write(path, pretty)?;
    Ok(())
}

pub fn spawn_watcher<F>(path: PathBuf, on_change: F)
where
    F: Fn(Value) + Send + 'static,
{
    std::thread::spawn(move || {
        let Some(dir) = path.parent().map(|p| p.to_path_buf()) else {
            eprintln!("settings watcher: no parent dir for {path:?}");
            return;
        };
        let (tx, rx) = channel();
        let mut watcher = match notify::recommended_watcher(tx) {
            Ok(w) => w,
            Err(e) => {
                eprintln!("settings watcher failed to start: {e}");
                return;
            }
        };
        if watcher.watch(&dir, RecursiveMode::NonRecursive).is_err() {
            eprintln!("settings watcher failed to watch {dir:?}");
            return;
        }
        for res in rx {
            let event = match res {
                Ok(e) => e,
                Err(e) => {
                    eprintln!("settings watcher error: {e}");
                    continue;
                }
            };
            if !event.kind.is_modify() && !event.kind.is_create() {
                continue;
            }
            if !event.paths.iter().any(|p| p.file_name() == path.file_name()) {
                continue;
            }
            match read_or_init_settings(&path) {
                Ok(value) => on_change(value),
                Err(e) => eprintln!("settings.json invalid, ignoring: {e}"),
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn read_or_init_settings_creates_defaults_when_missing() {
        let dir = TempDir::new().unwrap();
        let path = settings_path(dir.path());
        assert!(!path.exists());

        let value = read_or_init_settings(&path).unwrap();

        assert!(path.exists());
        assert_eq!(value["fontSize"]["ui"], 12);
        assert_eq!(value["theme"]["active"]["id"], "github-dark");
    }

    #[test]
    fn write_then_read_roundtrips() {
        let dir = TempDir::new().unwrap();
        let path = settings_path(dir.path());
        let mut value = default_settings();
        value["fontSize"]["ui"] = json!(16);

        write_settings_to_disk(&path, &value).unwrap();
        let read_back = read_or_init_settings(&path).unwrap();

        assert_eq!(read_back["fontSize"]["ui"], 16);
    }

    #[test]
    fn write_settings_rejects_non_object() {
        let dir = TempDir::new().unwrap();
        let path = settings_path(dir.path());

        let result = write_settings_to_disk(&path, &json!([1, 2, 3]));

        assert!(result.is_err());
        assert!(!path.exists());
    }

    #[test]
    fn read_or_init_settings_errors_on_malformed_json_without_overwriting() {
        let dir = TempDir::new().unwrap();
        let path = settings_path(dir.path());
        std::fs::write(&path, "not json").unwrap();

        let result = read_or_init_settings(&path);

        assert!(result.is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "not json");
    }

    #[test]
    fn spawn_watcher_emits_parsed_value_on_change() {
        let dir = TempDir::new().unwrap();
        let path = settings_path(dir.path());
        write_settings_to_disk(&path, &default_settings()).unwrap();

        let (tx, rx) = std::sync::mpsc::channel();
        spawn_watcher(path.clone(), move |value| {
            let _ = tx.send(value);
        });

        // give the watcher a moment to register before the write it must observe
        std::thread::sleep(std::time::Duration::from_millis(500));
        let mut updated = default_settings();
        updated["fontSize"]["ui"] = json!(20);
        write_settings_to_disk(&path, &updated).unwrap();

        let received = rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap();
        assert_eq!(received["fontSize"]["ui"], 20);
    }

    #[test]
    fn spawn_watcher_skips_malformed_json_without_emitting() {
        let dir = TempDir::new().unwrap();
        let path = settings_path(dir.path());
        write_settings_to_disk(&path, &default_settings()).unwrap();

        let (tx, rx) = std::sync::mpsc::channel();
        spawn_watcher(path.clone(), move |value| {
            let _ = tx.send(value);
        });

        std::thread::sleep(std::time::Duration::from_millis(200));
        std::fs::write(&path, "not json").unwrap();

        let result = rx.recv_timeout(std::time::Duration::from_millis(500));
        assert!(result.is_err(), "watcher must not emit for malformed JSON");
    }
}
