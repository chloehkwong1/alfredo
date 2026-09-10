use crate::github_manager::shared_http_client;
use crate::types::AppError;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GifResult {
    pub preview_url: String,
    pub url: String,
}

/// Whether this build was compiled with a Giphy key baked in (build.rs reads
/// .env). Builds without one hide the GIF button entirely.
#[tauri::command]
pub fn gifs_available() -> bool {
    option_env!("GIPHY_API_KEY").is_some()
}

fn parse_giphy_response(json: &serde_json::Value) -> Vec<GifResult> {
    let Some(items) = json.get("data").and_then(|d| d.as_array()) else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| {
            let images = item.get("images")?;
            let url_at = |name: &str| {
                images
                    .get(name)?
                    .get("url")?
                    .as_str()
                    .map(str::to_string)
            };
            Some(GifResult {
                preview_url: url_at("fixed_height_small")?,
                url: url_at("downsized_medium")?,
            })
        })
        .collect()
}

#[tauri::command]
pub async fn search_gifs(query: String) -> Result<Vec<GifResult>, AppError> {
    let Some(key) = option_env!("GIPHY_API_KEY") else {
        return Err(AppError::Config(
            "GIF search unavailable — no GIPHY_API_KEY baked into this build".into(),
        ));
    };
    let resp = shared_http_client()
        .get("https://api.giphy.com/v1/gifs/search")
        .query(&[
            ("api_key", key),
            ("q", query.as_str()),
            ("limit", "24"),
            ("rating", "pg-13"),
        ])
        .send()
        .await
        .map_err(|e| AppError::Config(format!("Giphy request failed: {}", e.without_url())))?
        .error_for_status()
        .map_err(|e| AppError::Config(format!("Giphy returned an error: {}", e.without_url())))?;
    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::Config(format!("Giphy response was not JSON: {e}")))?;
    Ok(parse_giphy_response(&json))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_giphy_search_response() {
        let json: serde_json::Value = serde_json::json!({
            "data": [
                {
                    "images": {
                        "fixed_height_small": { "url": "https://media.giphy.com/a/100.gif" },
                        "downsized_medium": { "url": "https://media.giphy.com/a/full.gif" }
                    }
                },
                { "images": {} } // malformed entry is skipped, not an error
            ]
        });
        let results = parse_giphy_response(&json);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].preview_url, "https://media.giphy.com/a/100.gif");
        assert_eq!(results[0].url, "https://media.giphy.com/a/full.gif");
    }
}
