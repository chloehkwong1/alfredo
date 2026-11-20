//! Detects dev servers listening on a worktree's behalf, whoever started them.

use crate::types::AppError;
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::sync::atomic::AtomicBool;

/// Ports from here up are the OS's ephemeral range (outgoing connections, agent
/// helpers), never a dev server.
const EPHEMERAL_PORT_START: u16 = 49152;

pub struct Listener {
    pub pid: u32,
    pub port: u16,
}

pub struct ProcInfo {
    pub ppid: u32,
    pub name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedServer {
    pub worktree_path: String,
    pub ports: Vec<u16>,
}

/// Parse `lsof -nP -iTCP -sTCP:LISTEN -Fpn`: `p<pid>` lines open a process,
/// `n<addr>:<port>` lines are its listening sockets. Names without a numeric
/// port are skipped.
fn parse_lsof_listeners(raw: &str) -> Vec<Listener> {
    let mut listeners = Vec::new();
    let mut pid = None;
    for line in raw.lines() {
        if let Some(value) = line.strip_prefix('p') {
            pid = value.parse().ok();
        } else if let Some(name) = line.strip_prefix('n') {
            let port = name.rsplit_once(':').and_then(|(_, port)| port.parse().ok());
            if let (Some(pid), Some(port)) = (pid, port) {
                listeners.push(Listener { pid, port });
            }
        }
    }
    listeners
}

/// Parse `lsof -a -d cwd -p <pid,pid> -Fn` into pid -> working directory.
fn parse_lsof_cwds(raw: &str) -> HashMap<u32, String> {
    let mut cwds = HashMap::new();
    let mut pid = None;
    for line in raw.lines() {
        if let Some(value) = line.strip_prefix('p') {
            pid = value.parse().ok();
        } else if let Some(path) = line.strip_prefix('n') {
            if let Some(pid) = pid {
                cwds.insert(pid, path.to_string());
            }
        }
    }
    cwds
}

/// Parse `ps -A -o pid=,ppid=,comm=`. The name is the rest of the line, since
/// process names can contain spaces.
fn parse_ps_table(raw: &str) -> HashMap<u32, ProcInfo> {
    raw.lines()
        .filter_map(|line| {
            let (pid, rest) = line.trim_start().split_once(char::is_whitespace)?;
            let (ppid, name) = rest.trim_start().split_once(char::is_whitespace)?;
            let name = name.trim();
            if name.is_empty() {
                return None;
            }
            Some((
                pid.parse().ok()?,
                ProcInfo {
                    ppid: ppid.parse().ok()?,
                    name: name.to_string(),
                },
            ))
        })
        .collect()
}

/// The last path component of a process name, minus the leading `-` that login
/// shells carry.
fn proc_basename(name: &str) -> &str {
    let base = name.rsplit('/').next().unwrap_or(name);
    base.strip_prefix('-').unwrap_or(base)
}

/// The worktree that contains `cwd`: the longest one that is `cwd` itself or a
/// path-boundary ancestor of it. Trailing slashes are ignored when comparing,
/// and the caller's spelling of the worktree is returned.
fn worktree_for_cwd<'a>(cwd: &str, worktrees: &'a [String]) -> Option<&'a str> {
    let cwd = cwd.trim_end_matches('/');
    worktrees
        .iter()
        .filter(|worktree| {
            let root = worktree.trim_end_matches('/');
            cwd == root || cwd.strip_prefix(root).is_some_and(|rest| rest.starts_with('/'))
        })
        .max_by_key(|worktree| worktree.trim_end_matches('/').len())
        .map(String::as_str)
}

/// Group listeners by the worktree their process runs in. Protected pids,
/// ephemeral ports, pids with no known cwd and cwds outside every worktree are
/// dropped. Ports are deduplicated and ascending; output is sorted by worktree.
fn select_servers(
    listeners: &[Listener],
    cwds: &HashMap<u32, String>,
    protected: &HashSet<u32>,
    worktrees: &[String],
) -> Vec<DetectedServer> {
    let mut by_worktree: BTreeMap<&str, BTreeSet<u16>> = BTreeMap::new();
    for listener in listeners {
        if protected.contains(&listener.pid) || listener.port >= EPHEMERAL_PORT_START {
            continue;
        }
        let Some(worktree) = cwds
            .get(&listener.pid)
            .and_then(|cwd| worktree_for_cwd(cwd, worktrees))
        else {
            continue;
        };
        by_worktree.entry(worktree).or_default().insert(listener.port);
    }
    by_worktree
        .into_iter()
        .map(|(worktree, ports)| DetectedServer {
            worktree_path: worktree.to_string(),
            ports: ports.into_iter().collect(),
        })
        .collect()
}

