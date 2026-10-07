use std::collections::BTreeSet;
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use tokio::time::Instant;

use crate::types::AppError;

/// How the warm-up loop waits on the server. Split out so tests can shrink it.
#[derive(Clone, Copy)]
struct WarmUpTiming {
    /// How long to keep retrying while the port still refuses connections.
    boot_deadline: Duration,
    /// Gap between attempts; also the connect timeout for each attempt.
    poll_interval: Duration,
    /// Per-request timeout once the server accepts the connection.
    request_timeout: Duration,
    /// Failed requests (timeouts, dropped connections) tolerated once the
    /// port is listening, before giving up.
    max_failures: u32,
}

const DEFAULT_TIMING: WarmUpTiming = WarmUpTiming {
    boot_deadline: Duration::from_secs(300),
    poll_interval: Duration::from_secs(1),
    request_timeout: Duration::from_secs(60),
    max_failures: 3,
};

/// Ports with a warm-up loop running. Stopping and restarting a server while
/// it boots would otherwise stack a second loop on the same port.
static IN_FLIGHT: Mutex<BTreeSet<u16>> = Mutex::new(BTreeSet::new());

fn in_flight() -> MutexGuard<'static, BTreeSet<u16>> {
    IN_FLIGHT.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// Releases a port's `IN_FLIGHT` slot when its warm-up loop ends.
struct InFlightGuard(u16);

impl Drop for InFlightGuard {
    fn drop(&mut self) {
        in_flight().remove(&self.0);
    }
}

/// Fire a throwaway `GET /` at a freshly started dev server so its first
/// real request doesn't eat the cold-start cost — most notably a Neon
/// database that suspended while idle and times out the first query.
///
/// Returns immediately; the wait-for-port + request loop runs in the
/// background. Done in Rust because the webview CSP blocks `localhost`.
#[tauri::command]
pub async fn warm_up_server(port: u16) -> Result<(), AppError> {
    if !in_flight().insert(port) {
        return Ok(());
    }
    let guard = InFlightGuard(port);
    let url = format!("http://localhost:{port}/");
    tauri::async_runtime::spawn(async move {
        let _guard = guard;
        match warm_up(&url, DEFAULT_TIMING).await {
            Ok(status) => eprintln!("[server-warmup] {url} responded {status}"),
            Err(e) => eprintln!("[server-warmup] {url} gave up: {e}"),
        }
    });
    Ok(())
}

/// Request `url` until the server answers with any HTTP response.
async fn warm_up(url: &str, timing: WarmUpTiming) -> Result<reqwest::StatusCode, String> {
    // No redirects: any response means the app handled the request, and a
    // redirect to an auth provider shouldn't send us off-machine.
    let client = reqwest::Client::builder()
        .connect_timeout(timing.poll_interval)
        .timeout(timing.request_timeout)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("failed to build client: {e}"))?;

    let deadline = Instant::now() + timing.boot_deadline;
    let mut failures = 0;
    loop {
        let err = match client.get(url).send().await {
            Ok(resp) => return Ok(resp.status()),
            Err(e) => e,
        };
        if err.is_connect() {
            // Port not listening yet — the server is still booting.
            if Instant::now() >= deadline {
                return Err(format!("server never accepted a connection: {err}"));
            }
        } else {
            // Connected but no usable response: the app is likely blocked on
            // the waking database (timeout) or restarted mid-request. Retry
            // so it gets a full run once ready, but cap it so a port that
            // isn't HTTP at all doesn't get hammered for the whole deadline.
            failures += 1;
            if failures >= timing.max_failures {
                return Err(format!("failed {failures} times, last: {err}"));
            }
            if err.is_timeout() {
                continue;
            }
        }
        tokio::time::sleep(timing.poll_interval).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    const FAST: WarmUpTiming = WarmUpTiming {
        boot_deadline: Duration::from_secs(2),
        poll_interval: Duration::from_millis(50),
        request_timeout: Duration::from_millis(200),
        max_failures: 2,
    };

    /// Reserve a free port, then release it so nothing is listening yet.
    async fn free_port() -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        listener.local_addr().unwrap().port()
    }

    async fn serve_once(listener: TcpListener) {
        let (mut sock, _) = listener.accept().await.unwrap();
        let mut buf = [0u8; 1024];
        let _ = sock.read(&mut buf).await;
        let _ = sock
            .write_all(b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n")
            .await;
    }

    #[tokio::test]
    async fn waits_for_server_that_boots_late() {
        let port = free_port().await;
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(300)).await;
            let listener = TcpListener::bind(("127.0.0.1", port)).await.unwrap();
            serve_once(listener).await;
        });

        let status = warm_up(&format!("http://127.0.0.1:{port}/"), FAST).await.unwrap();
        assert_eq!(status, reqwest::StatusCode::NO_CONTENT);
    }

    #[tokio::test]
    async fn gives_up_when_server_never_starts() {
        let port = free_port().await;
        let err = warm_up(&format!("http://127.0.0.1:{port}/"), FAST).await.unwrap_err();
        assert!(err.contains("never accepted"), "{err}");
    }

    #[tokio::test]
    async fn retries_after_connection_dropped_without_response() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            // First connection: read the request, then hang up mid-flight.
            let (mut sock, _) = listener.accept().await.unwrap();
            let mut buf = [0u8; 1024];
            let _ = sock.read(&mut buf).await;
            drop(sock);
            serve_once(listener).await;
        });

        let status = warm_up(&format!("http://127.0.0.1:{port}/"), FAST).await.unwrap();
        assert_eq!(status, reqwest::StatusCode::NO_CONTENT);
    }

    #[tokio::test]
    async fn gives_up_after_repeated_timeouts() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        // Accept connections but never answer.
        tokio::spawn(async move {
            let mut held = Vec::new();
            while let Ok((sock, _)) = listener.accept().await {
                held.push(sock);
            }
        });

        let err = warm_up(&format!("http://127.0.0.1:{port}/"), FAST).await.unwrap_err();
        assert!(err.contains("failed 2 times"), "{err}");
    }
}
