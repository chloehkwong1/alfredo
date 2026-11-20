//! Detects dev servers listening on a worktree's behalf, whoever started them.

use crate::types::AppError;
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::sync::atomic::AtomicBool;

/// The first number of `/proc/sys/net/ipv4/ip_local_port_range` ("32768\t60999").
#[cfg(any(target_os = "linux", test))]
fn parse_port_range_low(raw: &str) -> Option<u16> {
    raw.split_whitespace().next()?.parse().ok()
}

/// Ports from here up are the OS's ephemeral range (outgoing connections, agent
/// helpers), never a dev server. macOS uses 49152; Linux reads its configured
/// range (default 32768).
fn ephemeral_port_start() -> u16 {
    #[cfg(target_os = "linux")]
    {
        static START: std::sync::OnceLock<u16> = std::sync::OnceLock::new();
        *START.get_or_init(|| {
            std::fs::read_to_string("/proc/sys/net/ipv4/ip_local_port_range")
                .ok()
                .and_then(|raw| parse_port_range_low(&raw))
                .unwrap_or(32768)
        })
    }
    #[cfg(not(target_os = "linux"))]
    {
        49152
    }
}

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
            let port = name
                .rsplit_once(':')
                .and_then(|(_, port)| port.parse().ok());
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
            cwd == root
                || cwd
                    .strip_prefix(root)
                    .is_some_and(|rest| rest.starts_with('/'))
        })
        .max_by_key(|worktree| worktree.trim_end_matches('/').len())
        .map(String::as_str)
}

/// Each stoppable listener paired with the worktree it belongs to (the longest
/// match among `worktrees`). Protected pids, ephemeral ports, pids with no known
/// cwd and cwds outside every worktree are dropped.
fn assign_listeners<'a, 'b>(
    listeners: &'b [Listener],
    cwds: &HashMap<u32, String>,
    protected: &HashSet<u32>,
    worktrees: &'a [String],
) -> Vec<(&'a str, &'b Listener)> {
    listeners
        .iter()
        .filter(|l| !protected.contains(&l.pid) && l.port < ephemeral_port_start())
        .filter_map(|l| {
            let worktree = cwds
                .get(&l.pid)
                .and_then(|cwd| worktree_for_cwd(cwd, worktrees))?;
            Some((worktree, l))
        })
        .collect()
}

/// Pids to stop for `target`: its own listeners only, never those of a worktree
/// nested inside it.
fn stop_listener_pids(
    listeners: &[Listener],
    cwds: &HashMap<u32, String>,
    protected: &HashSet<u32>,
    worktrees: &[String],
    target: &str,
) -> BTreeSet<u32> {
    assign_listeners(listeners, cwds, protected, worktrees)
        .into_iter()
        .filter(|(worktree, _)| *worktree == target)
        .map(|(_, l)| l.pid)
        .collect()
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
    for (worktree, listener) in assign_listeners(listeners, cwds, protected, worktrees) {
        by_worktree
            .entry(worktree)
            .or_default()
            .insert(listener.port);
    }
    by_worktree
        .into_iter()
        .map(|(worktree, ports)| DetectedServer {
            worktree_path: worktree.to_string(),
            ports: ports.into_iter().collect(),
        })
        .collect()
}

const SHELLS: [&str; 6] = ["sh", "bash", "zsh", "fish", "dash", "login"];

fn is_shell_name(name: &str) -> bool {
    SHELLS.contains(&proc_basename(name))
}

/// A Claude or Codex agent, by its process name or its command line: an npm
/// install runs as `node`, so only the args name it.
fn is_agent(name: &str, args: Option<&str>) -> bool {
    if matches!(proc_basename(name), "claude" | "codex") {
        return true;
    }
    let Some(args) = args else {
        return false;
    };
    let mut words = args.split_whitespace();
    let mut program = proc_basename(words.next().unwrap_or(""));
    // `node /opt/homebrew/bin/claude …`: the script names the agent.
    if matches!(program, "node" | "bun") {
        program = proc_basename(words.find(|w| !w.starts_with('-')).unwrap_or(""));
    }
    program == "claude"
        || program.starts_with("codex")
        || args.contains("@anthropic-ai/claude-code")
        || args.contains("@openai/codex")
}

