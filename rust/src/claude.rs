//! Running Claude Code headless as a scoped local agent (`services/claude_code.py`).
//!
//! A prompt on stdin, only the named tools, no MCP servers or saved session, and
//! a JSON schema the answer must match. Claude Code's folder for the run under
//! `~/.claude/projects` is removed afterwards.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use anyhow::{Context, Result, anyhow, bail};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

pub struct Agent<'a> {
    pub model: &'a str,
    pub tools: &'a [&'a str],
    pub allowed_tools: &'a [&'a str],
    pub schema: &'a serde_json::Value,
    pub timeout: Duration,
    pub env: HashMap<String, String>,
}

/// Run one agent in `workdir` and return its answer, which matches the schema.
pub async fn run_agent(
    prompt: &str,
    workdir: &Path,
    agent: Agent<'_>,
) -> Result<serde_json::Map<String, serde_json::Value>> {
    let result = run(prompt, workdir, &agent).await;
    remove_run_folder(workdir);
    result
}

async fn run(
    prompt: &str,
    workdir: &Path,
    agent: &Agent<'_>,
) -> Result<serde_json::Map<String, serde_json::Value>> {
    let mut child = Command::new("claude")
        .arg("-p")
        .args(["--model", agent.model])
        .args(["--tools", &agent.tools.join(",")])
        .arg("--allowedTools")
        .args(agent.allowed_tools)
        .args(["--permission-mode", "dontAsk"])
        .arg("--strict-mcp-config")
        .arg("--no-session-persistence")
        .args(["--output-format", "json"])
        .args(["--json-schema", &agent.schema.to_string()])
        .current_dir(workdir)
        .env_clear()
        .envs(&agent.env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| anyhow!("failed ({})", error.kind()))?;
    let mut stdin = child.stdin.take().context("no stdin")?;
    stdin.write_all(prompt.as_bytes()).await?;
    drop(stdin);
    let output = tokio::time::timeout(agent.timeout, child.wait_with_output())
        .await
        .map_err(|_| anyhow!("failed (timed out)"))??;
    if !output.status.success() {
        bail!("failed (exit {})", output.status.code().unwrap_or(-1));
    }
    let answer: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap_or_default();
    match answer.get("structured_output") {
        Some(serde_json::Value::Object(answer)) => Ok(answer.clone()),
        _ => bail!("gave no answer"),
    }
}

/// Only what Claude Code itself needs; no application secrets.
pub fn claude_environment() -> HashMap<String, String> {
    ["PATH", "HOME", "USER", "LOGNAME", "LANG", "TMPDIR"]
        .into_iter()
        .filter_map(|name| {
            std::env::var(name)
                .ok()
                .map(|value| (name.to_owned(), value))
        })
        .collect()
}

fn claude_projects() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".claude/projects")
}

fn folder_name(path: &str) -> String {
    path.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

/// Delete the folder Claude Code keeps for a run, named after its working directory.
pub fn remove_run_folder(workdir: &Path) {
    let real = std::fs::canonicalize(workdir).unwrap_or_else(|_| workdir.to_path_buf());
    let _ = std::fs::remove_dir_all(claude_projects().join(folder_name(&real.to_string_lossy())));
}

/// Delete working and Claude Code folders that interrupted runs never cleaned up.
pub fn remove_leftovers(prefix: &str) {
    let marker = folder_name(prefix);
    for (directory, needle) in [
        (std::env::temp_dir(), prefix.to_owned()),
        (claude_projects(), marker),
    ] {
        let Ok(entries) = std::fs::read_dir(&directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let matches = if directory == claude_projects() {
                name.contains(&needle)
            } else {
                name.starts_with(&needle)
            };
            if matches {
                let _ = std::fs::remove_dir_all(entry.path());
            }
        }
    }
}
