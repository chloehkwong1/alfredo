use crate::commands::diff::{DiffHunk, DiffLine};

/// Parse a GitHub unified diff patch string into a list of DiffHunks.
///
/// GitHub returns patches like:
/// ```
/// @@ -1,4 +1,5 @@
///  import { foo } from "bar";
/// +import { baz } from "qux";
///
///  const x = 1;
/// ```
#[allow(dead_code)]
pub fn parse_patch(patch: &str) -> Vec<DiffHunk> {
    let mut hunks: Vec<DiffHunk> = Vec::new();
    let mut current_hunk: Option<DiffHunk> = None;
    let mut old_line: u32 = 0;
    let mut new_line: u32 = 0;

    for raw_line in patch.lines() {
        if raw_line.starts_with("@@") {
            // Flush previous hunk
            if let Some(h) = current_hunk.take() {
                hunks.push(h);
            }

            // Parse: @@ -old_start,old_count +new_start,new_count @@
            let (old_start, new_start) = parse_hunk_header(raw_line);
            old_line = old_start;
            new_line = new_start;

            current_hunk = Some(DiffHunk {
                header: raw_line.to_string(),
                old_start,
                new_start,
                lines: Vec::new(),
            });
            continue;
        }

        let Some(ref mut hunk) = current_hunk else {
            continue;
        };

        if let Some(content) = raw_line.strip_prefix('+') {
            hunk.lines.push(DiffLine {
                line_type: "addition".to_string(),
                content: content.to_string(),
                old_line_number: None,
                new_line_number: Some(new_line),
            });
            new_line += 1;
        } else if let Some(content) = raw_line.strip_prefix('-') {
            hunk.lines.push(DiffLine {
                line_type: "deletion".to_string(),
                content: content.to_string(),
                old_line_number: Some(old_line),
                new_line_number: None,
            });
            old_line += 1;
        } else {
            // Context line — may or may not have a leading space
            let content = raw_line.strip_prefix(' ').unwrap_or(raw_line);
            hunk.lines.push(DiffLine {
                line_type: "context".to_string(),
                content: content.to_string(),
                old_line_number: Some(old_line),
                new_line_number: Some(new_line),
            });
            old_line += 1;
            new_line += 1;
        }
    }

    // Flush last hunk
    if let Some(h) = current_hunk {
        hunks.push(h);
    }

    hunks
}

/// Extract old_start and new_start from a hunk header like `@@ -10,5 +12,7 @@`.
fn parse_hunk_header(header: &str) -> (u32, u32) {
    // Strip the @@ markers and split
    let inner = header
        .trim_start_matches("@@")
        .trim_end_matches("@@")
        // There may be trailing context after the second @@
        .split("@@")
        .next()
        .unwrap_or("")
        .trim();

    let mut old_start: u32 = 1;
    let mut new_start: u32 = 1;

    for part in inner.split_whitespace() {
        if let Some(rest) = part.strip_prefix('-') {
            old_start = rest.split(',').next()
                .and_then(|s| s.parse().ok())
                .unwrap_or(1);
        } else if let Some(rest) = part.strip_prefix('+') {
            new_start = rest.split(',').next()
                .and_then(|s| s.parse().ok())
                .unwrap_or(1);
        }
    }

    (old_start, new_start)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_simple_patch() {
        let patch = "@@ -1,3 +1,4 @@\n import { foo } from \"bar\";\n+import { baz } from \"qux\";\n \n const x = 1;";
        let hunks = parse_patch(patch);

        assert_eq!(hunks.len(), 1);
        assert_eq!(hunks[0].old_start, 1);
        assert_eq!(hunks[0].new_start, 1);
        assert_eq!(hunks[0].lines.len(), 4);
        assert_eq!(hunks[0].lines[0].line_type, "context");
        assert_eq!(hunks[0].lines[1].line_type, "addition");
        assert_eq!(hunks[0].lines[1].content, "import { baz } from \"qux\";");
        assert_eq!(hunks[0].lines[1].new_line_number, Some(2));
    }

    #[test]
    fn test_parse_multi_hunk_patch() {
        let patch = "@@ -1,2 +1,2 @@\n-old line\n+new line\n context\n@@ -10,2 +10,3 @@\n context\n+added\n context";
        let hunks = parse_patch(patch);

        assert_eq!(hunks.len(), 2);
        assert_eq!(hunks[0].old_start, 1);
        assert_eq!(hunks[1].old_start, 10);
        assert_eq!(hunks[1].lines.len(), 3);
    }

    #[test]
    fn test_parse_hunk_header_with_context() {
        // GitHub often includes function context after the second @@
        let (old, new) = parse_hunk_header("@@ -10,5 +12,7 @@ fn main() {");
        assert_eq!(old, 10);
        assert_eq!(new, 12);
    }

    #[test]
    fn test_empty_patch() {
        let hunks = parse_patch("");
        assert!(hunks.is_empty());
    }
}
