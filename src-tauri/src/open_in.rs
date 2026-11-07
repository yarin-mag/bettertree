use crate::error::AppError;
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct OpenTarget {
    pub id: String,
    pub label: String,
}

/// Apps offered in the "Open in…" menu: (id, menu label, bundle name without `.app`).
const APPS: [(&str, &str, &str); 6] = [
    ("vscode", "VS Code", "Visual Studio Code"),
    ("cursor", "Cursor", "Cursor"),
    ("terminal", "Terminal", "Terminal"),
    ("iterm", "iTerm", "iTerm"),
    ("ghostty", "Ghostty", "Ghostty"),
    ("xcode", "Xcode", "Xcode"),
];

/// Where macOS apps normally live.
pub fn default_app_roots() -> Vec<PathBuf> {
    let mut roots = vec![PathBuf::from("/Applications")];
    if let Ok(home) = std::env::var("HOME") {
        roots.push(PathBuf::from(home).join("Applications"));
    }
    roots.push(PathBuf::from("/System/Applications"));
    roots.push(PathBuf::from("/System/Applications/Utilities"));
    roots
}

/// An Xcode workspace or project to open for this repo: looked for in `ios/`
/// first, then the repo root; a workspace wins over a project in the same folder.
pub fn find_xcode_project(repo: &Path) -> Option<PathBuf> {
    for dir in [repo.join("ios"), repo.to_path_buf()] {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        let mut names: Vec<String> = entries
            .flatten()
            .filter_map(|e| e.file_name().into_string().ok())
            .collect();
        names.sort();
        for ext in [".xcworkspace", ".xcodeproj"] {
            if let Some(name) = names.iter().find(|n| n.ends_with(ext)) {
                return Some(dir.join(name));
            }
        }
    }
    None
}

fn app_installed(roots: &[PathBuf], bundle: &str) -> bool {
    roots.iter().any(|r| r.join(format!("{bundle}.app")).is_dir())
}

/// The targets to offer for `repo`: installed apps (Xcode only when the repo has
/// a project), then Finder, which is always available.
pub fn detect_targets(roots: &[PathBuf], repo: &Path) -> Vec<OpenTarget> {
    let mut out: Vec<OpenTarget> = APPS
        .iter()
        .filter(|(id, _, bundle)| {
            app_installed(roots, bundle) && (*id != "xcode" || find_xcode_project(repo).is_some())
        })
        .map(|(id, label, _)| OpenTarget { id: id.to_string(), label: label.to_string() })
        .collect();
    out.push(OpenTarget { id: "finder".into(), label: "Finder".into() });
    out
}

/// The program and arguments that open `path` in target `id`. Arguments are
/// passed one by one, never through a shell.
pub fn command_for(id: &str, path: &Path) -> Result<(String, Vec<String>), AppError> {
    let arg = |p: &Path| p.to_string_lossy().to_string();
    if id == "finder" {
        return Ok(("open".into(), vec!["-R".into(), "--".into(), arg(path)]));
    }
    let Some((_, _, bundle)) = APPS.iter().find(|(app_id, _, _)| *app_id == id) else {
        return Err(AppError::Operation(format!("unknown target: {id}")));
    };
    let target = if id == "xcode" {
        find_xcode_project(path)
            .ok_or_else(|| AppError::Operation("no Xcode project found in this repository".into()))?
    } else {
        path.to_path_buf()
    };
    // `--` ends option parsing so the path can never be read as an `open` option.
    Ok(("open".into(), vec!["-a".into(), bundle.to_string(), "--".into(), arg(&target)]))
}

/// The folder to open, checked: it must be an absolute path to an existing git
/// repository root. Anything else (a file such as a script, a plain folder, a
/// relative or empty path) is refused, so this cannot be used to make Terminal or
/// another app run or open arbitrary things. Returns the canonical path.
pub fn validate_open_path(repo_path: &str) -> Result<PathBuf, AppError> {
    let path = Path::new(repo_path);
    if !path.is_absolute() {
        return Err(AppError::Operation(format!("not an absolute path: {repo_path}")));
    }
    let canonical = std::fs::canonicalize(path)
        .map_err(|_| AppError::Operation(format!("path does not exist: {repo_path}")))?;
    if !canonical.is_dir() {
        return Err(AppError::Operation(format!("not a folder: {repo_path}")));
    }
    if git2::Repository::open(&canonical).is_err() {
        return Err(AppError::Operation(format!("not a git repository: {repo_path}")));
    }
    Ok(canonical)
}