/// Processes a stop must never touch: init, Alfredo itself, its terminal
/// shells, and every Claude or Codex agent.
fn protected_pids(
    procs: &HashMap<u32, ProcInfo>,
    pty_pids: &HashSet<u32>,
    own_pid: u32,
) -> HashSet<u32> {
    let mut protected: HashSet<u32> = pty_pids.iter().copied().collect();
    protected.extend([0, 1, own_pid]);
    protected.extend(
        procs
            .iter()
            .filter(|(_, info)| matches!(proc_basename(&info.name), "claude" | "codex"))
            .map(|(pid, _)| *pid),
    );
    protected
}

const MAX_ROOT_WALK: usize = 32;

/// Walk up from the listener to the top of the process tree that belongs to
/// this worktree's server. Stops below a protected process, init, an unknown
/// ancestor, or one whose cwd is outside the worktree.
fn find_root(
    listener_pid: u32,
    procs: &HashMap<u32, ProcInfo>,
    cwds: &HashMap<u32, String>,
    protected: &HashSet<u32>,
    worktree: &str,
) -> u32 {
    let worktrees = [worktree.to_string()];
    let mut root = listener_pid;
    for _ in 0..MAX_ROOT_WALK {
        let Some(parent) = procs.get(&root).map(|info| info.ppid) else {
            break;
        };
        let inside = procs.contains_key(&parent)
            && cwds
                .get(&parent)
                .is_some_and(|cwd| worktree_for_cwd(cwd, &worktrees).is_some());
        if parent <= 1 || protected.contains(&parent) || !inside {
            break;
        }
        root = parent;
    }
    root
}

/// What to signal to stop the server behind `listener_pid` under `root`.
/// A shell root is kept, along with its other jobs: only the job on the
/// listener's ancestor chain is stopped. Any other root is stopped with all
/// of its descendants. Protected processes and their subtrees are always
/// spared. Ascending.
fn kill_targets(
    root: u32,
    listener_pid: u32,
    procs: &HashMap<u32, ProcInfo>,
    protected: &HashSet<u32>,
) -> Vec<u32> {
    let root_is_shell = procs.get(&root).is_some_and(|info| {
        matches!(
            proc_basename(&info.name),
            "sh" | "bash" | "zsh" | "fish" | "dash" | "login"
        )
    });
    let start = if root_is_shell && listener_pid != root {
        let mut job = listener_pid;
        let mut found = false;
        for _ in 0..MAX_ROOT_WALK {
            match procs.get(&job) {
                Some(info) if info.ppid == root => {
                    found = true;
                    break;
                }
                Some(info) => job = info.ppid,
                None => break,
            }
        }
        if !found {
            return Vec::new();
        }
        job
    } else {
        root
    };
    if protected.contains(&start) {
        return Vec::new();
    }

    let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
    for (pid, info) in procs {
        children.entry(info.ppid).or_default().push(*pid);
    }
    let mut targets = HashSet::new();
    let mut stack = vec![start];
    while let Some(pid) = stack.pop() {
        for &child in children.get(&pid).into_iter().flatten() {
            if !protected.contains(&child) && targets.insert(child) {
                stack.push(child);
            }
        }
    }
    targets.insert(start);
    let mut targets: Vec<u32> = targets.into_iter().collect();
    targets.sort_unstable();
    targets
}

/// Run a command with a 2 s timeout. `lsof` exits 1 when it finds nothing or
/// could not read some process (it still prints the rest), so `lenient` accepts
/// exit 1; any other failed status is an error. The error is the reason only.
async fn run_capture(program: &str, args: &[&str], lenient: bool) -> Result<String, String> {
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        tokio::process::Command::new(program)
            .args(args)
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| format!("{program} timed out"))?
    .map_err(|e| format!("{program} did not start: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    if !(output.status.success() || lenient && output.status.code() == Some(1)) {
        return Err(format!("{program} exited {}", output.status));
    }
    Ok(stdout)
}

fn pid_list(pids: impl IntoIterator<Item = u32>) -> String {
    let unique: BTreeSet<u32> = pids.into_iter().collect();
    unique
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(",")
}

