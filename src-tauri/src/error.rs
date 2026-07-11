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
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
