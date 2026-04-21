use super::docs::{self, FeatureDoc};
use bm25::{Language, SearchEngineBuilder};
use serde::Serialize;
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HelpHit {
    pub title: String,
    pub ui_path: Option<String>,
    pub keywords: Vec<String>,
    pub body: String,
    pub score: f32,
}

/// Build a BM25 index over the given docs and return the top-`limit` matches
/// for `query`. Each doc is indexed as `title + keywords + ui_path + body`
/// concatenated so frontmatter terms score.
pub fn search(query: &str, limit: usize, docs: &[FeatureDoc]) -> Vec<HelpHit> {
    let trimmed = query.trim();
    if trimmed.is_empty() || docs.is_empty() {
        return Vec::new();
    }

    let corpus: Vec<String> = docs
        .iter()
        .map(|d| {
            let mut s = String::new();
            // Weight frontmatter by repeating it — cheap way to bias results
            // toward title/keyword/ui_path matches over body matches.
            for _ in 0..3 {
                s.push_str(&d.frontmatter.title);
                s.push(' ');
            }
            for kw in &d.frontmatter.keywords {
                for _ in 0..2 {
                    s.push_str(kw);
                    s.push(' ');
                }
            }
            if let Some(p) = &d.frontmatter.ui_path {
                s.push_str(p);
                s.push(' ');
            }
            s.push_str(&d.body);
            s
        })
        .collect();

    let engine = SearchEngineBuilder::<u32>::with_corpus(Language::English, corpus).build();
    engine
        .search(trimmed, limit)
        .into_iter()
        .filter_map(|r| {
            let idx = r.document.id as usize;
            let doc = docs.get(idx)?;
            Some(HelpHit {
                title: doc.frontmatter.title.clone(),
                ui_path: doc.frontmatter.ui_path.clone(),
                keywords: doc.frontmatter.keywords.clone(),
                body: doc.body.clone(),
                score: r.score,
            })
        })
        .collect()
}

/// Load docs from the resource dir and search in one shot.
pub fn search_all(app: &AppHandle, query: &str, limit: usize) -> Result<Vec<HelpHit>, String> {
    let docs = docs::load_all(app)?;
    Ok(search(query, limit, &docs))
}
