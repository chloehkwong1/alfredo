//! Thin wrapper around the OS keychain for storing secrets.
//!
//! Service name is fixed to the app bundle ID so entries are grouped
//! together in Keychain Access and Credential Manager.
//!
//! # Safety of blocking calls
//! All functions are synchronous. They are safe to call from async
//! contexts because the OS keychain API completes without blocking
//! on the main thread.

use crate::types::AppError;

const SERVICE: &str = "com.alfredo.app";

/// Store `secret` under `account` in the OS keychain.
/// Overwrites any existing entry for the same account.
pub fn store(account: &str, secret: &str) -> Result<(), AppError> {
    let entry = keyring::Entry::new(SERVICE, account)
        .map_err(|e| AppError::Config(format!("keychain entry error for '{account}': {e}")))?;
    entry
        .set_password(secret)
        .map_err(|e| AppError::Config(format!("keychain write error for '{account}': {e}")))
}

/// Retrieve the secret stored under `account`.
/// Returns `None` if no entry exists (not an error).
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

/// Delete the keychain entry for `account`. No-op if it doesn't exist.
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
