use serde::Serialize;

/// One release entry parsed out of `docs/features/whats-new.md`.
///
/// `#[allow(dead_code)]` because the command wrapper that constructs and
/// returns these (a later task) doesn't exist yet; the `--lib` clippy gate
/// only sees this module's own tests.
#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhatsNewEntry {
    pub version: String,
    pub date: String,
    pub body: String,
}

/// Numeric `major.minor.patch` compare. Unparseable segments sort as 0, so a
/// malformed marker never suppresses the popup forever.
///
/// `#[allow(dead_code)]` because the caller (the update-check command, a
/// later task) doesn't exist yet.
#[allow(dead_code)]
pub fn version_gt(a: &str, b: &str) -> bool {
    parts(a) > parts(b)
}

fn parts(v: &str) -> (u32, u32, u32) {
    let mut it = v.split('.').map(|s| s.parse::<u32>().unwrap_or(0));
    (
        it.next().unwrap_or(0),
        it.next().unwrap_or(0),
        it.next().unwrap_or(0),
    )
}

/// Recognise a `**vX.Y.Z — DATE**` release heading.
fn parse_heading(line: &str) -> Option<(String, String)> {
    let inner = line.trim().strip_prefix("**v")?.strip_suffix("**")?;
    let (version, date) = inner.split_once(" — ")?;
    let version = version.trim();
    let numeric = version.split('.').count() == 3
        && version
            .split('.')
            .all(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit()));
    if !numeric {
        return None;
    }
    Some((version.to_string(), date.trim().to_string()))
}

/// Split the whats-new body into per-release entries in source order (the file
/// is written newest-first). Preamble before the first heading is dropped.
///
/// `#[allow(dead_code)]` because the command wrapper that calls this (a
/// later task) doesn't exist yet.
#[allow(dead_code)]
pub fn parse_entries(body: &str) -> Vec<WhatsNewEntry> {
    let mut entries = Vec::new();
    let mut current: Option<(String, String, Vec<&str>)> = None;

    for line in body.lines() {
        if let Some((version, date)) = parse_heading(line) {
            if let Some((v, d, lines)) = current.take() {
                entries.push(finish(v, d, &lines));
            }
            current = Some((version, date, Vec::new()));
        } else if let Some((_, _, lines)) = current.as_mut() {
            lines.push(line);
        }
    }
    if let Some((v, d, lines)) = current.take() {
        entries.push(finish(v, d, &lines));
    }
    entries
}

fn finish(version: String, date: String, lines: &[&str]) -> WhatsNewEntry {
    let joined = lines.join("\n");
    // Every entry is a bullet list. Trailing non-bullet blocks belong to the
    // document (e.g. the closing "Check the releases page…" line), not to the
    // release, so drop them.
    let mut blocks: Vec<&str> = joined.split("\n\n").collect();
    while blocks
        .last()
        .is_some_and(|b| !b.trim_start().starts_with('-'))
    {
        blocks.pop();
    }
    WhatsNewEntry {
        version,
        date,
        body: blocks.join("\n\n").trim().to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "\
Recent highlights. Full notes:
https://github.com/chloehkwong1/alfredo/releases.

**v0.19.0 — 2026-07-09**
- **Open Linear issues straight in Alfredo** — spins up a worktree.
- **Fable 5 and Sonnet 5** are now selectable models.

**v0.18.0 — 2026-06-19**
- **Two-row pane tab bar** — tabs split across two rows.

Check the releases page for older versions and full detail.
";

    #[test]
    fn splits_entries_newest_first() {
        let entries = parse_entries(SAMPLE);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].version, "0.19.0");
        assert_eq!(entries[0].date, "2026-07-09");
        assert_eq!(entries[1].version, "0.18.0");
        assert_eq!(entries[1].date, "2026-06-19");
    }

    #[test]
    fn drops_preamble_and_trailer() {
        let entries = parse_entries(SAMPLE);
        assert!(!entries[0].body.contains("Recent highlights"));
        assert!(!entries[1].body.contains("Check the releases page"));
        assert!(entries[1].body.ends_with("tabs split across two rows."));
    }

    #[test]
    fn keeps_all_bullets_of_an_entry() {
        let entries = parse_entries(SAMPLE);
        assert!(entries[0].body.contains("Open Linear issues"));
        assert!(entries[0].body.contains("Fable 5 and Sonnet 5"));
    }

    #[test]
    fn ignores_non_heading_bold_lines() {
        let raw = "**v1.2.3 — 2026-01-01**\n- real bullet\n**Not a heading**\n- another bullet\n";
        let entries = parse_entries(raw);
        assert_eq!(entries.len(), 1);
        assert!(entries[0].body.contains("**Not a heading**"));
    }

    #[test]
    fn returns_empty_for_garbage() {
        assert!(parse_entries("").is_empty());
        assert!(parse_entries("no headings at all, just prose").is_empty());
    }

    #[test]
    fn version_gt_compares_numerically() {
        assert!(version_gt("0.20.0", "0.19.0"));
        assert!(version_gt("0.19.10", "0.19.9")); // not string ordering
        assert!(version_gt("1.0.0", "0.99.99"));
        assert!(!version_gt("0.19.0", "0.19.0"));
        assert!(!version_gt("0.18.0", "0.19.0"));
    }

    #[test]
    fn version_gt_tolerates_malformed_input() {
        assert!(!version_gt("garbage", "0.1.0"));
        assert!(version_gt("0.1.0", "garbage"));
    }

    /// The real shipped file must parse — catches a heading-format drift in
    /// `/update-alfredo-docs` output before it silently disables the popup.
    #[test]
    fn shipped_whats_new_parses() {
        let manifest = env!("CARGO_MANIFEST_DIR");
        let path = std::path::Path::new(manifest).join("../docs/features/whats-new.md");
        let raw = std::fs::read_to_string(&path).expect("read whats-new.md");
        let doc = crate::ask_alfredo::docs::parse_doc(&raw).expect("frontmatter parses");
        let entries = parse_entries(&doc.body);
        assert!(!entries.is_empty(), "no entries parsed from shipped whats-new.md");
        for entry in &entries {
            assert_eq!(entry.version.split('.').count(), 3, "bad version {}", entry.version);
            assert!(!entry.date.is_empty(), "empty date for v{}", entry.version);
            assert!(!entry.body.is_empty(), "empty body for v{}", entry.version);
        }
    }
}
