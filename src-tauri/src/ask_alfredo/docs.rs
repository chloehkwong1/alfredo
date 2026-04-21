use serde::Deserialize;
use std::fs;
use std::path::Path;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Deserialize)]
pub struct FeatureDocFrontmatter {
    pub title: String,
    #[serde(default)]
    pub keywords: Vec<String>,
    #[serde(default)]
    pub ui_path: Option<String>,
}

#[derive(Debug, Clone)]
pub struct FeatureDoc {
    pub frontmatter: FeatureDocFrontmatter,
    pub body: String,
}

fn split_frontmatter(raw: &str) -> Option<(&str, &str)> {
    let stripped = raw.strip_prefix("---\n")?;
    let end = stripped.find("\n---\n")?;
    Some((&stripped[..end], &stripped[end + 5..]))
}

pub fn parse_doc(raw: &str) -> Result<FeatureDoc, String> {
    let (fm, body) = split_frontmatter(raw).ok_or_else(|| "missing frontmatter".to_string())?;
    let frontmatter: FeatureDocFrontmatter =
        serde_yaml::from_str(fm).map_err(|e| format!("bad frontmatter: {e}"))?;
    Ok(FeatureDoc {
        frontmatter,
        body: body.trim().to_string(),
    })
}

pub fn load_all(app: &AppHandle) -> Result<Vec<FeatureDoc>, String> {
    // Tauri encodes resource paths that escape the config dir (e.g.
    // `../docs/features/*.md`) under `_up_/` in the bundled layout.
    let features_dir = app
        .path()
        .resolve("_up_/docs/features", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("resolve docs/features: {e}"))?;
    load_from_dir(&features_dir)
}

fn load_from_dir(dir: &Path) -> Result<Vec<FeatureDoc>, String> {
    let mut docs = Vec::new();
    let entries = fs::read_dir(dir).map_err(|e| format!("read {}: {e}", dir.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        if path.file_name().and_then(|s| s.to_str()) == Some("README.md") {
            continue;
        }
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        match parse_doc(&raw) {
            Ok(doc) => docs.push(doc),
            Err(e) => eprintln!("ask_alfredo: skip {}: {e}", path.display()),
        }
    }
    Ok(docs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_doc_with_all_fields() {
        let raw = "---\ntitle: Renaming\nkeywords: [rename, label]\nui_path: Sidebar → Rename\n---\nBody text.\n";
        let doc = parse_doc(raw).unwrap();
        assert_eq!(doc.frontmatter.title, "Renaming");
        assert_eq!(doc.frontmatter.keywords, vec!["rename", "label"]);
        assert_eq!(doc.frontmatter.ui_path.as_deref(), Some("Sidebar → Rename"));
        assert_eq!(doc.body, "Body text.");
    }

    #[test]
    fn parses_doc_with_only_title() {
        let raw = "---\ntitle: Basic\n---\nHello\n";
        let doc = parse_doc(raw).unwrap();
        assert_eq!(doc.frontmatter.title, "Basic");
        assert!(doc.frontmatter.keywords.is_empty());
        assert_eq!(doc.frontmatter.ui_path, None);
    }

    #[test]
    fn rejects_doc_without_frontmatter() {
        assert!(parse_doc("no frontmatter here").is_err());
    }

    /// Every shipped feature doc must parse. Catches YAML typos
    /// (unquoted colons, em-dashes in keyword arrays, stray tabs)
    /// before they ship and silently disappear from the index.
    #[test]
    fn every_shipped_doc_parses() {
        let manifest = env!("CARGO_MANIFEST_DIR");
        let features = std::path::Path::new(manifest).join("../docs/features");
        let mut failures: Vec<String> = Vec::new();
        let mut count = 0;
        for entry in fs::read_dir(&features).expect("read docs/features") {
            let entry = entry.unwrap();
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("md") {
                continue;
            }
            if path.file_name().and_then(|s| s.to_str()) == Some("README.md") {
                continue;
            }
            count += 1;
            let raw = fs::read_to_string(&path).unwrap();
            if let Err(e) = parse_doc(&raw) {
                failures.push(format!("{}: {}", path.display(), e));
            }
        }
        assert!(count > 0, "no .md docs found in {}", features.display());
        assert!(
            failures.is_empty(),
            "{} doc(s) failed to parse:\n{}",
            failures.len(),
            failures.join("\n")
        );
    }
}