async fn lookup_cwds(pids: impl IntoIterator<Item = u32>) -> Result<HashMap<u32, String>, String> {
    let list = pid_list(pids);
    if list.is_empty() {
        return Ok(HashMap::new());
    }
    let raw = run_capture("lsof", &["-a", "-d", "cwd", "-p", &list, "-Fn"], true).await?;
    Ok(parse_lsof_cwds(&raw))
}

/// What one pass over the machine saw.
struct Scan {
    listeners: Vec<Listener>,
    cwds: HashMap<u32, String>,
    procs: HashMap<u32, ProcInfo>,
    protected: HashSet<u32>,
}

async fn scan(extra_protected: &HashSet<u32>) -> Result<Scan, String> {
    let raw = run_capture("lsof", &["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpn"], true).await?;
    let listeners = parse_lsof_listeners(&raw);
    let cwds = lookup_cwds(listeners.iter().map(|l| l.pid)).await?;
    let procs = parse_ps_table(&run_capture("ps", &["-A", "-o", "pid=,ppid=,comm="], false).await?);
    let pty_pids: HashSet<u32> = tokio::task::spawn_blocking(|| {
        crate::pty_manager::session_pids_in(std::path::Path::new("/tmp"))
    })
    .await
    .map_err(|_| "the pid file scan panicked".to_string())?
    .into_keys()
    .collect();
    let mut protected = protected_pids(&procs, &pty_pids, std::process::id());
    protected.extend(extra_protected);
    Ok(Scan {
        listeners,
        cwds,
        procs,
        protected,
    })
}

fn canonical(path: &str) -> String {
    std::fs::canonicalize(path)
        .ok()
        .and_then(|p| p.to_str().map(str::to_string))
        .unwrap_or_else(|| path.to_string())
}

fn log_once(seen: &AtomicBool, reason: &str) {
    if crate::commands::claude_registry::first_failure(seen) {
        eprintln!("[dev-servers] detection unavailable (logged once per app run): {reason}");
    }
}

/// Servers per worktree, in the caller's spelling. Any lookup failure yields an
/// empty list (logged once per app run): a poll must never fail loudly.
async fn detect(worktree_paths: &[String]) -> Vec<DetectedServer> {
    static FAILURE_LOGGED: AtomicBool = AtomicBool::new(false);
    let mut originals: HashMap<String, Vec<&String>> = HashMap::new();
    for path in worktree_paths {
        originals.entry(canonical(path)).or_default().push(path);
    }
    let canon: Vec<String> = originals.keys().cloned().collect();
    let scan = match scan(&HashSet::new()).await {
        Ok(scan) => scan,
        Err(reason) => {
            log_once(&FAILURE_LOGGED, &reason);
            return Vec::new();
        }
    };
    let mut servers: Vec<DetectedServer> =
        select_servers(&scan.listeners, &scan.cwds, &scan.protected, &canon)
            .into_iter()
            .flat_map(|server| {
                originals
                    .get(&server.worktree_path)
                    .into_iter()
                    .flatten()
                    .map(|original| DetectedServer {
                        worktree_path: (*original).clone(),
                        ports: server.ports.clone(),
                    })
                    .collect::<Vec<_>>()
            })
            .collect();
    servers.sort_by(|a, b| a.worktree_path.cmp(&b.worktree_path));
    servers
}

