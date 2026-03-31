use crate::github_manager::{self, GithubManager};
use crate::github_sync;
use crate::types::{AppError, PrStatus};

type Result<T> = std::result::Result<T, AppError>;

/// Sort priority bucket for a PR relative to the current user.
fn pr_sort_bucket(pr: &PrStatus, username: Option<&str>) -> u8 {
    let is_mine = match (pr.author.as_deref(), username) {
        (Some(author), Some(user)) => author.eq_ignore_ascii_case(user),
        _ => false,
    };
    let assigned_to_review = username
        .map(|u| pr.requested_reviewers.iter().any(|r| r.eq_ignore_ascii_case(u)))
        .unwrap_or(false);

    match (assigned_to_review, is_mine, pr.draft) {
        (true, _, _)      => 0,
        (_, true, false)   => 1,
        (_, true, true)    => 2,
        (_, false, false)  => 3,
        (_, false, true)   => 4,
    }
}

/// Sort PRs: mine first (review-assigned → my open → my draft → others' open → others' draft),
/// then by `updated_at` descending within each group.
pub fn sort_prs(prs: &mut [PrStatus], username: Option<&str>) {
    prs.sort_by(|a, b| {
        let bucket_a = pr_sort_bucket(a, username);
        let bucket_b = pr_sort_bucket(b, username);
        bucket_a.cmp(&bucket_b).then_with(|| {
            b.updated_at.cmp(&a.updated_at)
        })
    });
}

/// Fetch all open PRs for the configured repository.
#[tauri::command]
pub async fn sync_pr_status(repo_path: String) -> Result<Vec<PrStatus>> {
    let (manager, owner, repo) = github_manager::github_context(&repo_path).await?;
    let mut prs = manager.sync_prs(&owner, &repo).await?;
    let username = github_sync::resolve_github_username().await;
    sort_prs(&mut prs, username.as_deref());
    Ok(prs)
}

#[cfg(test)]
mod tests {
    use crate::types::PrStatus;

    fn make_pr(number: u64, author: &str, draft: bool, updated_at: &str, reviewers: Vec<&str>) -> PrStatus {
        PrStatus {
            number,
            state: "open".into(),
            title: format!("PR #{number}"),
            url: String::new(),
            draft,
            merged: false,
            branch: format!("branch-{number}"),
            base_branch: None,
            merged_at: None,
            head_sha: None,
            body: None,
            updated_at: Some(updated_at.into()),
            author: Some(author.into()),
            requested_reviewers: reviewers.into_iter().map(String::from).collect(),
        }
    }

    #[test]
    fn test_sort_prs_mine_first() {
        let mut prs = vec![
            make_pr(1, "other", false, "2026-03-01T00:00:00Z", vec![]),
            make_pr(2, "chloe", false, "2026-03-02T00:00:00Z", vec![]),
            make_pr(3, "other", false, "2026-03-03T00:00:00Z", vec!["chloe"]),
            make_pr(4, "chloe", true,  "2026-03-04T00:00:00Z", vec![]),
            make_pr(5, "other", true,  "2026-03-05T00:00:00Z", vec![]),
            make_pr(6, "other", false, "2026-03-06T00:00:00Z", vec![]),
        ];

        super::sort_prs(&mut prs, Some("chloe"));

        let numbers: Vec<u64> = prs.iter().map(|p| p.number).collect();
        assert_eq!(numbers, vec![3, 2, 4, 6, 1, 5]);
    }

    #[test]
    fn test_sort_prs_no_username_falls_back_to_recency() {
        let mut prs = vec![
            make_pr(1, "a", false, "2026-03-01T00:00:00Z", vec![]),
            make_pr(2, "b", false, "2026-03-03T00:00:00Z", vec![]),
            make_pr(3, "c", false, "2026-03-02T00:00:00Z", vec![]),
        ];

        super::sort_prs(&mut prs, None);

        let numbers: Vec<u64> = prs.iter().map(|p| p.number).collect();
        assert_eq!(numbers, vec![2, 3, 1]);
    }
}

/// Get the PR associated with a specific branch, if any.
#[tauri::command]
pub async fn get_pr_for_branch(
    owner: String,
    repo: String,
    branch: String,
) -> Result<Option<PrStatus>> {
    let token = std::env::var("GITHUB_TOKEN")
        .map_err(|_| AppError::Github("no GitHub token available".into()))?;
    let manager = GithubManager::new(&token)?;
    manager.get_pr_for_branch(&owner, &repo, &branch).await
}
