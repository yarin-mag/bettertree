use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("git error: {0}")]
    Git(#[from] git2::Error),
    #[error("repo not found: {0}")]
    RepoNotFound(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("could not determine app data directory")]
    NoDataDir,
    #[error("{0}")]
    Operation(String),
    /// Checkout blocked by uncommitted changes. Serialized with a code so the
    /// UI can offer stash/discard/worktree instead of just showing the text.
    #[error("{0}")]
    DirtyWorkdir(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        match self {
            AppError::DirtyWorkdir(message) => {
                use serde::ser::SerializeMap;
                let mut map = serializer.serialize_map(Some(2))?;
                map.serialize_entry("code", "dirty_workdir")?;
                map.serialize_entry("message", message)?;
                map.end()
            }
            _ => serializer.serialize_str(&self.to_string()),
        }
    }
}