#[tauri::command]
pub async fn detect_dev_servers(
    worktree_paths: Vec<String>,
) -> Result<Vec<DetectedServer>, AppError> {
    Ok(detect(&worktree_paths).await)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StopDetectedResult {
    pub stopped: Vec<u32>,
    pub still_listening: Vec<u16>,
}

fn is_alive(pid: u32) -> bool {
    // SAFETY: signal 0 only checks that the process exists.
    unsafe { libc::kill(pid as i32, 0) == 0 }
}

fn signal(pids: &[u32], sig: i32) {
    for &pid in pids {
        // SAFETY: plain kill(2); a pid that already exited just returns ESRCH.
        unsafe {
            libc::kill(pid as i32, sig);
        }
    }
}

/// Stop every non-protected server running for `worktree_path`: SIGTERM, up to
/// 3 s of grace, then SIGKILL. Reports what was signalled and any port still
/// listening afterwards. Nothing listening is success with nothing stopped.
#[tauri::command]
pub async fn stop_detected_servers(worktree_path: String) -> Result<StopDetectedResult, AppError> {
    static FAILURE_LOGGED: AtomicBool = AtomicBool::new(false);
    static REGISTRY_FAILURE_LOGGED: AtomicBool = AtomicBool::new(false);
    let nothing = StopDetectedResult {
        stopped: Vec::new(),
        still_listening: Vec::new(),
    };
    let worktree = canonical(&worktree_path);
    let worktrees = [worktree.clone()];

    let registry_pids: HashSet<u32> = match crate::commands::claude_registry::poll_claude_registry()
        .await
    {
        Ok(entries) => entries.into_iter().map(|e| e.pid).collect(),
        Err(e) => {
            if crate::commands::claude_registry::first_failure(&REGISTRY_FAILURE_LOGGED) {
                eprintln!("[dev-servers] claude registry not consulted (logged once per app run): {e}");
            }
            HashSet::new()
        }
    };
    let mut scan = match scan(&registry_pids).await {
        Ok(scan) => scan,
        Err(reason) => {
            log_once(&FAILURE_LOGGED, &reason);
            return Ok(nothing);
        }
    };
    let listener_pids: BTreeSet<u32> = scan
        .listeners
        .iter()
        .filter(|l| !scan.protected.contains(&l.pid) && l.port < EPHEMERAL_PORT_START)
        .filter(|l| {
            scan.cwds
                .get(&l.pid)
                .is_some_and(|cwd| worktree_for_cwd(cwd, &worktrees).is_some())
        })
        .map(|l| l.pid)
        .collect();
    if listener_pids.is_empty() {
        return Ok(nothing);
    }

    // find_root needs the cwd of every ancestor, not just of the listeners.
    let mut ancestors = HashSet::new();
    for &listener in &listener_pids {
        let mut pid = listener;
        for _ in 0..MAX_ROOT_WALK {
            let Some(parent) = scan.procs.get(&pid).map(|info| info.ppid) else {
                break;
            };
            if parent <= 1 {
                break;
            }
            ancestors.insert(parent);
            pid = parent;
        }
    }
    ancestors.retain(|pid| !scan.cwds.contains_key(pid));
    match lookup_cwds(ancestors).await {
        Ok(more) => scan.cwds.extend(more),
        Err(reason) => {
            log_once(&FAILURE_LOGGED, &reason);
            return Ok(nothing);
        }
    }

    let mut targets = BTreeSet::new();
    for &listener in &listener_pids {
        let root = find_root(listener, &scan.procs, &scan.cwds, &scan.protected, &worktree);
        targets.extend(kill_targets(root, listener, &scan.procs, &scan.protected));
    }
    let targets: Vec<u32> = targets.into_iter().collect();
    signal(&targets, libc::SIGTERM);
    for _ in 0..30 {
        if !targets.iter().any(|&pid| is_alive(pid)) {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    let survivors: Vec<u32> = targets.iter().copied().filter(|&p| is_alive(p)).collect();
    signal(&survivors, libc::SIGKILL);

    let still_listening = detect(std::slice::from_ref(&worktree_path))
        .await
        .into_iter()
        .flat_map(|server| server.ports)
        .collect();
    Ok(StopDetectedResult {
        stopped: targets,
        still_listening,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pairs(listeners: Vec<Listener>) -> Vec<(u32, u16)> {
        listeners.into_iter().map(|l| (l.pid, l.port)).collect()
    }

    #[test]
    fn parses_ipv4_ipv6_and_wildcard_listeners() {
        let raw = "p10\nf5\nn127.0.0.1:3000\nf6\nn[::1]:3000\np11\nf7\nn*:5173\n";
        assert_eq!(
            pairs(parse_lsof_listeners(raw)),
            vec![(10, 3000), (10, 3000), (11, 5173)]
        );
    }

    #[test]
    fn skips_unparseable_name_lines() {
        assert!(parse_lsof_listeners("p10\nf5\nnlocalhost\n").is_empty());
    }

    #[test]
    fn parses_cwds() {
        let cwds = parse_lsof_cwds("p10\nfcwd\nn/a/b\np11\nfcwd\nn/c d/e\n");
        assert_eq!(cwds.get(&10).map(String::as_str), Some("/a/b"));
        assert_eq!(cwds.get(&11).map(String::as_str), Some("/c d/e"));
        assert_eq!(cwds.len(), 2);
    }

    #[test]
    fn parses_ps_names_with_spaces() {
        let table = parse_ps_table(
            "  857     1 /Applications/Alfredo.app/Contents/MacOS/alfredo\n 900   857 Google Chrome Helper\n",
        );
        assert_eq!(table[&857].ppid, 1);
        assert_eq!(table[&900].name, "Google Chrome Helper");
    }

    #[test]
    fn basename_strips_path_and_login_dash() {
        assert_eq!(proc_basename("/Users/x/.local/bin/claude"), "claude");
        assert_eq!(proc_basename("-zsh"), "zsh");
    }

    #[test]
    fn matches_longest_path_boundary_prefix() {
        let worktrees = vec!["/w/florence".to_string(), "/w/florence/nested".to_string()];
        assert_eq!(
            worktree_for_cwd("/w/florence/nested/app", &worktrees),
            Some("/w/florence/nested")
        );
        assert_eq!(worktree_for_cwd("/w/florence.worktrees/x", &worktrees), None);
        assert_eq!(worktree_for_cwd("/w/florence", &worktrees), Some("/w/florence"));
    }

    #[test]
    fn matches_with_trailing_slash_on_worktree() {
        let worktrees = vec!["/w/a/".to_string()];
        assert_eq!(worktree_for_cwd("/w/a/app", &worktrees), Some("/w/a/"));
    }

    fn listener(pid: u32, port: u16) -> Listener {
        Listener { pid, port }
    }

    #[test]
    fn select_drops_protected_ephemeral_and_unmatched() {
        let listeners = vec![
            listener(1, 3011),
            listener(2, 52481),
            listener(3, 3007),
            listener(4, 3000),
            listener(5, 3011),
            listener(6, 4000),
        ];
        let cwds: HashMap<u32, String> = [
            (1, "/w/a/app"),
            (2, "/w/a"),
            (3, "/w/a"),
            (4, "/elsewhere"),
            (5, "/w/a"),
        ]
        .into_iter()
        .map(|(pid, cwd)| (pid, cwd.to_string()))
        .collect();
        let protected: HashSet<u32> = [3].into_iter().collect();
        let servers = select_servers(&listeners, &cwds, &protected, &["/w/a".to_string()]);
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].worktree_path, "/w/a");
        assert_eq!(servers[0].ports, vec![3011]);
    }

    #[test]
    fn select_sorts_ports_ascending() {
        let listeners = vec![listener(1, 5173), listener(2, 3000)];
        let cwds: HashMap<u32, String> = [(1, "/w/a"), (2, "/w/a")]
            .into_iter()
            .map(|(pid, cwd)| (pid, cwd.to_string()))
            .collect();
        let servers = select_servers(&listeners, &cwds, &HashSet::new(), &["/w/a".to_string()]);
        assert_eq!(servers[0].ports, vec![3000, 5173]);
    }

    fn proc_table(rows: &[(u32, u32, &str)]) -> HashMap<u32, ProcInfo> {
        rows.iter()
            .map(|&(pid, ppid, name)| {
                (
                    pid,
                    ProcInfo {
                        ppid,
                        name: name.to_string(),
                    },
                )
            })
            .collect()
    }

    fn cwd_table(pids: &[u32], cwd: &str) -> HashMap<u32, String> {
        pids.iter().map(|&pid| (pid, cwd.to_string())).collect()
    }

    #[test]
    fn protects_claude_codex_pty_and_init() {
        let procs = proc_table(&[
            (10, 1, "claude"),
            (11, 1, "/Users/x/.local/bin/claude"),
            (12, 1, "codex"),
            (13, 1, "ruby"),
        ]);
        let protected = protected_pids(&procs, &HashSet::from([500]), 857);
        for pid in [10, 11, 12, 500, 857, 0, 1] {
            assert!(protected.contains(&pid), "{pid} should be protected");
        }
        assert!(!protected.contains(&13));
    }

    #[test]
    fn overmind_root_is_the_tmux_server() {
        let procs = proc_table(&[
            (4597, 1, "tmux"),
            (4598, 4597, "sh"),
            (4604, 4598, "puma"),
            (4601, 4597, "sh"),
            (5028, 4601, "sidekiq"),
        ]);
        let cwds = cwd_table(&[4597, 4598, 4601, 4604, 5028], "/w/a");
        let protected = protected_pids(&procs, &HashSet::new(), 857);
        let root = find_root(4604, &procs, &cwds, &protected, "/w/a");
        assert_eq!(root, 4597);
        assert_eq!(
            kill_targets(root, 4604, &procs, &protected),
            vec![4597, 4598, 4601, 4604, 5028]
        );
    }

    #[test]
    fn claude_shell_root_survives() {
        let procs = proc_table(&[
            (12591, 1, "claude"),
            (52209, 12591, "zsh"),
            (52300, 52209, "puma"),
            (190, 52300, "worker"),
        ]);
        let cwds = cwd_table(&[12591, 52209, 52300, 190], "/w/a");
        let protected = protected_pids(&procs, &HashSet::new(), 857);
        let root = find_root(52300, &procs, &cwds, &protected, "/w/a");
        assert_eq!(root, 52209);
        assert_eq!(kill_targets(root, 52300, &procs, &protected), vec![190, 52300]);
    }

    #[test]
    fn alfredo_tab_shell_is_protected() {
        let procs = proc_table(&[(700, 1, "zsh"), (701, 700, "puma")]);
        let cwds = cwd_table(&[700, 701], "/w/a");
        let protected = protected_pids(&procs, &HashSet::from([700]), 857);
        let root = find_root(701, &procs, &cwds, &protected, "/w/a");
        assert_eq!(root, 701);
        assert_eq!(kill_targets(root, 701, &procs, &protected), vec![701]);
    }

    #[test]
    fn terminal_shell_stops_at_cwd_outside_worktree() {
        let procs = proc_table(&[
            (300, 1, "Terminal"),
            (301, 300, "login"),
            (302, 301, "zsh"),
            (303, 302, "puma"),
        ]);
        let mut cwds = cwd_table(&[300, 301], "/");
        cwds.extend(cwd_table(&[302, 303], "/w/a"));
        let protected = protected_pids(&procs, &HashSet::new(), 857);
        let root = find_root(303, &procs, &cwds, &protected, "/w/a");
        assert_eq!(root, 302);
        assert_eq!(kill_targets(root, 303, &procs, &protected), vec![303]);
    }

    #[test]
    fn sibling_path_prefix_counts_as_outside() {
        let procs = proc_table(&[(50, 1, "zsh"), (51, 50, "puma")]);
        let mut cwds = cwd_table(&[50], "/w/ab");
        cwds.extend(cwd_table(&[51], "/w/a/sub"));
        let protected = protected_pids(&procs, &HashSet::new(), 857);
        assert_eq!(find_root(51, &procs, &cwds, &protected, "/w/a"), 51);
    }

    #[test]
    fn orphan_worker_is_its_own_root() {
        let procs = proc_table(&[(98306, 1, "worker")]);
        let cwds = cwd_table(&[98306], "/w/a");
        let protected = protected_pids(&procs, &HashSet::new(), 857);
        let root = find_root(98306, &procs, &cwds, &protected, "/w/a");
        assert_eq!(root, 98306);
        assert_eq!(kill_targets(root, 98306, &procs, &protected), vec![98306]);
    }

    #[test]
    fn protected_subtree_is_skipped() {
        let procs = proc_table(&[
            (10, 1, "tmux"),
            (11, 10, "ruby"),
            (12, 10, "claude"),
            (13, 12, "node"),
        ]);
        let protected = protected_pids(&procs, &HashSet::new(), 857);
        assert_eq!(kill_targets(10, 11, &procs, &protected), vec![10, 11]);
    }

    #[test]
    fn walk_survives_missing_ancestor() {
        let procs = proc_table(&[(20, 19, "puma")]);
        let cwds = cwd_table(&[20], "/w/a");
        let protected = protected_pids(&procs, &HashSet::new(), 857);
        assert_eq!(find_root(20, &procs, &cwds, &protected, "/w/a"), 20);
    }

    #[test]
    fn personal_tmux_started_in_worktree_counts_as_root() {
        let procs = proc_table(&[(40, 1, "tmux"), (41, 40, "zsh"), (42, 41, "puma")]);
        let cwds = cwd_table(&[40, 41, 42], "/w/a");
        let protected = protected_pids(&procs, &HashSet::new(), 857);
        let root = find_root(42, &procs, &cwds, &protected, "/w/a");
        assert_eq!(root, 40);
        assert!(kill_targets(root, 42, &procs, &protected).contains(&40));
    }

    #[test]
    fn shell_root_spares_its_other_jobs() {
        let procs = proc_table(&[
            (302, 1, "zsh"),
            (303, 302, "puma"),
            (304, 303, "worker"),
            (305, 302, "vim"),
            (306, 302, "rails"),
        ]);
        let protected = protected_pids(&procs, &HashSet::new(), 857);
        assert_eq!(kill_targets(302, 304, &procs, &protected), vec![303, 304]);
    }

    #[test]
    fn shell_root_that_is_the_listener_targets_only_itself() {
        let procs = proc_table(&[(301, 1, "login"), (302, 301, "zsh"), (303, 302, "vim")]);
        let protected = protected_pids(&procs, &HashSet::new(), 857);
        assert_eq!(kill_targets(302, 302, &procs, &protected), vec![302, 303]);
    }

    #[test]
    fn broken_chain_returns_nothing() {
        let procs = proc_table(&[(302, 1, "zsh"), (304, 399, "worker")]);
        let protected = protected_pids(&procs, &HashSet::new(), 857);
        assert!(kill_targets(302, 304, &procs, &protected).is_empty());
    }

    #[test]
    fn protected_start_returns_nothing() {
        let procs = proc_table(&[(302, 1, "zsh"), (303, 302, "claude"), (304, 303, "node")]);
        let protected = protected_pids(&procs, &HashSet::new(), 857);
        assert!(kill_targets(302, 303, &procs, &protected).is_empty());
    }

    fn tool_available(tool: &str) -> bool {
        std::process::Command::new("which")
            .arg(tool)
            .output()
            .is_ok_and(|o| o.status.success())
    }

    /// Start python's http.server in `dir` on a free port below 49152.
    fn spawn_server(dir: &std::path::Path) -> Option<(std::process::Child, u16)> {
        // Tests run in parallel: a shared counter keeps them off each other's port.
        static NEXT_PORT: std::sync::atomic::AtomicU16 = std::sync::atomic::AtomicU16::new(41000);
        let port = loop {
            let p = NEXT_PORT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            if p >= 41100 {
                return None;
            }
            if std::net::TcpListener::bind(("127.0.0.1", p)).is_ok() {
                break p;
            }
        };
        let child = std::process::Command::new("python3")
            .args(["-m", "http.server", &port.to_string(), "--bind", "127.0.0.1"])
            .current_dir(dir)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .ok()?;
        Some((child, port))
    }

    async fn wait_detected(path: &str, port: u16) {
        for _ in 0..50 {
            let servers = detect_dev_servers(vec![path.to_string()]).await.unwrap();
            if servers.len() == 1 && servers[0].ports == vec![port] && servers[0].worktree_path == path
            {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
        panic!("server on {port} not detected for {path}");
    }

    async fn real_listener_round_trip(dir: &std::path::Path) {
        let path = dir.to_str().unwrap().to_string();
        let (mut child, port) = spawn_server(dir).expect("could not start python http.server");
        wait_detected(&path, port).await;
        let result = stop_detected_servers(path.clone()).await.unwrap();
        assert!(result.stopped.contains(&child.id()), "{:?}", result.stopped);
        assert!(result.still_listening.is_empty());
        for _ in 0..10 {
            if child.try_wait().unwrap().is_some() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
        assert!(child.try_wait().unwrap().is_some());
        let again = stop_detected_servers(path).await.unwrap();
        assert!(again.stopped.is_empty() && again.still_listening.is_empty());
        let _ = child.wait();
    }

    #[tokio::test]
    async fn detects_and_stops_a_real_listener() {
        if !tool_available("lsof") || !tool_available("python3") {
            eprintln!("skipping: lsof or python3 missing");
            return;
        }
        let dir = tempfile::TempDir::new().unwrap();
        real_listener_round_trip(dir.path()).await;
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn canonicalizes_tmp_paths() {
        if !tool_available("lsof") || !tool_available("python3") {
            eprintln!("skipping: lsof or python3 missing");
            return;
        }
        let dir = tempfile::TempDir::new_in("/tmp").unwrap();
        assert!(dir.path().starts_with("/tmp"));
        real_listener_round_trip(dir.path()).await;
    }

    #[tokio::test]
    async fn stop_is_idempotent() {
        if !tool_available("lsof") {
            eprintln!("skipping: lsof missing");
            return;
        }
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().to_str().unwrap().to_string();
        for _ in 0..2 {
            let result = stop_detected_servers(path.clone()).await.unwrap();
            assert!(result.stopped.is_empty() && result.still_listening.is_empty());
        }
    }
}
