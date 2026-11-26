//! Agent prompts, read from the Mac's local prompts folder on every run.
//!
//! No prompt lives in this (public) repository: each one is a file in
//! `WAT2DO_PROMPTS_DIR` (by default `~/wat2do-data/prompts`, its own local git
//! repository), named by its path there, such as `ingestion/prompt.md`. A run
//! reads its prompt when it starts, so an edit applies on the very next run with
//! no build, restart or deploy, and a missing file fails that run instead of
//! falling back to an old copy. Tests read the fixtures in
//! `backend/tests/fixtures/prompts` instead (Python's `core/prompts.py` does the same).

use std::path::PathBuf;

use anyhow::{Context, Result};

/// The setting that names the folder, shared with Python's `core/prompts.py`.
pub const DIR_VARIABLE: &str = "WAT2DO_PROMPTS_DIR";

/// The prompts folder: `WAT2DO_PROMPTS_DIR`, else `~/wat2do-data/prompts`.
pub fn dir() -> PathBuf {
    if let Some(dir) = std::env::var_os(DIR_VARIABLE).filter(|dir| !dir.is_empty()) {
        return PathBuf::from(dir);
    }
    if cfg!(test) {
        return PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../backend/tests/fixtures/prompts");
    }
    PathBuf::from(std::env::var("HOME").unwrap_or_default()).join("wat2do-data/prompts")
}

/// The prompt `name` (a path inside the folder) as it is now.
pub fn read(name: &str) -> Result<String> {
    let path = dir().join(name);
    std::fs::read_to_string(&path)
        .with_context(|| format!("could not read the prompt {}", path.display()))
}

/// `template` with each `{{key}}` replaced by its value, in order.
pub fn fill<V: AsRef<str>>(template: &str, values: &[(&str, V)]) -> String {
    values
        .iter()
        .fold(template.to_owned(), |prompt, (key, value)| {
            prompt.replace(&format!("{{{{{key}}}}}"), value.as_ref())
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_prompt_is_read_from_the_folder_and_a_missing_one_fails() {
        assert!(
            read("ingestion/prompt.md")
                .unwrap()
                .contains("{{source_url}}")
        );
        let missing = read("ingestion/no_such_prompt.md").unwrap_err();
        assert!(format!("{missing:#}").contains("could not read the prompt"));
    }

    #[test]
    fn placeholders_are_filled_in_order() {
        let filled = fill("{{a}} and {{b}}", &[("a", "{{b}}"), ("b", "two")]);
        assert_eq!(filled, "two and two");
    }
}
