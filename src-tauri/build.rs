fn main() {
    // Load .env from project root so env!() macros can read secrets at compile time
    // CI has no .env — it passes LINEAR_* through the process env instead, so a
    // missing/unreadable file is only a warning here, not an error.
    let env_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.env");
    // Emitted unconditionally (works for not-yet-existing paths): once any
    // rerun-if directive exists — tauri_build emits its own — cargo stops
    // rerunning on "anything changed", so without these a credless build
    // stays cached even after .env is created or LINEAR_* is exported.
    println!("cargo:rerun-if-changed={}", env_path.display());
    println!("cargo:rerun-if-env-changed=LINEAR_CLIENT_ID");
    println!("cargo:rerun-if-env-changed=LINEAR_CLIENT_SECRET");
    if env_path.exists() {
        let Ok(contents) = std::fs::read_to_string(&env_path) else {
            println!(
                "cargo:warning=failed to read {} — LINEAR_* will not be baked into this build",
                env_path.display()
            );
            tauri_build::build();
            return;
        };
        for line in contents.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if let Some((key, value)) = line.split_once('=') {
                println!("cargo:rustc-env={}={}", key.trim(), value.trim());
            }
        }
    } else if std::env::var("LINEAR_CLIENT_ID").is_err() {
        println!(
            "cargo:warning={} not found and LINEAR_CLIENT_ID unset — Linear OAuth will be dead in this build",
            env_path.display()
        );
    }

    tauri_build::build()
}
