use serde::Serialize;
use std::path::{Path, PathBuf};

use crate::types::AppError;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OutputStyle {
    pub name: String,
    pub source: &'static str,
}

#[derive(serde::Deserialize)]
struct FrontmatterName {
    name: Option<String>,
}

fn parse_style_name(path: &Path) -> Option<String> {
    let contents = std::fs::read_to_string(path).ok()?;
    let trimmed = contents.trim_start();
    if let Some(rest) = trimmed.strip_prefix("---") {
        if let Some(end) = rest.find("\n---") {
            let yaml = &rest[..end];
            if let Ok(parsed) = serde_yaml::from_str::<FrontmatterName>(yaml) {
                if let Some(name) = parsed.name {
                    let trimmed = name.trim();
                    if !trimmed.is_empty() {
                        return Some(trimmed.to_string());
                    }
                }
            }
        }
    }
    path.file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())
}

fn collect_from_dir(dir: &Path, source: &'static str, out: &mut Vec<OutputStyle>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        if let Some(name) = parse_style_name(&path) {
            out.push(OutputStyle { name, source });
        }
    }
}

/// List custom output styles from `~/.claude/output-styles/` (user) and
/// `<repo>/.claude/output-styles/` (project). Does not include built-ins.
#[tauri::command]
pub async fn list_output_styles(repo_path: Option<String>) -> Result<Vec<OutputStyle>, AppError> {
    let mut styles: Vec<OutputStyle> = Vec::new();

    if let Some(home) = dirs::home_dir() {
        let user_dir: PathBuf = home.join(".claude").join("output-styles");
        collect_from_dir(&user_dir, "user", &mut styles);
    }

    if let Some(repo) = repo_path.as_deref().filter(|s| !s.is_empty()) {
        let project_dir = PathBuf::from(repo).join(".claude").join("output-styles");
        collect_from_dir(&project_dir, "project", &mut styles);
    }

    // Dedupe by name; project overrides user (pushed last, so keep last).
    let mut seen = std::collections::HashMap::<String, OutputStyle>::new();
    for style in styles {
        seen.insert(style.name.clone(), style);
    }
    let mut result: Vec<OutputStyle> = seen.into_values().collect();
    result.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn parse_name_prefers_frontmatter() {
        let dir = TempDir::new().unwrap();
        let p = dir.path().join("concise.md");
        fs::write(&p, "---\nname: Concise Reviewer\n---\nbody").unwrap();
        assert_eq!(parse_style_name(&p).as_deref(), Some("Concise Reviewer"));
    }

    #[test]
    fn parse_name_falls_back_to_filename() {
        let dir = TempDir::new().unwrap();
        let p = dir.path().join("My-Style.md");
        fs::write(&p, "no frontmatter here").unwrap();
        assert_eq!(parse_style_name(&p).as_deref(), Some("My-Style"));
    }

    #[test]
    fn collect_skips_non_markdown() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("a.md"), "---\nname: A\n---\n").unwrap();
        fs::write(dir.path().join("b.txt"), "ignore me").unwrap();
        let mut out = Vec::new();
        collect_from_dir(dir.path(), "user", &mut out);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].name, "A");
    }
}
