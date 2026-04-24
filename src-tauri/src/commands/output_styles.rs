use serde::Serialize;
use std::path::{Path, PathBuf};

use crate::types::AppError;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputStyle {
    pub name: String,
    pub source: &'static str,
}

#[derive(serde::Deserialize)]
struct FrontmatterName {
    name: Option<String>,
}

fn filename_stem(path: &Path) -> Option<String> {
    path.file_stem()
        .and_then(|s| s.to_str())
        .map(std::string::ToString::to_string)
}

fn parse_style_name(path: &Path) -> Option<String> {
    let raw = match std::fs::read_to_string(path) {
        Ok(s) => s,
        Err(err) => {
            tracing::warn!(path = %path.display(), error = %err, "output-styles: failed to read file");
            return filename_stem(path);
        }
    };
    // Strip UTF-8 BOM before whitespace trimming so BOM'd files still parse.
    let contents = raw.trim_start_matches('\u{feff}').trim_start();
    let mut lines = contents.lines();
    if lines.next().map(str::trim_end) == Some("---") {
        let mut yaml = String::new();
        let mut closed = false;
        for line in lines {
            if line.trim_end() == "---" {
                closed = true;
                break;
            }
            yaml.push_str(line);
            yaml.push('\n');
        }
        if closed {
            match serde_yaml::from_str::<FrontmatterName>(&yaml) {
                Ok(parsed) => {
                    if let Some(name) = parsed.name {
                        let trimmed = name.trim();
                        if !trimmed.is_empty() {
                            return Some(trimmed.to_string());
                        }
                    }
                }
                Err(err) => {
                    tracing::warn!(path = %path.display(), error = %err, "output-styles: invalid frontmatter");
                }
            }
        }
    }
    filename_stem(path)
}

fn collect_from_dir(dir: &Path, source: &'static str, out: &mut Vec<OutputStyle>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return,
        Err(err) => {
            tracing::warn!(dir = %dir.display(), error = %err, "output-styles: failed to read dir");
            return;
        }
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

    // Dedupe by name. User styles are collected first, then project, so
    // `HashMap::insert` naturally lets a project style override a user
    // style with the same name.
    let mut seen = std::collections::HashMap::<String, OutputStyle>::new();
    for style in styles {
        seen.insert(style.name.clone(), style);
    }
    let mut result: Vec<OutputStyle> = seen.into_values().collect();
    result.sort_by_key(|a| a.name.to_lowercase());
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

    #[test]
    fn parse_name_handles_crlf_and_bom() {
        let dir = TempDir::new().unwrap();
        let p = dir.path().join("crlf.md");
        fs::write(&p, "\u{feff}---\r\nname: Windows Style\r\n---\r\nbody").unwrap();
        assert_eq!(parse_style_name(&p).as_deref(), Some("Windows Style"));
    }

    #[test]
    fn parse_name_falls_back_when_frontmatter_unclosed() {
        let dir = TempDir::new().unwrap();
        let p = dir.path().join("broken.md");
        fs::write(&p, "---\nname: Never Closed\n").unwrap();
        assert_eq!(parse_style_name(&p).as_deref(), Some("broken"));
    }

    #[test]
    fn dedupe_project_overrides_user() {
        use std::collections::HashMap;
        let styles = vec![
            OutputStyle { name: "Shared".into(), source: "user" },
            OutputStyle { name: "Shared".into(), source: "project" },
        ];
        let mut seen = HashMap::<String, OutputStyle>::new();
        for s in styles { seen.insert(s.name.clone(), s); }
        assert_eq!(seen.get("Shared").map(|s| s.source), Some("project"));
    }
}