pub fn list_open_targets(repo_path: &str) -> Vec<OpenTarget> {
    if !cfg!(target_os = "macos") {
        return vec![];
    }
    detect_targets(&default_app_roots(), Path::new(repo_path))
}

pub fn open_in(id: &str, repo_path: &str) -> Result<(), AppError> {
    if !cfg!(target_os = "macos") {
        return Err(AppError::Operation("opening in other apps is only supported on macOS".into()));
    }
    let path = validate_open_path(repo_path)?;
    let (program, args) = command_for(id, &path)?;
    let output = std::process::Command::new(program).args(&args).output()?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(AppError::Operation(format!("could not open: {}", stderr.trim())))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roots_with(apps: &[&str]) -> (tempfile::TempDir, Vec<PathBuf>) {
        let dir = tempfile::TempDir::new().unwrap();
        for app in apps {
            std::fs::create_dir_all(dir.path().join(format!("{app}.app"))).unwrap();
        }
        let roots = vec![dir.path().to_path_buf()];
        (dir, roots)
    }

    fn ids(targets: &[OpenTarget]) -> Vec<&str> {
        targets.iter().map(|t| t.id.as_str()).collect()
    }

    fn repo_with(files: &[&str]) -> tempfile::TempDir {
        let dir = tempfile::TempDir::new().unwrap();
        for f in files {
            let p = dir.path().join(f);
            std::fs::create_dir_all(&p).unwrap();
        }
        dir
    }

    #[test]
    fn lists_only_installed_apps_then_finder() {
        let (_d, roots) = roots_with(&["Visual Studio Code", "Ghostty"]);
        let repo = repo_with(&[]);
        let targets = detect_targets(&roots, repo.path());
        assert_eq!(ids(&targets), vec!["vscode", "ghostty", "finder"]);
        assert_eq!(targets[0].label, "VS Code");
    }

    #[test]
    fn finds_apps_in_any_root() {
        let (_a, a) = roots_with(&["Cursor"]);
        let (_b, b) = roots_with(&["iTerm"]);
        let roots = [a, b].concat();
        let repo = repo_with(&[]);
        assert_eq!(ids(&detect_targets(&roots, repo.path())), vec!["cursor", "iterm", "finder"]);
    }

    #[test]
    fn with_nothing_installed_only_finder_is_offered() {
        let (_d, roots) = roots_with(&[]);
        let repo = repo_with(&[]);
        assert_eq!(ids(&detect_targets(&roots, repo.path())), vec!["finder"]);
    }

    #[test]
    fn xcode_needs_both_the_app_and_a_project() {
        let (_d, roots) = roots_with(&["Xcode"]);
        let with_project = repo_with(&["ios/App.xcworkspace"]);
        let without = repo_with(&["src"]);
        assert_eq!(ids(&detect_targets(&roots, with_project.path())), vec!["xcode", "finder"]);
        assert_eq!(ids(&detect_targets(&roots, without.path())), vec!["finder"]);

        let (_d2, no_xcode) = roots_with(&[]);
        assert_eq!(ids(&detect_targets(&no_xcode, with_project.path())), vec!["finder"]);
    }

    #[test]
    fn xcode_project_search_prefers_workspaces_and_the_ios_folder_and_skips_pods() {
        let repo = repo_with(&["ios/App.xcodeproj", "ios/App.xcworkspace", "ios/Pods/Pods.xcodeproj", "Root.xcodeproj"]);
        assert_eq!(find_xcode_project(repo.path()), Some(repo.path().join("ios/App.xcworkspace")));

        let only_project = repo_with(&["ios/App.xcodeproj", "ios/Pods/Pods.xcodeproj"]);
        assert_eq!(find_xcode_project(only_project.path()), Some(only_project.path().join("ios/App.xcodeproj")));

        let at_root = repo_with(&["Root.xcodeproj"]);
        assert_eq!(find_xcode_project(at_root.path()), Some(at_root.path().join("Root.xcodeproj")));

        assert_eq!(find_xcode_project(repo_with(&["src"]).path()), None);
    }

    #[test]
    fn builds_open_commands_with_separate_arguments() {
        let p = Path::new("/work/my repo");
        assert_eq!(
            command_for("vscode", p).unwrap(),
            ("open".to_string(), vec!["-a".to_string(), "Visual Studio Code".to_string(), "--".to_string(), "/work/my repo".to_string()])
        );
        assert_eq!(
            command_for("finder", p).unwrap(),
            ("open".to_string(), vec!["-R".to_string(), "--".to_string(), "/work/my repo".to_string()])
        );
        assert_eq!(
            command_for("ghostty", p).unwrap().1,
            vec!["-a".to_string(), "Ghostty".to_string(), "--".to_string(), "/work/my repo".to_string()]
        );
    }

    #[test]
    fn a_path_that_looks_like_an_option_or_shell_stays_one_argument() {
        let p = Path::new("-a evil; rm -rf ~");
        let (_, args) = command_for("cursor", p).unwrap();
        // `--` ends option parsing, so `open` treats the path as a file even though it starts with '-'.
        assert_eq!(args, vec!["-a".to_string(), "Cursor".to_string(), "--".to_string(), "-a evil; rm -rf ~".to_string()]);
        let (_, finder) = command_for("finder", p).unwrap();
        assert_eq!(finder, vec!["-R".to_string(), "--".to_string(), "-a evil; rm -rf ~".to_string()]);
    }

    #[test]
    fn xcode_opens_the_project_not_the_folder_and_errors_without_one() {
        let repo = repo_with(&["ios/App.xcworkspace"]);
        let (_, args) = command_for("xcode", repo.path()).unwrap();
        assert_eq!(args[1], "Xcode");
        assert_eq!(args[2], "--");
        assert_eq!(args[3], repo.path().join("ios/App.xcworkspace").to_string_lossy());

        let empty = repo_with(&["src"]);
        assert!(command_for("xcode", empty.path()).is_err());
    }

    #[test]
    fn an_unknown_target_is_refused() {
        assert!(command_for("rm -rf", Path::new("/tmp")).is_err());
        assert!(command_for("", Path::new("/tmp")).is_err());
    }

    #[test]
    fn opening_a_path_that_does_not_exist_is_refused_before_anything_runs() {
        if cfg!(target_os = "macos") {
            let err = open_in("finder", "/definitely/not/here/xyz").unwrap_err();
            assert!(err.to_string().contains("does not exist"), "got {err}");
        }
    }

    #[test]
    fn only_an_existing_absolute_git_repository_folder_may_be_opened() {
        let repo = tempfile::TempDir::new().unwrap();
        git2::Repository::init(repo.path()).unwrap();
        assert!(validate_open_path(repo.path().to_str().unwrap()).is_ok());

        // a plain folder that is not a repository
        let plain = tempfile::TempDir::new().unwrap();
        assert!(validate_open_path(plain.path().to_str().unwrap()).is_err());

        // a file, even inside a repository (e.g. a script Terminal would run)
        let script = repo.path().join("evil.command");
        std::fs::write(&script, "#!/bin/sh\n").unwrap();
        assert!(validate_open_path(script.to_str().unwrap()).is_err());

        // relative and empty paths
        assert!(validate_open_path("relative/dir").is_err());
        assert!(validate_open_path("-R").is_err());
        assert!(validate_open_path("").is_err());
        assert!(validate_open_path("/definitely/not/here/xyz").is_err());
    }

    #[test]
    fn the_validated_path_is_canonical() {
        let repo = tempfile::TempDir::new().unwrap();
        git2::Repository::init(repo.path()).unwrap();
        let sneaky = format!("{}/./", repo.path().display());
        let got = validate_open_path(&sneaky).unwrap();
        assert_eq!(got, std::fs::canonicalize(repo.path()).unwrap());
    }
}
