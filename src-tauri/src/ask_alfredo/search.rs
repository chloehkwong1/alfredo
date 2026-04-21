use super::docs::{self, FeatureDoc};
use bm25::{Language, SearchEngine, SearchEngineBuilder};
use serde::Serialize;
use std::collections::HashMap;
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

/// BM25 tuning for our corpus of short, uniformly-sized docs.
/// Default k1=1.2, b=0.75. We lower `b` because length normalisation is
/// less useful (docs are already ~100-200 words each) and default-strength
/// b penalises the keyword/title fields which are much shorter than body.
const K1: f32 = 1.2;
const B: f32 = 0.3;

/// Per-field weights combining the three separate BM25 indices below.
/// Weighting was previously implicit via text repetition; making it
/// explicit + using separate indices means each field gets its own IDF.
const W_TITLE: f32 = 3.0;
const W_KEYWORDS: f32 = 2.0;
const W_BODY: f32 = 1.0;

/// Replace hyphens with spaces so "auto-delete" matches "auto" and
/// "delete" queries naturally. The default tokenizer's stemmer otherwise
/// treats "auto" and "automatic" as separate roots.
fn prep(s: &str) -> String {
    s.replace('-', " ")
}

fn build_engine(texts: Vec<String>) -> Option<SearchEngine<u32>> {
    if texts.is_empty() || texts.iter().all(|t| t.trim().is_empty()) {
        return None;
    }
    Some(
        SearchEngineBuilder::<u32>::with_corpus(Language::English, texts)
            .k1(K1)
            .b(B)
            .build(),
    )
}

/// Score every doc against `query` using `engine`. Normalises to [0, 1] by
/// dividing by the top score — so weighted combination across fields is
/// comparable even though per-field IDFs differ wildly.
fn score_field(engine: &SearchEngine<u32>, query: &str, n_docs: usize) -> HashMap<u32, f32> {
    let results = engine.search(query, n_docs);
    let max = results
        .iter()
        .map(|r| r.score)
        .fold(0.0_f32, f32::max);
    if max <= 0.0 {
        return HashMap::new();
    }
    results
        .into_iter()
        .map(|r| (r.document.id, r.score / max))
        .collect()
}

pub fn search(query: &str, limit: usize, docs: &[FeatureDoc]) -> Vec<HelpHit> {
    let trimmed = query.trim();
    if trimmed.is_empty() || docs.is_empty() {
        return Vec::new();
    }
    let query_prepped = prep(trimmed);

    let titles: Vec<String> = docs
        .iter()
        .map(|d| prep(&d.frontmatter.title))
        .collect();
    let keywords: Vec<String> = docs
        .iter()
        .map(|d| {
            let mut s = d.frontmatter.keywords.join(" ");
            if let Some(p) = &d.frontmatter.ui_path {
                s.push(' ');
                s.push_str(p);
            }
            prep(&s)
        })
        .collect();
    let bodies: Vec<String> = docs.iter().map(|d| prep(&d.body)).collect();

    let mut totals: HashMap<u32, f32> = HashMap::new();

    for (texts, weight) in [
        (titles, W_TITLE),
        (keywords, W_KEYWORDS),
        (bodies, W_BODY),
    ] {
        if let Some(engine) = build_engine(texts) {
            for (id, norm_score) in score_field(&engine, &query_prepped, docs.len()) {
                *totals.entry(id).or_insert(0.0) += weight * norm_score;
            }
        }
    }

    let mut ranked: Vec<(u32, f32)> = totals.into_iter().collect();
    ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    ranked
        .into_iter()
        .take(limit)
        .filter_map(|(id, score)| {
            let doc = docs.get(id as usize)?;
            Some(HelpHit {
                title: doc.frontmatter.title.clone(),
                ui_path: doc.frontmatter.ui_path.clone(),
                keywords: doc.frontmatter.keywords.clone(),
                body: doc.body.clone(),
                score,
            })
        })
        .collect()
}

/// Load docs from the resource dir and search in one shot.
pub fn search_all(app: &AppHandle, query: &str, limit: usize) -> Result<Vec<HelpHit>, String> {
    let docs = docs::load_all(app)?;
    Ok(search(query, limit, &docs))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ask_alfredo::docs::FeatureDocFrontmatter;

    fn doc(title: &str, keywords: &[&str], ui_path: Option<&str>, body: &str) -> FeatureDoc {
        FeatureDoc {
            frontmatter: FeatureDocFrontmatter {
                title: title.into(),
                keywords: keywords.iter().map(|s| s.to_string()).collect(),
                ui_path: ui_path.map(|s| s.into()),
            },
            body: body.into(),
        }
    }

    #[test]
    fn title_hits_outrank_incidental_body_hits() {
        let docs = vec![
            doc(
                "Deleting a worktree",
                &["delete", "remove"],
                Some("Sidebar → Delete"),
                "Removes the worktree directory and the local branch.",
            ),
            doc(
                "Leaving inline comments",
                &["comment", "annotate"],
                Some("Changes panel"),
                "Delete an annotation from its context menu.",
            ),
        ];
        let hits = search("delete worktree", 5, &docs);
        assert_eq!(hits[0].title, "Deleting a worktree");
    }

    #[test]
    fn hyphens_split_for_matching() {
        let docs = vec![
            doc(
                "Automatic archiving and deletion",
                &["auto archive", "auto delete"],
                None,
                "Auto-archive merged worktrees. Auto-delete archived worktrees.",
            ),
            doc("Something else", &[], None, "Nothing relevant here."),
        ];
        // Query uses "auto" (should match "auto-archive" via hyphen split)
        let hits = search("auto archive", 5, &docs);
        assert_eq!(hits[0].title, "Automatic archiving and deletion");
    }
}
