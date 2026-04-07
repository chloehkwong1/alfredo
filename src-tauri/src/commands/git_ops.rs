use crate::git_manager::git_command;
use crate::types::AppError;

type Result<T> = std::result::Result<T, AppError>;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeResult {
    pub success: bool,
    pub conflicted_files: Vec<String>,
}

/// Run `git merge <base_branch>` in the given repo.
/// Returns success status and list of conflicted files (if any).
#[tauri::command]
pub async fn git_merge(repo_path: String, base_branch: String) -> Result<MergeResult> {
    let output = git_command()
        .args(["merge", "--no-edit", &base_branch])
        .current_dir(&repo_path)
        .output()
        .await
        .map_err(|e| AppError::Git(format!("failed to spawn git merge: {e}")))?;

    if output.status.success() {
        return Ok(MergeResult {
            success: true,
            conflicted_files: vec![],
        });
    }

    // Check if the failure was due to conflicts
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !stderr.contains("CONFLICT") && !stderr.contains("Automatic merge failed") {
        return Err(AppError::Git(format!("git merge failed: {stderr}")));
    }

    // Collect conflicted files via `git diff --name-only --diff-filter=U`
    let diff_output = git_command()
        .args(["diff", "--name-only", "--diff-filter=U"])
        .current_dir(&repo_path)
        .output()
        .await
        .map_err(|e| AppError::Git(format!("failed to list conflicts: {e}")))?;

    let files: Vec<String> = String::from_utf8_lossy(&diff_output.stdout)
        .lines()
        .filter(|l| !l.is_empty())
        .map(|l| l.to_string())
        .collect();

    Ok(MergeResult {
        success: false,
        conflicted_files: files,
    })
}

/// Run `git push --force-with-lease` in the given repo.
#[tauri::command]
pub async fn git_push_force_with_lease(repo_path: String) -> Result<()> {
    let output = git_command()
        .args(["push", "--force-with-lease"])
        .current_dir(&repo_path)
        .output()
        .await
        .map_err(|e| AppError::Git(format!("failed to spawn git push: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Git(format!("git push failed: {stderr}")));
    }

    Ok(())
}