/// Processes a stop must never touch: init, Alfredo itself and its ancestors,
/// its terminal shells, every Claude or Codex agent, and each agent's non-shell
/// children (its MCP servers).
fn protected_pids(
    procs: &HashMap<u32, ProcInfo>,
    args: &HashMap<u32, String>,
    pty_pids: &HashSet<u32>,
    own_pid: u32,
) -> HashSet<u32> {
    let mut protected: HashSet<u32> = pty_pids.iter().copied().collect();
    protected.extend([0, 1, own_pid]);
    // Under `npm run tauri dev` Alfredo's parents (npm, cargo) must survive too.
    let mut pid = own_pid;
    for _ in 0..MAX_ROOT_WALK {
        match procs.get(&pid).map(|info| info.ppid) {
            Some(parent) if parent > 1 => {
                protected.insert(parent);
                pid = parent;
            }
            _ => break,
        }
    }
    let agents: HashSet<u32> = procs
        .iter()
        .filter(|(pid, info)| is_agent(&info.name, args.get(pid).map(String::as_str)))
        .map(|(pid, _)| *pid)
        .collect();
    protected.extend(
        procs
            .iter()
            .filter(|(_, info)| agents.contains(&info.ppid) && !is_shell_name(&info.name))
            .map(|(pid, _)| *pid),
    );
    protected.extend(agents);
    protected
}

const MAX_ROOT_WALK: usize = 32;

/// A macOS app (an editor or terminal launched from a worktree): never a root
/// and never a target, except as the listener itself (Homebrew's python is a
/// `Python.app` and is a legitimate server).
fn is_app_bundle(procs: &HashMap<u32, ProcInfo>, pid: u32) -> bool {
    procs
        .get(&pid)
        .is_some_and(|info| info.name.contains(".app/"))
}

/// A tmux, screen or zellij that is someone's own session (not overmind's):
/// the walk stops below it, so a pane's interactive shell becomes the root and
/// is spared by the shell rule.
fn is_personal_multiplexer(
    procs: &HashMap<u32, ProcInfo>,
    args: &HashMap<u32, String>,
    pid: u32,
) -> bool {
    procs.get(&pid).is_some_and(|info| {
        let base = proc_basename(&info.name).to_ascii_lowercase();
        ["tmux", "screen", "zellij"]
            .iter()
            .any(|m| base.starts_with(m))
    }) && !args.get(&pid).is_some_and(|a| a.contains("overmind-"))
}

/// Parse `ps -A -o pid=,args=` into pid -> full command line.
fn parse_ps_args(raw: &str) -> HashMap<u32, String> {
    raw.lines()
        .filter_map(|line| {
            let (pid, args) = line.trim_start().split_once(char::is_whitespace)?;
            Some((pid.parse().ok()?, args.trim().to_string()))
        })
        .collect()
}

/// A shell someone types into (`-zsh`, `zsh -il`, `/bin/zsh`): a shell name
/// whose args carry no `-c` and no script. `zsh -c …` (Claude's Bash tool) and
/// `sh /tmp/overmind-x/web` (an overmind pane) run a command and are not.
/// Unknown args count as interactive, the side that kills less.
fn is_interactive_shell(
    procs: &HashMap<u32, ProcInfo>,
    args: &HashMap<u32, String>,
    pid: u32,
) -> bool {
    if !procs
        .get(&pid)
        .is_some_and(|info| is_shell_name(&info.name))
    {
        return false;
    }
    let Some(args) = args.get(&pid) else {
        return true;
    };
    let mut words = args.split_whitespace().skip(1);
    while let Some(arg) = words.next() {
        // These take a value (nix-shell runs `bash --rcfile <file>`): skip it.
        if matches!(arg, "--rcfile" | "--init-file" | "-o" | "+o" | "-O" | "+O") {
            words.next();
        } else if arg.starts_with("--") {
            continue;
        } else if arg.starts_with('-') || arg.starts_with('+') {
            // `-c`, or a cluster that includes it (`-lc`).
            if arg[1..].contains('c') {
                return false;
            }
        } else {
            return false; // a script
        }
    }
    true
}

