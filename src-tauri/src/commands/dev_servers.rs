//! Detects dev servers listening on a worktree's behalf, whoever started them.
// removed in Task 3 when the commands use these
#![allow(dead_code)]

use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

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
}
