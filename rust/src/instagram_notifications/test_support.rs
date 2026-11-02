//! Test doubles for the Brave services: a scripted Mac (subprocesses and a virtual
//! clock), a scripted page runner, a Gmail inbox and a queue in a temporary directory.
//! Nothing here can reach Brave, the Keychain, Gmail or a real LaunchAgent.

// Each test module uses the doubles it needs.
#![allow(dead_code)]

use std::path::Path;
use std::sync::{Arc, Mutex};

use super::account_login::Mailbox;
use super::browser_queue::BrowserJobQueue;
use super::browser_session::{Bridge, JavascriptRunner, OSASCRIPT};
use super::errors::BrowserResult;
use super::scripts;
use crate::host::{CommandError, CommandOutput, Host};

/// One subprocess the code under test started.
#[derive(Debug, Clone, PartialEq)]
pub struct HostCall {
    pub program: String,
    pub args: Vec<String>,
    pub stdin: Option<String>,
    pub timeout: f64,
}

impl HostCall {
    /// The AppleScript or JXA source an `osascript` call ran (argv or stdin).
    pub fn script(&self) -> Option<&str> {
        if self.program != OSASCRIPT {
            return None;
        }
        if let Some(stdin) = &self.stdin {
            return Some(stdin);
        }
        let index = self.args.iter().position(|argument| argument == "-e")?;
        self.args.get(index + 1).map(String::as_str)
    }

    /// The arguments after `--` (or after `-` for a script on stdin).
    pub fn script_arguments(&self) -> &[String] {
        let marker = if self.stdin.is_some() { "-" } else { "--" };
        match self.args.iter().position(|argument| argument == marker) {
            Some(index) => &self.args[index + 1..],
            None => &[],
        }
    }

    /// Whether this ran `script` exactly.
    pub fn runs(&self, script: &str) -> bool {
        self.script() == Some(script)
    }

    /// For the execute-in-tab script: the JavaScript it ran.
    pub fn javascript(&self) -> Option<&str> {
        if self.runs(scripts::EXECUTE_TAB) {
            return self.script_arguments().get(1).map(String::as_str);
        }
        None
    }
}

pub type Responder = dyn FnMut(&HostCall) -> Result<CommandOutput, CommandError> + Send;

/// A Mac whose subprocesses answer from a script and whose clock only moves on sleep.
pub struct FakeHost {
    monotonic: Mutex<f64>,
    time: Mutex<f64>,
    pub calls: Mutex<Vec<HostCall>>,
    pub sleeps: Mutex<Vec<f64>>,
    responder: Mutex<Box<Responder>>,
}

impl FakeHost {
    pub fn new(
        responder: impl FnMut(&HostCall) -> Result<CommandOutput, CommandError> + Send + 'static,
    ) -> Arc<Self> {
        Arc::new(Self {
            monotonic: Mutex::new(1_000.0),
            time: Mutex::new(1_800_000_000.0),
            calls: Mutex::new(Vec::new()),
            sleeps: Mutex::new(Vec::new()),
            responder: Mutex::new(Box::new(responder)),
        })
    }

    /// A host every subprocess of which fails as missing.
    pub fn idle() -> Arc<Self> {
        Self::new(|_| Err(CommandError::NotFound))
    }

    pub fn set_responder(
        &self,
        responder: impl FnMut(&HostCall) -> Result<CommandOutput, CommandError> + Send + 'static,
    ) {
        *self.responder.lock().unwrap() = Box::new(responder);
    }

    pub fn set_time(&self, time: f64) {
        *self.time.lock().unwrap() = time;
    }

    pub fn advance(&self, seconds: f64) {
        *self.monotonic.lock().unwrap() += seconds;
        *self.time.lock().unwrap() += seconds;
    }

    pub fn calls(&self) -> Vec<HostCall> {
        self.calls.lock().unwrap().clone()
    }

    /// The JavaScript sources run in tabs, in order.
    pub fn javascript(&self) -> Vec<String> {
        self.calls()
            .iter()
            .filter_map(|call| call.javascript().map(str::to_owned))
            .collect()
    }
}