/// Walk up from the listener to the top of the process tree that belongs to
/// this worktree's server. Stops below a protected process, init, an unknown
/// ancestor, or one whose cwd is outside the worktree, and at the first
/// interactive shell (which becomes the root, so the shell rule spares it).
fn find_root(
    listener_pid: u32,
    procs: &HashMap<u32, ProcInfo>,
    cwds: &HashMap<u32, String>,
    protected: &HashSet<u32>,
    args: &HashMap<u32, String>,
    worktree: &str,
) -> u32 {
    let worktrees = [worktree.to_string()];
    let mut root = listener_pid;
    for _ in 0..MAX_ROOT_WALK {
        if is_interactive_shell(procs, args, root) {
            break;
        }
        let Some(parent) = procs.get(&root).map(|info| info.ppid) else {
            break;
        };
        let inside = procs.contains_key(&parent)
            && cwds
                .get(&parent)
                .is_some_and(|cwd| worktree_for_cwd(cwd, &worktrees).is_some());
        if parent <= 1
            || protected.contains(&parent)
            || is_app_bundle(procs, parent)
            || is_personal_multiplexer(procs, args, parent)
            || !inside
        {
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
    let root_is_shell = procs
        .get(&root)
        .is_some_and(|info| is_shell_name(&info.name));
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
    if protected.contains(&start) || (start != listener_pid && is_app_bundle(procs, start)) {
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
            if !protected.contains(&child)
                && (child == listener_pid || !is_app_bundle(procs, child))
                && targets.insert(child)
            {
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
    args: HashMap<u32, String>,
    protected: HashSet<u32>,
}

async fn scan() -> Result<Scan, String> {
    let raw = run_capture("lsof", &["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpn"], true).await?;
    let listeners = parse_lsof_listeners(&raw);
    let cwds = lookup_cwds(listeners.iter().map(|l| l.pid)).await?;
    let procs = parse_ps_table(&run_capture("ps", &["-A", "-o", "pid=,ppid=,comm="], false).await?);
    // An npm Claude or Codex is named `node`: only its args can protect it.
    let args = parse_ps_args(&run_capture("ps", &["-A", "-o", "pid=,args="], false).await?);
    let pty_pids: HashSet<u32> = tokio::task::spawn_blocking(|| {
        crate::pty_manager::session_pids_in(std::path::Path::new("/tmp"))
    })
    .await
    .map_err(|_| "the pid file scan panicked".to_string())?
    .into_keys()
    .collect();
    let protected = protected_pids(&procs, &args, &pty_pids, std::process::id());
    Ok(Scan {
        listeners,
        cwds,
        procs,
        args,
        protected,
    })
}

/// The canonical spelling of an existing directory other than `/`; `None` for
/// anything else (empty, root, missing), which would otherwise match every
/// process on the machine.
fn canonical_dir(path: &str) -> Option<String> {
    let canonical = std::fs::canonicalize(path).ok()?;
    if !canonical.is_dir() || canonical == std::path::Path::new("/") {
        return None;
    }
    canonical.to_str().map(str::to_string)
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
        if let Some(canonical) = canonical_dir(path) {
            originals.entry(canonical).or_default().push(path);
        }
    }
    if originals.is_empty() {
        return Vec::new();
    }
    let canon: Vec<String> = originals.keys().cloned().collect();
    let scan = match scan().await {
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
pub async fn stop_detected_servers(
    worktree_path: String,
    worktree_paths: Vec<String>,
) -> Result<StopDetectedResult, AppError> {
    static FAILURE_LOGGED: AtomicBool = AtomicBool::new(false);
    static REGISTRY_FAILURE_LOGGED: AtomicBool = AtomicBool::new(false);
    let nothing = StopDetectedResult {
        stopped: Vec::new(),
        still_listening: Vec::new(),
    };
    let Some(worktree) = canonical_dir(&worktree_path) else {
        return Ok(nothing);
    };
    // Every known worktree, so a nested one's servers are left alone.
    let mut worktrees: Vec<String> = worktree_paths
        .iter()
        .filter_map(|p| canonical_dir(p))
        .collect();
    worktrees.push(worktree.clone());

    let mut scan = match scan().await {
        Ok(scan) => scan,
        Err(reason) => {
            log_once(&FAILURE_LOGGED, &reason);
            return Ok(nothing);
        }
    };
    let mut listener_pids = stop_listener_pids(
        &scan.listeners,
        &scan.cwds,
        &scan.protected,
        &worktrees,
        &worktree,
    );
    if listener_pids.is_empty() {
        return Ok(nothing);
    }

    // The registry costs a CLI call, so it is consulted only when there is
    // something to stop.
    match crate::commands::claude_registry::poll_claude_registry().await {
        Ok(entries) => scan.protected.extend(entries.into_iter().map(|e| e.pid)),
        Err(e) => {
            if crate::commands::claude_registry::first_failure(&REGISTRY_FAILURE_LOGGED) {
                eprintln!(
                    "[dev-servers] claude registry not consulted (logged once per app run): {e}"
                );
            }
        }
    }
    listener_pids.retain(|pid| !scan.protected.contains(pid));
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
        let root = find_root(
            listener,
            &scan.procs,
            &scan.cwds,
            &scan.protected,
            &scan.args,
            &worktree,
        );
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

    // Over every known worktree, so a spared nested server is not blamed on the target.
    let still_listening = detect(&worktrees)
        .await
        .into_iter()
        .filter(|server| server.worktree_path == worktree)
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
        assert_eq!(
            worktree_for_cwd("/w/florence.worktrees/x", &worktrees),
            None
        );
        assert_eq!(
            worktree_for_cwd("/w/florence", &worktrees),
            Some("/w/florence")
        );
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
        let protected = protected_pids(&procs, &HashMap::new(), &HashSet::from([500]), 857);
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
        let protected = protected_pids(&procs, &HashMap::new(), &HashSet::new(), 857);
        let args = HashMap::from([
            (4597, "tmux -C -L overmind-x-1 new".to_string()),
            (4598, "sh /tmp/overmind-x/web".to_string()),
            (4601, "sh /tmp/overmind-x/worker".to_string()),
        ]);
        let root = find_root(4604, &procs, &cwds, &protected, &args, "/w/a");
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
        let args = HashMap::from([(
            52209,
            "/bin/zsh -c source /tmp/claude-shell-snapshot.sh && bin/dev".to_string(),
        )]);
        let protected = protected_pids(&procs, &args, &HashSet::new(), 857);
        let root = find_root(52300, &procs, &cwds, &protected, &args, "/w/a");
        assert_eq!(root, 52209);
        assert_eq!(
            kill_targets(root, 52300, &procs, &protected),
            vec![190, 52300]
        );
    }

    #[test]
    fn alfredo_tab_shell_is_protected() {
        let procs = proc_table(&[(700, 1, "zsh"), (701, 700, "puma")]);
        let cwds = cwd_table(&[700, 701], "/w/a");
        let protected = protected_pids(&procs, &HashMap::new(), &HashSet::from([700]), 857);
        let root = find_root(701, &procs, &cwds, &protected, &HashMap::new(), "/w/a");
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
        let protected = protected_pids(&procs, &HashMap::new(), &HashSet::new(), 857);
        let root = find_root(303, &procs, &cwds, &protected, &HashMap::new(), "/w/a");
        assert_eq!(root, 302);
        assert_eq!(kill_targets(root, 303, &procs, &protected), vec![303]);
    }

    #[test]
    fn sibling_path_prefix_counts_as_outside() {
        let procs = proc_table(&[(50, 1, "zsh"), (51, 50, "puma")]);
        let mut cwds = cwd_table(&[50], "/w/ab");
        cwds.extend(cwd_table(&[51], "/w/a/sub"));
        let protected = protected_pids(&procs, &HashMap::new(), &HashSet::new(), 857);
        assert_eq!(
            find_root(51, &procs, &cwds, &protected, &HashMap::new(), "/w/a"),
            51
        );
    }

    #[test]
    fn orphan_worker_is_its_own_root() {
        let procs = proc_table(&[(98306, 1, "worker")]);
        let cwds = cwd_table(&[98306], "/w/a");
        let protected = protected_pids(&procs, &HashMap::new(), &HashSet::new(), 857);
        let root = find_root(98306, &procs, &cwds, &protected, &HashMap::new(), "/w/a");
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
        let protected = protected_pids(&procs, &HashMap::new(), &HashSet::new(), 857);
        assert_eq!(kill_targets(10, 11, &procs, &protected), vec![10, 11]);
    }

    #[test]
    fn walk_survives_missing_ancestor() {
        let procs = proc_table(&[(20, 19, "puma")]);
        let cwds = cwd_table(&[20], "/w/a");
        let protected = protected_pids(&procs, &HashMap::new(), &HashSet::new(), 857);
        assert_eq!(
            find_root(20, &procs, &cwds, &protected, &HashMap::new(), "/w/a"),
            20
        );
    }

    #[test]
    fn personal_tmux_pane_shell_survives() {
        let procs = proc_table(&[(40, 1, "tmux"), (41, 40, "zsh"), (42, 41, "puma")]);
        let cwds = cwd_table(&[40, 41, 42], "/w/a");
        let protected = protected_pids(&procs, &HashMap::new(), &HashSet::new(), 857);
        let args = HashMap::from([(40, "tmux new -s work".to_string())]);
        let root = find_root(42, &procs, &cwds, &protected, &args, "/w/a");
        assert_eq!(root, 41);
        assert_eq!(kill_targets(root, 42, &procs, &protected), vec![42]);
    }

    #[test]
    fn personal_tmux_root_is_job_only() {
        let procs = proc_table(&[
            (40, 1, "tmux"),
            (41, 40, "zsh"),
            (42, 41, "puma"),
            (43, 41, "worker"),
            (44, 40, "zsh"),
            (45, 44, "vim"),
        ]);
        let cwds = cwd_table(&[40, 41, 42, 43, 44, 45], "/w/a");
        let protected = protected_pids(&procs, &HashMap::new(), &HashSet::new(), 857);
        let args = HashMap::from([(40, "tmux new -s work".to_string())]);
        let root = find_root(42, &procs, &cwds, &protected, &args, "/w/a");
        assert_eq!(kill_targets(root, 42, &procs, &protected), vec![42]);
    }

    #[test]
    fn overmind_tmux_root_is_killed_whole() {
        let procs = proc_table(&[
            (40, 1, "tmux"),
            (41, 40, "zsh"),
            (42, 41, "puma"),
            (43, 40, "zsh"),
            (44, 43, "sidekiq"),
        ]);
        let cwds = cwd_table(&[40, 41, 42, 43, 44], "/w/a");
        let protected = protected_pids(&procs, &HashMap::new(), &HashSet::new(), 857);
        let args = HashMap::from([
            (40, "tmux -C -L overmind-foo-abc new -n web".to_string()),
            (41, "zsh /tmp/overmind-foo-abc/web".to_string()),
            (43, "zsh /tmp/overmind-foo-abc/worker".to_string()),
        ]);
        let root = find_root(42, &procs, &cwds, &protected, &args, "/w/a");
        assert_eq!(root, 40);
        assert_eq!(
            kill_targets(root, 42, &procs, &protected),
            vec![40, 41, 42, 43, 44]
        );
    }

    #[test]
    fn still_listening_ignores_nested_worktree() {
        let listeners = vec![listener(1, 3000), listener(2, 3001)];
        let cwds: HashMap<u32, String> = [(1, "/w/repo"), (2, "/w/repo/.claude/worktrees/x")]
            .into_iter()
            .map(|(pid, cwd)| (pid, cwd.to_string()))
            .collect();
        let worktrees = vec![
            "/w/repo".to_string(),
            "/w/repo/.claude/worktrees/x".to_string(),
        ];
        let servers = select_servers(&listeners, &cwds, &HashSet::new(), &worktrees);
        let target = servers
            .iter()
            .find(|s| s.worktree_path == "/w/repo")
            .unwrap();
        assert_eq!(target.ports, vec![3000]);
    }

    #[test]
    fn app_bundle_is_never_a_root() {
        let procs = proc_table(&[
            (
                10,
                1,
                "/Applications/Visual Studio Code.app/Contents/MacOS/Electron",
            ),
            (11, 10, "zsh"),
            (12, 11, "puma"),
        ]);
        let cwds = cwd_table(&[10, 11, 12], "/w/a");
        let protected = protected_pids(&procs, &HashMap::new(), &HashSet::new(), 857);
        let root = find_root(12, &procs, &cwds, &protected, &HashMap::new(), "/w/a");
        assert_eq!(root, 11);
        assert_eq!(kill_targets(root, 12, &procs, &protected), vec![12]);
    }

    #[test]
    fn protects_alfredo_ancestors() {
        let procs = proc_table(&[
            (1, 0, "launchd"),
            (200, 1, "npm"),
            (201, 200, "cargo"),
            (857, 201, "alfredo"),
            (900, 1, "puma"),
        ]);
        let protected = protected_pids(&procs, &HashMap::new(), &HashSet::new(), 857);
        for pid in [200, 201, 857] {
            assert!(protected.contains(&pid));
        }
        assert!(!protected.contains(&900));
    }

    #[test]
    fn stop_filter_skips_nested_worktree_listener() {
        let listeners = vec![listener(1, 3000), listener(2, 3001)];
        let cwds: HashMap<u32, String> = [(1, "/w/repo"), (2, "/w/repo/.claude/worktrees/x")]
            .into_iter()
            .map(|(pid, cwd)| (pid, cwd.to_string()))
            .collect();
        let worktrees = vec![
            "/w/repo".to_string(),
            "/w/repo/.claude/worktrees/x".to_string(),
        ];
        let pids = stop_listener_pids(&listeners, &cwds, &HashSet::new(), &worktrees, "/w/repo");
        assert_eq!(pids, BTreeSet::from([1]));
    }

    #[test]
    fn parses_ps_args() {
        let args = parse_ps_args("  40     tmux new -s work\n");
        assert_eq!(args[&40], "tmux new -s work");
    }

    #[tokio::test]
    async fn stop_refuses_root_and_empty_paths() {
        for path in ["", "/"] {
            let result = stop_detected_servers(path.to_string(), vec![path.to_string()])
                .await
                .unwrap();
            assert!(result.stopped.is_empty() && result.still_listening.is_empty());
        }
    }

    #[tokio::test]
    async fn detect_skips_root_path() {
        assert!(detect_dev_servers(vec!["/".to_string()])
            .await
            .unwrap()
            .is_empty());
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
        let protected = protected_pids(&procs, &HashMap::new(), &HashSet::new(), 857);
        assert_eq!(kill_targets(302, 304, &procs, &protected), vec![303, 304]);
    }

    #[test]
    fn shell_root_that_is_the_listener_targets_only_itself() {
        let procs = proc_table(&[(301, 1, "login"), (302, 301, "zsh"), (303, 302, "vim")]);
        let protected = protected_pids(&procs, &HashMap::new(), &HashSet::new(), 857);
        assert_eq!(kill_targets(302, 302, &procs, &protected), vec![302, 303]);
    }

    #[test]
    fn broken_chain_returns_nothing() {
        let procs = proc_table(&[(302, 1, "zsh"), (304, 399, "worker")]);
        let protected = protected_pids(&procs, &HashMap::new(), &HashSet::new(), 857);
        assert!(kill_targets(302, 304, &procs, &protected).is_empty());
    }

    #[test]
    fn protected_start_returns_nothing() {
        let procs = proc_table(&[(302, 1, "zsh"), (303, 302, "claude"), (304, 303, "node")]);
        let protected = protected_pids(&procs, &HashMap::new(), &HashSet::new(), 857);
        assert!(kill_targets(302, 303, &procs, &protected).is_empty());
    }

    #[test]
    fn nvim_terminal_server_spares_nvim() {
        let procs = proc_table(&[
            (302, 1, "-zsh"),
            (303, 302, "nvim"),
            (304, 303, "zsh"),
            (305, 304, "puma"),
        ]);
        let cwds = cwd_table(&[302, 303, 304, 305], "/w/a");
        let args = HashMap::from([
            (302, "-zsh".to_string()),
            (303, "nvim .".to_string()),
            (304, "/bin/zsh".to_string()),
            (305, "puma 6.4.2 (tcp://0.0.0.0:3000)".to_string()),
        ]);
        let protected = protected_pids(&procs, &args, &HashSet::new(), 857);
        let root = find_root(305, &procs, &cwds, &protected, &args, "/w/a");
        assert_eq!(root, 304);
        assert_eq!(kill_targets(root, 305, &procs, &protected), vec![305]);
    }

    #[test]
    fn login_dash_zsh_is_a_boundary() {
        let procs = proc_table(&[
            (301, 1, "login"),
            (302, 301, "-zsh"),
            (303, 302, "nix"),
            (304, 303, "zsh"),
            (305, 304, "puma"),
        ]);
        let cwds = cwd_table(&[301, 302, 303, 304, 305], "/w/a");
        let args = HashMap::from([
            (
                301,
                "login -pfl chloe /bin/zsh -c exec -la zsh /bin/zsh".to_string(),
            ),
            (302, "-zsh".to_string()),
            (303, "nix develop".to_string()),
            (304, "zsh -il".to_string()),
        ]);
        let protected = protected_pids(&procs, &args, &HashSet::new(), 857);
        // The nix shell is the first interactive shell: nix and the login shell survive.
        assert_eq!(
            find_root(305, &procs, &cwds, &protected, &args, "/w/a"),
            304
        );
        // Without the inner shell, the walk stops at the login shell `-zsh`.
        let procs = proc_table(&[(301, 1, "login"), (302, 301, "-zsh"), (305, 302, "puma")]);
        assert_eq!(
            find_root(305, &procs, &cwds, &protected, &args, "/w/a"),
            302
        );
        assert_eq!(kill_targets(302, 305, &procs, &protected), vec![305]);
    }

    #[test]
    fn nix_shell_rcfile_bash_is_a_boundary() {
        let procs = proc_table(&[
            (301, 1, "login"),
            (302, 301, "-zsh"),
            (303, 302, "bash"),
            (304, 303, "puma"),
        ]);
        let cwds = cwd_table(&[301, 302, 303, 304], "/w/a");
        let args = HashMap::from([
            (302, "-zsh".to_string()),
            (303, "bash --rcfile /tmp/nix-shell.x/rc".to_string()),
            (304, "puma 6.4.2 (tcp://0.0.0.0:3000)".to_string()),
        ]);
        let protected = protected_pids(&procs, &args, &HashSet::new(), 857);
        let root = find_root(304, &procs, &cwds, &protected, &args, "/w/a");
        assert_eq!(root, 303);
        assert_eq!(kill_targets(root, 304, &procs, &protected), vec![304]);
        for interactive in [
            "bash --init-file /tmp/rc",
            "zsh -o vi",
            "bash +o histexpand",
            "bash -O extglob",
        ] {
            let args = HashMap::from([(303, interactive.to_string())]);
            assert!(is_interactive_shell(&procs, &args, 303), "{interactive}");
        }
        for runs_command in ["bash --rcfile /tmp/rc -c make", "bash -o vi script.sh"] {
            let args = HashMap::from([(303, runs_command.to_string())]);
            assert!(!is_interactive_shell(&procs, &args, 303), "{runs_command}");
        }
    }

    #[test]
    fn protects_npm_claude_run_through_node_by_bin_path() {
        let procs = proc_table(&[(10, 1, "node"), (11, 1, "bun"), (12, 1, "node")]);
        let args = HashMap::from([
            (10, "node /opt/homebrew/bin/claude --resume abc".to_string()),
            (11, "bun --smol /Users/x/.bun/bin/codex exec".to_string()),
            (12, "node /w/a/bin/dev-server.js".to_string()),
        ]);
        let protected = protected_pids(&procs, &args, &HashSet::new(), 857);
        assert!(protected.contains(&10));
        assert!(protected.contains(&11));
        assert!(!protected.contains(&12));
    }

    #[test]
    fn shell_with_unknown_args_is_a_boundary() {
        let procs = proc_table(&[(40, 1, "make"), (41, 40, "sh"), (42, 41, "puma")]);
        let cwds = cwd_table(&[40, 41, 42], "/w/a");
        let protected = protected_pids(&procs, &HashMap::new(), &HashSet::new(), 857);
        assert_eq!(
            find_root(42, &procs, &cwds, &protected, &HashMap::new(), "/w/a"),
            41
        );
    }

    #[test]
    fn protects_npm_claude_and_codex_by_args() {
        let procs = proc_table(&[
            (10, 1, "node"),
            (11, 1, "node"),
            (12, 1, "node"),
            (13, 1, "codex-aarch64-apple-darwin"),
            (14, 1, "node"),
        ]);
        let args = HashMap::from([
            (
                10,
                "node /opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/cli.js".to_string(),
            ),
            (
                11,
                "node /usr/local/lib/node_modules/@openai/codex/bin/codex.js".to_string(),
            ),
            (12, "claude --resume abc".to_string()),
            (
                13,
                "/opt/homebrew/bin/codex-aarch64-apple-darwin exec".to_string(),
            ),
            (14, "node server.js".to_string()),
        ]);
        let protected = protected_pids(&procs, &args, &HashSet::new(), 857);
        for pid in [10, 11, 12, 13] {
            assert!(protected.contains(&pid), "{pid} should be protected");
        }
        assert!(!protected.contains(&14));
    }

    #[test]
    fn mcp_child_of_claude_is_not_a_server() {
        let procs = proc_table(&[
            (10, 1, "node"),
            (11, 10, "node"),
            (12, 10, "zsh"),
            (13, 12, "puma"),
        ]);
        let args = HashMap::from([
            (
                10,
                "node /opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/cli.js".to_string(),
            ),
            (11, "node /w/a/node_modules/.bin/mcp-server".to_string()),
            (12, "/bin/zsh -c bin/dev".to_string()),
        ]);
        let protected = protected_pids(&procs, &args, &HashSet::new(), 857);
        let cwds = cwd_table(&[10, 11, 12, 13], "/w/a");
        let servers = select_servers(
            &[listener(11, 3845), listener(13, 3000)],
            &cwds,
            &protected,
            &["/w/a".to_string()],
        );
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].ports, vec![3000]);
        assert!(kill_targets(11, 11, &procs, &protected).is_empty());
        // The Bash tool's shell is not an MCP child: its server is still stopped.
        let root = find_root(13, &procs, &cwds, &protected, &args, "/w/a");
        assert_eq!(root, 12);
        assert_eq!(kill_targets(root, 13, &procs, &protected), vec![13]);
    }

    #[test]
    fn parse_port_range_low_reads_first_number() {
        assert_eq!(parse_port_range_low("32768\t60999\n"), Some(32768));
        assert_eq!(parse_port_range_low("1024 65535"), Some(1024));
        assert_eq!(parse_port_range_low(""), None);
        assert_eq!(parse_port_range_low("abc 1"), None);
    }

    #[test]
    fn multiplexer_match_is_case_insensitive_prefix() {
        let procs = proc_table(&[
            (40, 1, "tmux: server"),
            (41, 1, "SCREEN"),
            (42, 1, "zellij"),
            (43, 1, "tmuxinator"),
            (44, 1, "zsh"),
        ]);
        let args = HashMap::new();
        for pid in [40, 41, 42, 43] {
            assert!(is_personal_multiplexer(&procs, &args, pid), "{pid}");
        }
        assert!(!is_personal_multiplexer(&procs, &args, 44));
        let overmind = HashMap::from([(40, "tmux: server (/tmp/overmind-x/tmux)".to_string())]);
        assert!(!is_personal_multiplexer(&procs, &overmind, 40));
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
            .args([
                "-m",
                "http.server",
                &port.to_string(),
                "--bind",
                "127.0.0.1",
            ])
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
            if servers.len() == 1
                && servers[0].ports == vec![port]
                && servers[0].worktree_path == path
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
        let result = stop_detected_servers(path.clone(), vec![path.clone()])
            .await
            .unwrap();
        assert!(result.stopped.contains(&child.id()), "{:?}", result.stopped);
        assert!(result.still_listening.is_empty());
        for _ in 0..10 {
            if child.try_wait().unwrap().is_some() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
        assert!(child.try_wait().unwrap().is_some());
        let again = stop_detected_servers(path.clone(), vec![path])
            .await
            .unwrap();
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
            let result = stop_detected_servers(path.clone(), vec![path.clone()])
                .await
                .unwrap();
            assert!(result.stopped.is_empty() && result.still_listening.is_empty());
        }
    }
}
