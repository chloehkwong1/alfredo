fn main() {
    // Load .env from project root so env!() macros can read secrets at compile time
    let env_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.env");
    if env_path.exists() {
        let Ok(contents) = std::fs::read_to_string(&env_path) else {
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
        println!("cargo:rerun-if-changed={}", env_path.display());
    }

    tauri_build::build()
}