/// A successful subprocess that printed `stdout`.
pub fn ok(stdout: &str) -> Result<CommandOutput, CommandError> {
    Ok(CommandOutput {
        code: 0,
        stdout: stdout.to_owned(),
        stderr: String::new(),
    })
}

/// `osascript` failing with `stderr`.
pub fn failed(stderr: &str) -> Result<CommandOutput, CommandError> {
    Ok(CommandOutput {
        code: 1,
        stdout: String::new(),
        stderr: stderr.to_owned(),
    })
}

impl Host for FakeHost {
    fn run(
        &self,
        program: &str,
        args: &[String],
        stdin: Option<&str>,
        timeout: f64,
    ) -> Result<CommandOutput, CommandError> {
        let call = HostCall {
            program: program.to_owned(),
            args: args.to_vec(),
            stdin: stdin.map(str::to_owned),
            timeout,
        };
        self.calls.lock().unwrap().push(call.clone());
        (self.responder.lock().unwrap())(&call)
    }

    fn monotonic(&self) -> f64 {
        *self.monotonic.lock().unwrap()
    }

    fn time(&self) -> f64 {
        *self.time.lock().unwrap()
    }

    fn sleep(&self, seconds: f64) {
        self.sleeps.lock().unwrap().push(seconds);
        self.advance(seconds.max(0.0));
    }
}

/// An inbox that answers from a list, recording each question.
#[derive(Default)]
pub struct FakeMailbox {
    pub codes: Mutex<Vec<Option<String>>>,
    pub asked: Mutex<Vec<(String, f64)>>,
}

impl Mailbox for FakeMailbox {
    fn newest_code(
        &self,
        _imap_password: &str,
        username: &str,
        sent_after: f64,
        _budget: f64,
    ) -> Option<String> {
        self.asked
            .lock()
            .unwrap()
            .push((username.to_owned(), sent_after));
        let mut codes = self.codes.lock().unwrap();
        if codes.is_empty() {
            None
        } else {
            codes.remove(0)
        }
    }
}

pub fn bridge(host: &Arc<FakeHost>) -> Arc<Bridge> {
    Bridge::new(host.clone(), Arc::new(FakeMailbox::default()))
}

pub fn bridge_with_mailbox(host: &Arc<FakeHost>, mailbox: Arc<FakeMailbox>) -> Arc<Bridge> {
    Bridge::new(host.clone(), mailbox)
}

/// A queue in `directory` on the fake host's clock.
pub fn queue(directory: &Path, host: &Arc<FakeHost>) -> Arc<BrowserJobQueue> {
    BrowserJobQueue::open(Some(directory), host.clone()).expect("queue opens")
}

pub type Script = dyn FnMut(&str) -> BrowserResult<String> + Send;
pub type Navigation = dyn FnMut(&str, bool) -> BrowserResult<String> + Send;

/// Python tests' `javascript_runner=` callables: answers each source from a closure.
pub struct ScriptedRunner {
    pub sources: Arc<Mutex<Vec<String>>>,
    respond: Box<Script>,
    navigate: Option<Box<Navigation>>,
}

impl ScriptedRunner {
    pub fn new(respond: impl FnMut(&str) -> BrowserResult<String> + Send + 'static) -> Self {
        Self {
            sources: Arc::new(Mutex::new(Vec::new())),
            respond: Box::new(respond),
            navigate: None,
        }
    }

    pub fn with_navigation(
        mut self,
        navigate: impl FnMut(&str, bool) -> BrowserResult<String> + Send + 'static,
    ) -> Self {
        self.navigate = Some(Box::new(navigate));
        self
    }
}

impl JavascriptRunner for ScriptedRunner {
    fn run(&mut self, source: &str, _timeout: f64) -> BrowserResult<String> {
        self.sources.lock().unwrap().push(source.to_owned());
        (self.respond)(source)
    }

    fn navigate(
        &mut self,
        url: &str,
        _timeout: f64,
        reload: bool,
    ) -> Option<BrowserResult<String>> {
        self.navigate.as_mut().map(|navigate| navigate(url, reload))
    }
}
