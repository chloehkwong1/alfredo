use super::docs::FeatureDoc;

pub const SYSTEM_INSTRUCTIONS: &str = r#"You are Alfredo's in-app help assistant. Alfredo is a desktop app for managing AI coding agents across git worktrees.

Answer the user's question using ONLY the feature docs provided below. Keep answers under 80 words, task-oriented, no code unless essential.

Respond with JSON matching this schema, and nothing else:
{
  "answer": "<your answer>",
  "ui_path": "<the ui_path from the matching doc, or null>",
  "confidence": "high" | "low"
}

Use "confidence": "low" when:
- No doc covers the question
- The docs only tangentially relate
- You are unsure

Use "confidence": "high" only when a specific doc clearly answers the question."#;

pub fn format_corpus(docs: &[FeatureDoc]) -> String {
    let mut out = String::from("# Feature documentation\n\n");
    for doc in docs {
        out.push_str("## ");
        out.push_str(&doc.frontmatter.title);
        out.push('\n');
        if !doc.frontmatter.keywords.is_empty() {
            out.push_str("_keywords: ");
            out.push_str(&doc.frontmatter.keywords.join(", "));
            out.push_str("_\n");
        }
        if let Some(path) = &doc.frontmatter.ui_path {
            out.push_str("_ui_path: ");
            out.push_str(path);
            out.push_str("_\n");
        }
        out.push('\n');
        out.push_str(&doc.body);
        out.push_str("\n\n---\n\n");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ask_alfredo::docs::FeatureDocFrontmatter;

    fn doc(title: &str, body: &str, ui_path: Option<&str>) -> FeatureDoc {
        FeatureDoc {
            frontmatter: FeatureDocFrontmatter {
                title: title.into(),
                keywords: vec![],
                ui_path: ui_path.map(|s| s.into()),
            },
            body: body.into(),
        }
    }

    #[test]
    fn formats_single_doc() {
        let out = format_corpus(&[doc("Rename", "Right-click.", Some("Sidebar"))]);
        assert!(out.contains("## Rename"));
        assert!(out.contains("_ui_path: Sidebar_"));
        assert!(out.contains("Right-click."));
    }

    #[test]
    fn separates_docs_with_hr() {
        let out = format_corpus(&[doc("A", "aa", None), doc("B", "bb", None)]);
        assert_eq!(out.matches("---").count(), 2);
    }
}
