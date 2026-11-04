//! `wat2do-browser`: the Mac mini's Instagram browser worker, its queue, and the
//! `process-notification` job (`wat2do::instagram_notifications::cli`).

fn main() -> std::process::ExitCode {
    wat2do::install_tls();
    wat2do::instagram_notifications::cli::main()
}
