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
}
