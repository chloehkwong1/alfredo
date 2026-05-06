//! Emits `schemas/alfredo.schema.json` from `RepoSharedConfig`.
//! Run from the repo root:
//!   cargo run --manifest-path src-tauri/Cargo.toml --bin gen_schema
//! Add `--check` to fail if the committed schema is stale.

use std::env;
use std::fs;
use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let schema = schemars::schema_for!(alfredo_lib::types::RepoSharedConfig);
    let json = serde_json::to_string_pretty(&schema)?;

    // schemas/ at the repo root, not src-tauri/.
    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.pop(); // src-tauri -> repo root
    path.push("schemas");
    fs::create_dir_all(&path)?;
    path.push("alfredo.schema.json");

    let check_only = env::args().any(|a| a == "--check");
    if check_only {
        let existing = fs::read_to_string(&path).unwrap_or_default();
        if existing.trim() != json.trim() {
            eprintln!("schema is stale; re-run `cargo run --bin gen_schema`");
            std::process::exit(1);
        }
    } else {
        fs::write(&path, json)?;
        println!("wrote {}", path.display());
    }
    Ok(())
}
