//! Embed the source fingerprint of the Brave worker binary (`browser-worker-sources.txt`).

use std::path::Path;
use std::process::Command;

use sha2::{Digest, Sha256};

fn git(repository: &Path, arguments: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repository)
        .args(arguments)
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

fn main() {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repository = manifest.parent().expect("rust/ sits in the repository");
    let list = std::fs::read_to_string(manifest.join("browser-worker-sources.txt"))
        .expect("browser-worker-sources.txt is readable");
    let paths: Vec<&str> = list
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .collect();
    for path in &paths {
        println!("cargo:rerun-if-changed={}", repository.join(path).display());
    }
    let mut arguments = vec!["ls-tree", "-r", "HEAD", "--"];
    arguments.extend(paths.iter().copied());
    let fingerprint = match git(repository, &arguments) {
        Some(tree) => {
            let blobs: String = tree
                .lines()
                .filter(|line| !line.contains("/tests/"))
                .map(|line| format!("{line}\n"))
                .collect();
            let mut fingerprint = hex::encode(Sha256::digest(blobs.as_bytes()));
            let mut status = vec!["status", "--porcelain", "--"];
            status.extend(paths.iter().copied());
            let changed = git(repository, &status).unwrap_or_default();
            if changed.lines().any(|line| !line.contains("/tests/")) {
                fingerprint.push_str("-uncommitted");
                // Committing these sources changes no file, so only git's own
                // records can say the "-uncommitted" mark is stale. A clean
                // checkout watches only the source files: watching git's
                // records there rebuilt the whole crate on every new commit.
                if let Some(directory) = git(repository, &["rev-parse", "--absolute-git-dir"]) {
                    let directory = Path::new(directory.trim());
                    println!(
                        "cargo:rerun-if-changed={}",
                        directory.join("HEAD").display()
                    );
                    println!(
                        "cargo:rerun-if-changed={}",
                        directory.join("index").display()
                    );
                }
            }
            fingerprint
        }
        None => "unrecorded".to_owned(),
    };
    println!("cargo:rustc-env=WAT2DO_SOURCE_FINGERPRINT={fingerprint}");
}
