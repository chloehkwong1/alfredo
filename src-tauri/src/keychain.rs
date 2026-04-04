//! Thin wrapper around the OS keychain for storing secrets.
//!
//! Service name is fixed to the app bundle ID so entries are grouped
//! together in Keychain Access and Credential Manager.
//!
//! In debug builds, secrets are stored in a local file instead of the
//! OS keychain to avoid repeated macOS permission prompts caused by
//! unsigned dev binaries. Release builds always use the real keychain.

use crate::types::AppError;

const SERVICE: &str = "com.alfredo.app";

// ── Release builds: real OS keychain ────────────────────────────────

#[cfg(not(debug_assertions))]
pub fn store(account: &str, secret: &str) -> Result<(), AppError> {
    let entry = keyring::Entry::new(SERVICE, account)
        .map_err(|e| AppError::Config(format!("keychain entry error for '{account}': {e}")))?;
    entry
        .set_password(secret)
        .map_err(|e| AppError::Config(format!("keychain write error for '{account}': {e}")))
}

#[cfg(not(debug_assertions))]
pub fn retrieve(account: &str) -> Result<Option<String>, AppError> {
    let entry = keyring::Entry::new(SERVICE, account)
        .map_err(|e| AppError::Config(format!("keychain entry error for '{account}': {e}")))?;
    match entry.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::Config(format!(
            "keychain read error for '{account}': {e}"
        ))),
    }
}

#[cfg(not(debug_assertions))]
pub fn delete(account: &str) -> Result<(), AppError> {
    let entry = keyring::Entry::new(SERVICE, account)
        .map_err(|e| AppError::Config(format!("keychain entry error for '{account}': {e}")))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::Config(format!(
            "keychain delete error for '{account}': {e}"
        ))),
    }
}

// ── Debug builds: file-based secrets ────────────────────────────────

#[cfg(debug_assertions)]
fn secrets_path() -> Result<std::path::PathBuf, AppError> {
    let base = std::env::var("HOME")
        .map(std::path::PathBuf::from)
        .map_err(|_| AppError::Config("HOME environment variable is not set".into()))?;
    Ok(base
        .join("Library")
        .join("Application Support")
        .join(SERVICE)
        .join("dev-secrets.json"))
}

#[cfg(debug_assertions)]
fn load_secrets() -> Result<std::collections::HashMap<String, String>, AppError> {
    let path = secrets_path()?;
    match std::fs::read_to_string(&path) {
        Ok(s) if s.trim().is_empty() => Ok(Default::default()),
        Ok(s) => serde_json::from_str(&s)
            .map_err(|e| AppError::Config(format!("failed to parse secrets file: {e}"))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Default::default()),
        Err(e) => Err(AppError::Config(format!("failed to read secrets file: {e}"))),
    }
}

#[cfg(debug_assertions)]
fn save_secrets(secrets: &std::collections::HashMap<String, String>) -> Result<(), AppError> {
    use std::os::unix::fs::PermissionsExt;

    let path = secrets_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| AppError::Config(format!("failed to create secrets dir: {e}")))?;
    }
    let json = serde_json::to_string_pretty(secrets)
        .map_err(|e| AppError::Config(format!("failed to serialize secrets: {e}")))?;
    std::fs::write(&path, &json)
        .map_err(|e| AppError::Config(format!("failed to write secrets file: {e}")))?;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
        .map_err(|e| AppError::Config(format!("failed to set secrets file permissions: {e}")))?;
    Ok(())
}

#[cfg(debug_assertions)]
pub fn store(account: &str, secret: &str) -> Result<(), AppError> {
    let mut secrets = load_secrets()?;
    secrets.insert(account.to_string(), secret.to_string());
    save_secrets(&secrets)
}

#[cfg(debug_assertions)]
pub fn retrieve(account: &str) -> Result<Option<String>, AppError> {
    Ok(load_secrets()?.get(account).cloned())
}

#[cfg(debug_assertions)]
pub fn delete(account: &str) -> Result<(), AppError> {
    let mut secrets = load_secrets()?;
    secrets.remove(account);
    save_secrets(&secrets)
}
