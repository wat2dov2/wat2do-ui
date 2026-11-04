//! Log lines in the formats the Mac services' Python logging used, and the browser
//! worker's bounded operational log (`worker.operations.log` and its backups).

use std::fs::{File, OpenOptions};
use std::io::{Seek, SeekFrom, Write};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::PathBuf;
use std::sync::Mutex;

use tracing::{Event, Level, Subscriber};
use tracing_subscriber::fmt::format::Writer;
use tracing_subscriber::fmt::{FmtContext, FormatEvent, FormatFields, MakeWriter};
use tracing_subscriber::registry::LookupSpan;

/// How a line is laid out.
#[derive(Clone, Copy)]
pub enum Style {
    /// `WARNING target: message` (the worker's and the CLI's format).
    LevelTarget,
    /// `2026-11-02 03:00:00,123 INFO message` (`core.logging`'s default).
    Timestamped,
    /// `INFO:target:message` (Python's `logging.basicConfig()` default).
    Colons,
}

pub struct PythonFormat(pub Style);

fn level_name(level: &Level) -> &'static str {
    match *level {
        Level::ERROR => "ERROR",
        Level::WARN => "WARNING",
        Level::INFO => "INFO",
        _ => "DEBUG",
    }
}

impl<S, N> FormatEvent<S, N> for PythonFormat
where
    S: Subscriber + for<'a> LookupSpan<'a>,
    N: for<'a> FormatFields<'a> + 'static,
{
    fn format_event(
        &self,
        context: &FmtContext<'_, S, N>,
        mut writer: Writer<'_>,
        event: &Event<'_>,
    ) -> std::fmt::Result {
        let metadata = event.metadata();
        let level = level_name(metadata.level());
        match self.0 {
            Style::LevelTarget => write!(writer, "{level} {}: ", metadata.target())?,
            Style::Timestamped => write!(
                writer,
                "{} {level} ",
                chrono::Local::now().format("%Y-%m-%d %H:%M:%S,%3f")
            )?,
            Style::Colons => write!(writer, "{level}:{}:", metadata.target())?,
        }
        context
            .field_format()
            .format_fields(writer.by_ref(), event)?;
        writeln!(writer)
    }
}

/// Log to stderr in `style` at `level` and above.
pub fn init_stderr(style: Style, level: Level) {
    let _ = tracing_subscriber::fmt()
        .with_max_level(level)
        .event_format(PythonFormat(style))
        .with_writer(std::io::stderr)
        .try_init();
}

/// The worker's operational log: WARNING and above, rotated like Python's
/// `RotatingFileHandler`, private (0600, never through a symlink), and quiet on
/// stderr while a disk failure persists.
pub fn init_worker_log(path: PathBuf, max_bytes: u64, backup_count: usize) {
    let writer = RotatingLog::new(path, max_bytes, backup_count);
    let _ = tracing_subscriber::fmt()
        .with_max_level(Level::WARN)
        .event_format(PythonFormat(Style::LevelTarget))
        .with_writer(writer)
        .try_init();
}

pub struct RotatingLog {
    state: Mutex<LogState>,
}

struct LogState {
    path: PathBuf,
    max_bytes: u64,
    backup_count: usize,
    file: Option<File>,
    failure_reported: bool,
}

impl RotatingLog {
    pub fn new(path: PathBuf, max_bytes: u64, backup_count: usize) -> Self {
        Self {
            state: Mutex::new(LogState {
                path,
                max_bytes,
                backup_count,
                file: None,
                failure_reported: false,
            }),
        }
    }

    /// Whether the current write failure has already been reported on stderr.
    #[cfg(test)]
    pub fn failure_reported(&self) -> bool {
        self.state
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .failure_reported
    }
}

impl LogState {
    fn open(&mut self) -> std::io::Result<&mut File> {
        if self.file.is_none() {
            let file = OpenOptions::new()
                .create(true)
                .append(true)
                .mode(0o600)
                .custom_flags(libc::O_NOFOLLOW)
                .open(&self.path)?;
            file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
            self.file = Some(file);
        }
        Ok(self.file.as_mut().expect("opened above"))
    }

    fn rollover(&mut self) -> std::io::Result<()> {
        self.file = None;
        let name = |index: usize| {
            let mut path = self.path.clone().into_os_string();
            path.push(format!(".{index}"));
            PathBuf::from(path)
        };
        for index in (1..self.backup_count).rev() {
            let (source, destination) = (name(index), name(index + 1));
            if source.exists() {
                let _ = std::fs::remove_file(&destination);
                std::fs::rename(&source, &destination)?;
            }
        }
        let first = name(1);
        let _ = std::fs::remove_file(&first);
        if self.path.exists() {
            std::fs::rename(&self.path, &first)?;
        }
        Ok(())
    }

    fn write_record(&mut self, record: &[u8]) -> std::io::Result<()> {
        let record = truncate(record, self.max_bytes);
        let size = self.open()?.seek(SeekFrom::End(0))?;
        if size + record.len() as u64 > self.max_bytes {
            self.rollover()?;
        }
        let file = self.open()?;
        file.write_all(&record)?;
        file.flush()
    }
}

/// A record longer than the log may hold keeps its start and says it was cut.
fn truncate(record: &[u8], max_bytes: u64) -> Vec<u8> {
    let limit = max_bytes as usize;
    if record.len() <= limit {
        return record.to_vec();
    }
    let suffix = b"[truncated]";
    let text = String::from_utf8_lossy(&record[..limit.saturating_sub(suffix.len() + 1)]);
    let mut kept = text.trim_end_matches('\u{FFFD}').as_bytes().to_vec();
    kept.extend_from_slice(suffix);
    kept.push(b'\n');
    kept
}

/// One event's bytes, written to the log as a single record when dropped.
pub struct RecordWriter<'a> {
    log: &'a RotatingLog,
    buffer: Vec<u8>,
}

impl Write for RecordWriter<'_> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.buffer.extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl Drop for RecordWriter<'_> {
    fn drop(&mut self) {
        if self.buffer.is_empty() {
            return;
        }
        let mut state = self
            .log
            .state
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        match state.write_record(&self.buffer) {
            Ok(()) => state.failure_reported = false,
            Err(_) => {
                state.file = None;
                if !state.failure_reported {
                    state.failure_reported = true;
                    let _ = std::io::stderr().write_all(
                        b"Instagram worker operational log is unavailable; logging will retry.\n",
                    );
                }
            }
        }
    }
}

impl<'a> MakeWriter<'a> for RotatingLog {
    type Writer = RecordWriter<'a>;

    fn make_writer(&'a self) -> Self::Writer {
        RecordWriter {
            log: self,
            buffer: Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_operations_log_rotates_and_truncates() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("worker.operations.log");
        let log = RotatingLog::new(path.clone(), 64, 2);
        for index in 0..6 {
            let mut writer = log.make_writer();
            writer
                .write_all(format!("WARNING target: line {index} padding padding\n").as_bytes())
                .unwrap();
        }
        let mut long = log.make_writer();
        long.write_all(&[b'x'; 200]).unwrap();
        drop(long);
        let current = std::fs::read_to_string(&path).unwrap();
        assert!(current.ends_with("[truncated]\n"), "{current}");
        assert!(current.len() <= 64);
        assert!(directory.path().join("worker.operations.log.1").exists());
        assert!(directory.path().join("worker.operations.log.2").exists());
        assert!(!directory.path().join("worker.operations.log.3").exists());
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }
}
