use octocrab::Octocrab;

use crate::types::{AppError, KanbanColumn, PrStatus};

/// Manages GitHub API interactions via octocrab.
pub struct GithubManager {
    client: Octocrab,
}

impl GithubManager {
    /// Create a new GithubManager with a personal access token.
    pub fn new(token: &str) -> Result<Self, AppError> {
        let client = Octocrab::builder()
            .personal_token(token.to_string())
            .build()
            .map_err(|e| AppError::Github(format!("failed to build octocrab client: {e}")))?;
        Ok(Self { client })
    }

    /// Fetch all open PRs for the given owner/repo.
    pub async fn sync_prs(&self, owner: &str, repo: &str) -> Result<Vec<PrStatus>, AppError> {
        let page = self
            .client
            .pulls(owner, repo)
            .list()
            .state(octocrab::params::State::Open)
            .per_page(100)
            .send()
            .await
            .map_err(|e| AppError::Github(format!("failed to fetch PRs: {e}")))?;

        let prs = page
            .items
            .into_iter()
            .map(|pr| PrStatus {
                number: pr.number,
                state: pr
                    .state
                    .map(|s| format!("{s:?}").to_lowercase())
                    .unwrap_or_else(|| "open".to_string()),
                title: pr.title.unwrap_or_default(),
                url: pr
                    .html_url
                    .map(|u| u.to_string())
                    .unwrap_or_default(),
                draft: pr.draft.unwrap_or(false),
                merged: false, // open PRs aren't merged
                branch: pr.head.ref_field,
            })
            .collect();

        Ok(prs)
    }

    /// Fetch the PR associated with a specific branch head, if any.
    pub async fn get_pr_for_branch(
        &self,
        owner: &str,
        repo: &str,
        branch: &str,
    ) -> Result<Option<PrStatus>, AppError> {
        let page = self
            .client
            .pulls(owner, repo)
            .list()
            .state(octocrab::params::State::All)
            .head(format!("{owner}:{branch}"))
            .per_page(1)
            .send()
            .await
            .map_err(|e| AppError::Github(format!("failed to fetch PR for branch: {e}")))?;

        let pr = match page.items.into_iter().next() {
            Some(pr) => pr,
            None => return Ok(None),
        };

        let merged = pr.merged_at.is_some();
        let draft = pr.draft.unwrap_or(false);

        let branch = pr.head.ref_field.clone();

        Ok(Some(PrStatus {
            number: pr.number,
            state: pr
                .state
                .map(|s| format!("{s:?}").to_lowercase())
                .unwrap_or_else(|| "open".to_string()),
            title: pr.title.unwrap_or_default(),
            url: pr
                .html_url
                .map(|u| u.to_string())
                .unwrap_or_default(),
            draft,
            merged,
            branch,
        }))
    }
}

/// Determine the kanban column for a worktree based on its PR status.
pub fn determine_column(pr: Option<&PrStatus>) -> KanbanColumn {
    match pr {
        None => KanbanColumn::InProgress,
        Some(pr) if pr.merged => KanbanColumn::Done,
        Some(pr) if pr.draft => KanbanColumn::DraftPr,
        Some(_) => KanbanColumn::OpenPr,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_determine_column_no_pr() {
        assert_eq!(determine_column(None), KanbanColumn::InProgress);
    }

    #[test]
    fn test_determine_column_draft() {
        let pr = PrStatus {
            number: 1,
            state: "open".into(),
            title: "test".into(),
            url: "".into(),
            draft: true,
            merged: false,
            branch: "feat/test".into(),
        };
        assert_eq!(determine_column(Some(&pr)), KanbanColumn::DraftPr);
    }

    #[test]
    fn test_determine_column_open() {
        let pr = PrStatus {
            number: 1,
            state: "open".into(),
            title: "test".into(),
            url: "".into(),
            draft: false,
            merged: false,
            branch: "feat/test".into(),
        };
        assert_eq!(determine_column(Some(&pr)), KanbanColumn::OpenPr);
    }

    #[test]
    fn test_determine_column_merged() {
        let pr = PrStatus {
            number: 1,
            state: "closed".into(),
            title: "test".into(),
            url: "".into(),
            draft: false,
            merged: true,
            branch: "feat/test".into(),
        };
        assert_eq!(determine_column(Some(&pr)), KanbanColumn::Done);
    }
}
