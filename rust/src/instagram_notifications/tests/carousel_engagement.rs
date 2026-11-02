//! Ported from `tests/services/instagram_notifications/test_carousel_engagement.py`.
//!
//! Python's fake Supabase client recorded the query filters and update payloads it
//! received. Here `FakeStore` stands in for the publishing tables and records the
//! arguments of each `PublishingStore` call instead: the `since`/`until` bounds, the
//! delivery generation and keyset cursor of each batch page, the batches whose items
//! were read, the frozen sources and the acknowledgements. Column lists and the
//! `status`/`enabled` filters live in the Postgres SQL, which a fake cannot observe.
//!
//! Python monkeypatched `queue.enqueue_engagement` and `queue.set_setting` to fail for
//! one argument. The Rust queue has no such seam, so those tests install a SQLite
//! trigger on the temporary queue database that aborts the same write, then drop it
//! (and clear the storage-unavailable flag the failure sets) to restore the queue.

use std::collections::{HashMap, VecDeque};
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::time::Duration;

use chrono::TimeZone;

use super::*;
use crate::instagram_notifications::browser_queue::{BrowserJob, Finish};
use crate::instagram_notifications::test_support::{FakeHost, queue as open_queue};

const ACTIVATED_AT: &str = "2026-09-28T14:00:00+00:00";
const BATCH_ID: &str = "00000000-0000-0000-0000-000000000001";
const SECOND_ID: &str = "00000000-0000-0000-0000-000000000002";
const THIRD_ID: &str = "00000000-0000-0000-0000-000000000003";
const PUBLISHED_AT: &str = "2026-09-28T14:30:00+00:00";

fn now() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 9, 28, 15, 0, 0).unwrap()
}

fn at(text: &str) -> DateTime<Utc> {
    parse_utc(text).unwrap()
}

fn id(text: &str) -> Uuid {
    Uuid::parse_str(text).unwrap()
}

fn account() -> PublishingAccount {
    PublishingAccount {
        account_key: "waterloo".into(),
        school_id: 7,
        instagram_user_id: "17840000000001".into(),
        instagram_username: "waterloo.wat2do.io".into(),
        slug: Some("waterloo".into()),
        recipient_id: Some("76214170483".into()),
    }
}

fn batch() -> PublishedBatch {
    PublishedBatch {
        id: id(BATCH_ID),
        account_key: "waterloo".into(),
        school_id: 7,
        instagram_user_id: Some("17840000000001".into()),
        published_at: at(PUBLISHED_AT),
        published_at_text: PUBLISHED_AT.into(),
        browser_delivery_sources: None,
    }
}

fn batch_with_id(batch_id: &str) -> PublishedBatch {
    PublishedBatch {
        id: id(batch_id),
        ..batch()
    }
}

fn batch_with_sources(sources: Value) -> PublishedBatch {
    PublishedBatch {
        browser_delivery_sources: Some(sources),
        ..batch()
    }
}

fn item(event_id: i32, source_url: &str) -> PublishedItem {
    PublishedItem {
        event_id: Some(event_id),
        source_url: Some(source_url.into()),
    }
}

fn default_item() -> PublishedItem {
    item(42, "https://www.instagram.com/p/SOURCE42/")
}

fn source(post_url: &str, event_id: i64) -> Value {
    json!({"post_url": post_url, "event_id": event_id})
}

fn stats(batches: i64, posts: i64, submitted: i64, skipped: i64) -> Value {
    json!({"batches": batches, "posts": posts, "submitted": submitted, "skipped": skipped})
}

type ItemsHook = Box<dyn Fn(Uuid) -> Vec<PublishedItem> + Send + Sync>;

/// The publishing tables: queued responses per query, recorded arguments per call.
#[derive(Default)]
struct FakeStore {
    pages: Mutex<VecDeque<Vec<PublishedBatch>>>,
    accounts: Mutex<VecDeque<Vec<PublishingAccount>>>,
    items: Mutex<VecDeque<Vec<PublishedItem>>>,
    items_hook: Option<ItemsHook>,
    activations: Mutex<VecDeque<std::result::Result<DateTime<Utc>, String>>>,
    acknowledge_failure: Mutex<Option<String>>,
    /// `freeze_instagram_browser_sources`: the first selection for a batch wins.
    frozen: Mutex<HashMap<String, Vec<Value>>>,
    batch_queries: Mutex<Vec<BatchQuery>>,
    account_reads: AtomicUsize,
    item_reads: Mutex<Vec<Uuid>>,
    ensured: Mutex<Vec<DateTime<Utc>>>,
    freezes: Mutex<Vec<(String, Vec<Value>)>>,
    acknowledgements: Mutex<Vec<(String, String, Vec<Value>)>>,
}

#[derive(Debug, Clone, PartialEq)]
struct BatchQuery {
    since: DateTime<Utc>,
    until: DateTime<Utc>,
    generation: String,
    after: Option<(DateTime<Utc>, Uuid)>,
}

impl FakeStore {
    fn page(&self, page: Vec<PublishedBatch>) -> &Self {
        self.pages.lock().unwrap().push_back(page);
        self
    }

    fn accounts(&self, accounts: Vec<PublishingAccount>) -> &Self {
        self.accounts.lock().unwrap().push_back(accounts);
        self
    }

    fn items(&self, items: Vec<PublishedItem>) -> &Self {
        self.items.lock().unwrap().push_back(items);
        self
    }

    fn activation(&self, activated_at: &str) -> &Self {
        self.activations
            .lock()
            .unwrap()
            .push_back(Ok(at(activated_at)));
        self
    }

    /// Python's `fake_sb.table.reset_mock()`: forget the recorded reads.
    fn reset_records(&self) {
        self.batch_queries.lock().unwrap().clear();
        self.account_reads.store(0, Ordering::SeqCst);
        self.item_reads.lock().unwrap().clear();
    }

    fn batch_queries(&self) -> Vec<BatchQuery> {
        self.batch_queries.lock().unwrap().clone()
    }

    fn item_reads(&self) -> Vec<Uuid> {
        self.item_reads.lock().unwrap().clone()
    }

    fn acknowledgements(&self) -> Vec<(String, String, Vec<Value>)> {
        self.acknowledgements.lock().unwrap().clone()
    }

    fn last_acknowledged_sources(&self) -> Vec<Value> {
        self.acknowledgements()
            .last()
            .expect("an acknowledgement")
            .2
            .clone()
    }
}

impl PublishingStore for FakeStore {
    fn enabled_accounts(&self) -> Result<Vec<PublishingAccount>> {
        self.account_reads.fetch_add(1, Ordering::SeqCst);
        Ok(self
            .accounts
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or_default())
    }

    fn published_batches(
        &self,
        since: DateTime<Utc>,
        until: DateTime<Utc>,
        delivery_generation: &str,
        after: Option<(DateTime<Utc>, Uuid)>,
    ) -> Result<Vec<PublishedBatch>> {
        self.batch_queries.lock().unwrap().push(BatchQuery {
            since,
            until,
            generation: delivery_generation.to_owned(),
            after,
        });
        Ok(self.pages.lock().unwrap().pop_front().unwrap_or_default())
    }

    fn published_items(&self, batch_id: Uuid) -> Result<Vec<PublishedItem>> {
        self.item_reads.lock().unwrap().push(batch_id);
        if let Some(hook) = &self.items_hook {
            return Ok(hook(batch_id));
        }
        Ok(self.items.lock().unwrap().pop_front().unwrap_or_default())
    }

    fn ensure_source(&self, proposed: DateTime<Utc>) -> Result<Option<DateTime<Utc>>> {
        self.ensured.lock().unwrap().push(proposed);
        match self.activations.lock().unwrap().pop_front() {
            Some(Ok(activated_at)) => Ok(Some(activated_at)),
            Some(Err(message)) => Err(anyhow::anyhow!(message)),
            None => panic!("no activation response queued"),
        }
    }

    fn freeze_sources(&self, batch_id: &str, sources: &[Value]) -> Result<Vec<Value>> {
        let sources = validate_browser_sources(&Value::from(sources.to_vec()))?;
        self.freezes
            .lock()
            .unwrap()
            .push((batch_id.to_owned(), sources.clone()));
        let mut frozen = self.frozen.lock().unwrap();
        Ok(frozen.entry(batch_id.to_owned()).or_insert(sources).clone())
    }

    fn acknowledge(
        &self,
        row_id: &str,
        delivery_generation: &str,
        sources: &[Value],
    ) -> Result<()> {
        if let Some(message) = self.acknowledge_failure.lock().unwrap().take() {
            return Err(anyhow::anyhow!(message));
        }
        self.acknowledgements.lock().unwrap().push((
            row_id.to_owned(),
            delivery_generation.to_owned(),
            sources.to_vec(),
        ));
        Ok(())
    }
}

/// The Python `queue` fixture: a queue already registered at `ACTIVATED_AT`.
fn registered_queue(directory: &Path, host: &Arc<FakeHost>) -> Arc<BrowserJobQueue> {
    let queue = open_queue(directory, host);
    queue
        .set_setting(ACTIVATION_SETTING, Value::from(ACTIVATED_AT))
        .unwrap();
    queue
        .set_setting(SOURCE_REGISTRATION_SETTING, Value::Bool(true))
        .unwrap();
    queue
}

fn drain(queue: &BrowserJobQueue) -> Vec<BrowserJob> {
    let mut jobs = Vec::new();
    while let Some(job) = queue.claim_next(None, true).unwrap() {
        queue
            .finish(&job, Finish::result(json!({"status": "done"})))
            .unwrap();
        jobs.push(job);
    }
    jobs
}

fn post_urls(jobs: &[BrowserJob]) -> std::collections::BTreeSet<String> {
    jobs.iter()
        .map(|job| job.payload["post_url"].as_str().unwrap().to_owned())
        .collect()
}

/// Make the queue database refuse one write, as Python's monkeypatched methods did.
fn refuse(queue: &BrowserJobQueue, table: &str, when: &str, message: &str) {
    let db = rusqlite::Connection::open(&queue.database_path).unwrap();
    db.execute_batch(&format!(
        "CREATE TRIGGER refuse_write BEFORE INSERT ON {table} WHEN {when} \
         BEGIN SELECT RAISE(ABORT, '{message}'); END;"
    ))
    .unwrap();
}

/// Undo `refuse`: Python restored the original method; the queue's failure flag is
/// an artifact of the injected storage error.
fn restore(queue: &BrowserJobQueue) {
    let db = rusqlite::Connection::open(&queue.database_path).unwrap();
    db.execute_batch("DROP TRIGGER refuse_write;").unwrap();
    queue.set_storage_unavailable(false);
}

struct Fixture {
    directory: tempfile::TempDir,
    host: Arc<FakeHost>,
    queue: Arc<BrowserJobQueue>,
    store: FakeStore,
}

fn fixture() -> Fixture {
    let directory = tempfile::tempdir().unwrap();
    let host = FakeHost::idle();
    let queue = registered_queue(directory.path(), &host);
    Fixture {
        directory,
        host,
        queue,
        store: FakeStore::default(),
    }
}

fn sync(queue: &BrowserJobQueue, store: &FakeStore, now: DateTime<Utc>) -> Value {
    sync_published_carousels(queue, store, Some(now)).unwrap()
}

#[test]
fn test_first_run_persists_activation_without_historical_backfill() {
    let directory = tempfile::tempdir().unwrap();
    let host = FakeHost::idle();
    let queue = open_queue(directory.path(), &host);
    let store = FakeStore::default();
    store.activations.lock().unwrap().push_back(Ok(now()));

    let result = sync(&queue, &store, now());

    assert_eq!(result, stats(0, 0, 0, 0));
    assert_eq!(
        queue.get_setting(ACTIVATION_SETTING).unwrap(),
        Some(Value::from("2026-09-28T15:00:00+00:00"))
    );
    let queries = store.batch_queries();
    assert_eq!(queries.len(), 1);
    assert_eq!((queries[0].since, queries[0].until), (now(), now()));

    let restarted = open_queue(directory.path(), &host);
    sync(&restarted, &store, now() + chrono::Duration::days(1));
    let since: Vec<_> = store.batch_queries().iter().map(|q| q.since).collect();
    assert_eq!(since, vec![now(), now()]);
    assert_eq!(*store.ensured.lock().unwrap(), vec![now()]);
}

#[test]
fn test_published_selection_enqueues_original_post_for_school_account_only() {
    let f = fixture();
    f.store
        .page(vec![batch()])
        .accounts(vec![account()])
        .items(vec![item(42, "https://instagram.com/p/SOURCE42?utm=x")]);

    let result = sync(&f.queue, &f.store, now());

    assert_eq!(result, stats(1, 1, 1, 0));
    let jobs = drain(&f.queue);
    assert_eq!(jobs.len(), 1);
    assert!(!jobs[0].payload.contains_key("action"));
    for job in &jobs {
        assert_eq!(job.recipient_id, "76214170483");
        assert_eq!(job.account_username, "waterloo.wat2do.io");
        assert_eq!(job.school, "waterloo");
        assert_eq!(job.payload["event_id"], 42);
        assert_eq!(
            job.payload["post_url"],
            "https://www.instagram.com/p/SOURCE42/"
        );
    }

    // Python: tables batches, accounts, items, then the batch update.
    let queries = f.store.batch_queries();
    assert_eq!(queries.len(), 1);
    assert_eq!(queries[0].since, at(ACTIVATED_AT));
    assert_eq!(queries[0].generation, f.queue.delivery_generation());
    assert_eq!(queries[0].after, None);
    assert_eq!(f.store.account_reads.load(Ordering::SeqCst), 1);
    assert_eq!(f.store.item_reads(), vec![id(BATCH_ID)]);
    let selection = vec![source("https://www.instagram.com/p/SOURCE42/", 42)];
    assert_eq!(
        f.store.acknowledgements(),
        vec![(
            BATCH_ID.to_owned(),
            f.queue.delivery_generation().to_owned(),
            selection.clone()
        )]
    );
    assert_eq!(
        *f.store.freezes.lock().unwrap(),
        vec![(BATCH_ID.to_owned(), selection)]
    );
}

#[test]
fn test_non_instagram_sources_and_missing_sources_are_skipped() {
    let f = fixture();
    f.store
        .page(vec![batch()])
        .accounts(vec![account()])
        .items(vec![
            item(1, "https://example.com/p/SOURCE42/"),
            PublishedItem {
                event_id: Some(2),
                source_url: None,
            },
            item(3, "https://www.instagram.com/club/"),
            item(4, "https://www.instagram.com/reel/REEL44/"),
        ]);

    let result = sync(&f.queue, &f.store, now());

    assert_eq!(result, stats(1, 1, 1, 3));
    assert_eq!(
        post_urls(&drain(&f.queue)),
        ["https://www.instagram.com/reel/REEL44/".to_owned()].into()
    );
}

#[test]
fn test_unconfigured_disabled_or_mismatched_accounts_cannot_queue_posts() {
    let cases: Vec<Vec<PublishingAccount>> = vec![
        vec![],
        vec![PublishingAccount {
            school_id: 8,
            ..account()
        }],
        vec![PublishingAccount {
            instagram_user_id: "17849999999999".into(),
            ..account()
        }],
        vec![PublishingAccount {
            recipient_id: None,
            ..account()
        }],
        vec![PublishingAccount {
            recipient_id: Some("0".into()),
            ..account()
        }],
    ];
    for accounts in cases {
        let f = fixture();
        f.store.page(vec![batch()]).accounts(accounts.clone());

        assert_eq!(
            sync(&f.queue, &f.store, now()),
            stats(1, 0, 0, 1),
            "{accounts:?}"
        );
        assert!(drain(&f.queue).is_empty());
        assert!(f.store.item_reads().is_empty());
        assert_eq!(
            f.queue
                .get_setting(&format!("carousel_engagement_batch:{BATCH_ID}"))
                .unwrap(),
            None
        );
        assert!(f.store.acknowledgements().is_empty());
    }
}

#[test]
fn test_corrected_recipient_identity_is_retried_on_next_poll() {
    let f = fixture();
    f.store
        .page(vec![batch()])
        .accounts(vec![PublishingAccount {
            recipient_id: None,
            ..account()
        }]);
    sync(&f.queue, &f.store, now());
    f.store
        .page(vec![batch()])
        .accounts(vec![account()])
        .items(vec![default_item()]);

    let result = sync(&f.queue, &f.store, now() + chrono::Duration::minutes(1));

    assert_eq!(result, stats(1, 1, 1, 0));
    assert_eq!(drain(&f.queue).len(), 1);
}

#[test]
fn test_get_engagement_account_resolves_public_identity_for_cli() {
    let store = FakeStore::default();
    store.accounts(vec![PublishingAccount {
        instagram_username: "WATERLOO.WAT2DO.IO".into(),
        ..account()
    }]);

    assert_eq!(
        get_engagement_account(&store, " Waterloo ").unwrap(),
        EngagementAccount {
            school: "waterloo".into(),
            recipient_id: "76214170483".into(),
            account_username: "waterloo.wat2do.io".into(),
        }
    );
    assert_eq!(store.account_reads.load(Ordering::SeqCst), 1);
}

#[test]
fn test_get_engagement_account_rejects_unconfigured_school() {
    let store = FakeStore::default();

    let error = get_engagement_account(&store, "waterloo").unwrap_err();

    assert!(value_error(&error));
    assert!(
        error
            .to_string()
            .contains("no enabled Instagram publishing account")
    );
}

#[test]
fn test_completed_batch_is_not_reinterpreted_when_original_event_is_edited() {
    let f = fixture();
    f.store
        .page(vec![batch()])
        .accounts(vec![account()])
        .items(vec![default_item()]);
    sync(&f.queue, &f.store, now());
    assert_eq!(drain(&f.queue).len(), 1);
    f.store.reset_records();
    f.store.page(vec![batch()]);

    let result = sync(&f.queue, &f.store, now() + chrono::Duration::minutes(1));

    assert_eq!(result, stats(1, 0, 0, 1));
    assert!(drain(&f.queue).is_empty());
    assert!(f.store.item_reads().is_empty());
    assert_eq!(f.store.account_reads.load(Ordering::SeqCst), 0);
}

#[test]
fn test_account_unavailable_to_browser_does_not_block_another_school() {
    let f = fixture();
    let other_account = PublishingAccount {
        account_key: "queens".into(),
        school_id: 8,
        instagram_user_id: "17840000000002".into(),
        instagram_username: "queens.wat2do.io".into(),
        slug: Some("queens".into()),
        recipient_id: Some("76214170484".into()),
    };
    let other_batch = PublishedBatch {
        id: id(SECOND_ID),
        account_key: "queens".into(),
        school_id: 8,
        instagram_user_id: Some("17840000000002".into()),
        ..batch()
    };
    f.store
        .page(vec![batch(), other_batch])
        .accounts(vec![
            PublishingAccount {
                instagram_username: "unsupported.brand".into(),
                ..account()
            },
            other_account,
        ])
        .items(vec![item(43, "https://www.instagram.com/p/QUEENS/")]);

    let result = sync(&f.queue, &f.store, now());

    assert_eq!(result, stats(2, 1, 1, 1));
    let jobs = drain(&f.queue);
    assert_eq!(jobs.len(), 1);
    assert_eq!(jobs[0].school, "queens");
    assert_eq!(
        post_urls(&jobs),
        ["https://www.instagram.com/p/QUEENS/".to_owned()].into()
    );
    assert_eq!(
        f.queue
            .get_setting(&format!("carousel_engagement_batch:{BATCH_ID}"))
            .unwrap(),
        None
    );
}

#[test]
fn test_partial_enqueue_failure_replays_without_duplicate_or_lost_posts() {
    let f = fixture();
    f.store
        .page(vec![batch()])
        .accounts(vec![account()])
        .items(vec![
            default_item(),
            item(43, "https://www.instagram.com/p/SOURCE43/"),
        ]);
    refuse(
        &f.queue,
        "jobs",
        "json_extract(NEW.payload, '$.event_id') = 43",
        "local queue temporarily unavailable",
    );

    let error = sync_published_carousels(&f.queue, &f.store, Some(now())).unwrap_err();
    assert!(
        error.to_string().contains("queue temporarily unavailable"),
        "{error}"
    );
    assert_eq!(
        f.queue
            .get_setting(&format!("carousel_engagement_batch:{BATCH_ID}"))
            .unwrap(),
        None
    );
    assert_eq!(
        f.queue
            .get_setting(&format!("carousel_engagement_sources:{BATCH_ID}"))
            .unwrap(),
        Some(json!([
            {"post_url": "https://www.instagram.com/p/SOURCE42/", "event_id": 42},
            {"post_url": "https://www.instagram.com/p/SOURCE43/", "event_id": 43},
        ]))
    );
    assert!(f.store.acknowledgements().is_empty());

    restore(&f.queue);
    f.store.reset_records();
    f.store
        .page(vec![batch()])
        .accounts(vec![account()])
        .items(vec![
            item(42, "https://www.instagram.com/p/EDITED/"),
            item(43, "https://www.instagram.com/p/EDITED/"),
        ]);
    sync(&f.queue, &f.store, now());
    let jobs = drain(&f.queue);
    let event_ids: std::collections::BTreeSet<i64> = jobs
        .iter()
        .map(|job| job.payload["event_id"].as_i64().unwrap())
        .collect();
    assert_eq!(event_ids, [42, 43].into());
    assert_eq!(
        post_urls(&jobs),
        [
            "https://www.instagram.com/p/SOURCE42/".to_owned(),
            "https://www.instagram.com/p/SOURCE43/".to_owned(),
        ]
        .into()
    );
    assert_eq!(jobs.len(), 2);
    assert!(f.store.item_reads().is_empty());
}

#[test]
fn test_pagination_keeps_batches_with_identical_publication_timestamps() {
    crate::controlbox::overrides::instagram_browser(|control| control.source_page_size = 2);
    let f = fixture();
    f.store
        .page(vec![batch(), batch_with_id(SECOND_ID)])
        .page(vec![batch_with_id(THIRD_ID)])
        .accounts(vec![account()])
        .items(vec![item(1, "https://www.instagram.com/p/FIRST/")])
        .items(vec![item(2, "https://www.instagram.com/p/SECOND/")])
        .items(vec![item(3, "https://www.instagram.com/p/THIRD/")]);

    let result = sync(&f.queue, &f.store, now());

    assert_eq!(result, stats(3, 3, 3, 0));
    assert_eq!(drain(&f.queue).len(), 3);
    let queries = f.store.batch_queries();
    let generation = f.queue.delivery_generation();
    assert_eq!(
        queries
            .iter()
            .map(|query| (query.generation.as_str(), query.after))
            .collect::<Vec<_>>(),
        vec![
            (generation, None),
            (generation, Some((at(PUBLISHED_AT), id(SECOND_ID)))),
        ]
    );
    assert_eq!(f.store.account_reads.load(Ordering::SeqCst), 1);
}

#[test]
fn test_late_publication_with_older_timestamp_is_discovered_on_next_poll() {
    let f = fixture();
    f.store
        .page(vec![batch()])
        .accounts(vec![account()])
        .items(vec![default_item()]);
    sync(&f.queue, &f.store, now());
    assert_eq!(drain(&f.queue).len(), 1);
    let older_batch = PublishedBatch {
        id: id(SECOND_ID),
        published_at: at("2026-09-28T14:29:00+00:00"),
        published_at_text: "2026-09-28T14:29:00+00:00".into(),
        ..batch()
    };
    f.store
        .page(vec![older_batch, batch()])
        .accounts(vec![account()])
        .items(vec![item(43, "https://www.instagram.com/p/LATE/")]);

    let result = sync(&f.queue, &f.store, now() + chrono::Duration::minutes(1));

    assert_eq!(result, stats(2, 1, 1, 1));
    assert_eq!(
        post_urls(&drain(&f.queue)),
        ["https://www.instagram.com/p/LATE/".to_owned()].into()
    );
}

#[test]
fn test_idle_collection_does_not_reload_publishing_accounts() {
    let f = fixture();
    f.queue
        .set_setting(SOURCE_REGISTRATION_SETTING, Value::Bool(true))
        .unwrap();

    assert_eq!(sync(&f.queue, &f.store, now()), stats(0, 0, 0, 0));

    assert_eq!(f.store.batch_queries().len(), 1);
    assert_eq!(f.store.account_reads.load(Ordering::SeqCst), 0);
    assert!(f.store.item_reads().is_empty());
}

#[test]
fn test_existing_queue_registers_its_prior_activation_once() {
    let directory = tempfile::tempdir().unwrap();
    let host = FakeHost::idle();
    let queue = open_queue(directory.path(), &host);
    queue
        .set_setting(ACTIVATION_SETTING, Value::from(ACTIVATED_AT))
        .unwrap();
    let store = FakeStore::default();
    store.activation(ACTIVATED_AT);

    sync(&queue, &store, now());
    sync(&queue, &store, now() + chrono::Duration::days(1));

    assert_eq!(*store.ensured.lock().unwrap(), vec![at(ACTIVATED_AT)]);
    assert_eq!(
        queue.get_setting(SOURCE_REGISTRATION_SETTING).unwrap(),
        Some(Value::Bool(true))
    );
}

#[test]
fn test_recreated_queue_restores_cloud_activation_and_replays_older_deliveries() {
    let f = fixture();
    let rebuilt = open_queue(&f.directory.path().join("rebuilt"), &f.host);
    f.store
        .activation(ACTIVATED_AT)
        .page(vec![batch()])
        .accounts(vec![account()])
        .items(vec![default_item()]);

    assert_eq!(sync(&rebuilt, &f.store, now())["submitted"], 1);

    assert_ne!(rebuilt.delivery_generation(), f.queue.delivery_generation());
    assert_eq!(
        rebuilt.get_setting(ACTIVATION_SETTING).unwrap(),
        Some(Value::from(ACTIVATED_AT))
    );
    let queries = f.store.batch_queries();
    assert_eq!(queries.len(), 1);
    assert_eq!(queries[0].since, at(ACTIVATED_AT));
    assert_eq!(queries[0].generation, rebuilt.delivery_generation());
    assert_eq!(
        f.store.acknowledgements(),
        vec![(
            BATCH_ID.to_owned(),
            rebuilt.delivery_generation().to_owned(),
            vec![source("https://www.instagram.com/p/SOURCE42/", 42)]
        )]
    );
}

#[test]
fn test_source_registration_failure_retries_before_loading_batches() {
    let directory = tempfile::tempdir().unwrap();
    let host = FakeHost::idle();
    let queue = open_queue(directory.path(), &host);
    let store = FakeStore::default();
    store
        .activations
        .lock()
        .unwrap()
        .push_back(Err("Source registration unavailable".into()));

    let error = sync_published_carousels(&queue, &store, Some(now())).unwrap_err();
    assert!(
        error
            .to_string()
            .contains("Source registration unavailable")
    );

    assert_eq!(
        queue.get_setting(SOURCE_REGISTRATION_SETTING).unwrap(),
        None
    );
    assert!(store.batch_queries().is_empty());
    store.activation(ACTIVATED_AT);
    sync(&queue, &store, now() + chrono::Duration::days(1));
    assert_eq!(
        queue.get_setting(ACTIVATION_SETTING).unwrap(),
        Some(Value::from(ACTIVATED_AT))
    );
}

#[test]
fn test_cloud_acknowledgement_retries_without_reinterpreting_completed_selection() {
    let f = fixture();
    f.store
        .page(vec![batch()])
        .accounts(vec![account()])
        .items(vec![default_item()]);
    *f.store.acknowledge_failure.lock().unwrap() = Some("Cloud acknowledgement unavailable".into());

    let error = sync_published_carousels(&f.queue, &f.store, Some(now())).unwrap_err();
    assert!(
        error
            .to_string()
            .contains("Cloud acknowledgement unavailable")
    );

    assert!(
        f.queue
            .get_setting(&format!("carousel_engagement_batch:{BATCH_ID}"))
            .unwrap()
            .is_some()
    );
    let original_sources = f
        .queue
        .get_setting(&format!("carousel_engagement_sources:{BATCH_ID}"))
        .unwrap()
        .unwrap();
    assert_eq!(drain(&f.queue).len(), 1);
    f.store.reset_records();
    f.store.page(vec![batch()]);
    assert_eq!(sync(&f.queue, &f.store, now())["skipped"], 1);
    // Python: one batch query and one batch update, nothing else.
    assert_eq!(f.store.batch_queries().len(), 1);
    assert_eq!(f.store.account_reads.load(Ordering::SeqCst), 0);
    assert!(f.store.item_reads().is_empty());
    assert_eq!(f.store.acknowledgements().len(), 1);
    assert!(drain(&f.queue).is_empty());
    assert_eq!(
        Value::from(f.store.last_acknowledged_sources()),
        original_sources
    );
}

#[test]
fn test_local_completion_receipt_failure_prevents_cloud_acknowledgement() {
    let f = fixture();
    f.store
        .page(vec![batch()])
        .accounts(vec![account()])
        .items(vec![default_item()]);
    refuse(
        &f.queue,
        "settings",
        &format!("NEW.key = 'carousel_engagement_batch:{BATCH_ID}'"),
        "Local completion receipt unavailable",
    );

    let error = sync_published_carousels(&f.queue, &f.store, Some(now())).unwrap_err();
    assert!(
        error
            .to_string()
            .contains("Local completion receipt unavailable"),
        "{error}"
    );

    restore(&f.queue);
    assert!(f.store.acknowledgements().is_empty());
    assert_eq!(drain(&f.queue).len(), 1);
}

#[test]
fn test_recreated_queue_uses_frozen_sources_after_the_event_url_changes() {
    let f = fixture();
    let original = "https://www.instagram.com/p/ORIGINAL/";
    f.store
        .page(vec![batch()])
        .accounts(vec![account()])
        .items(vec![item(42, original)]);
    sync(&f.queue, &f.store, now());
    let delivered = f.store.last_acknowledged_sources();
    assert_eq!(delivered, vec![source(original, 42)]);

    let rebuilt = open_queue(&f.directory.path().join("rebuilt-frozen"), &f.host);
    f.store.reset_records();
    f.store
        .activation(ACTIVATED_AT)
        .page(vec![batch_with_sources(Value::from(delivered))])
        .accounts(vec![account()])
        .items(vec![item(42, "https://www.instagram.com/p/EDITED/")]);
    sync(&rebuilt, &f.store, now());

    assert_eq!(post_urls(&drain(&rebuilt)), [original.to_owned()].into());
    assert!(f.store.item_reads().is_empty());
}

#[test]
fn test_existing_completion_recovers_original_sources_from_durable_jobs() {
    let f = fixture();
    let original = "https://www.instagram.com/p/ORIGINAL/";
    f.queue
        .enqueue_engagement(
            "waterloo",
            "76214170483",
            "waterloo.wat2do.io",
            original,
            Some(42),
            false,
        )
        .unwrap();
    assert_eq!(drain(&f.queue).len(), 1);
    f.queue
        .set_setting(
            &format!("carousel_engagement_batch:{BATCH_ID}"),
            Value::from(PUBLISHED_AT),
        )
        .unwrap();
    f.store
        .page(vec![batch()])
        .accounts(vec![account()])
        .items(vec![item(42, "https://www.instagram.com/p/EDITED/")]);

    assert_eq!(sync(&f.queue, &f.store, now()), stats(1, 0, 0, 1));

    assert!(drain(&f.queue).is_empty());
    assert_eq!(
        f.store.last_acknowledged_sources(),
        vec![source(original, 42)]
    );
}

#[test]
fn test_unrecoverable_completed_selection_cannot_block_another_batch() {
    for unrecoverable in ["missing", "ambiguous", "no_items", "null_event"] {
        let f = fixture();
        f.queue
            .set_setting(
                &format!("carousel_engagement_batch:{BATCH_ID}"),
                Value::from(PUBLISHED_AT),
            )
            .unwrap();
        if unrecoverable == "ambiguous" {
            for url in [
                "https://www.instagram.com/p/FIRST/",
                "https://www.instagram.com/p/SECOND/",
            ] {
                f.queue
                    .enqueue_engagement(
                        "waterloo",
                        "76214170483",
                        "waterloo.wat2do.io",
                        url,
                        Some(42),
                        false,
                    )
                    .unwrap();
            }
            drain(&f.queue);
        }
        let mut legacy_items = if unrecoverable == "no_items" {
            vec![]
        } else {
            vec![default_item()]
        };
        if unrecoverable == "null_event" {
            legacy_items[0].event_id = None;
        }
        f.store
            .page(vec![batch(), batch_with_id(SECOND_ID)])
            .accounts(vec![account()])
            .items(legacy_items)
            .items(vec![item(43, "https://www.instagram.com/p/NEW/")]);

        assert_eq!(
            sync(&f.queue, &f.store, now()),
            stats(2, 1, 1, 1),
            "{unrecoverable}"
        );

        assert_eq!(
            post_urls(&drain(&f.queue)),
            ["https://www.instagram.com/p/NEW/".to_owned()].into()
        );
        assert_eq!(
            f.queue
                .get_setting(&format!("carousel_engagement_sources:{BATCH_ID}"))
                .unwrap(),
            None
        );
        assert_eq!(
            f.store.acknowledgements(),
            vec![(
                SECOND_ID.to_owned(),
                f.queue.delivery_generation().to_owned(),
                vec![source("https://www.instagram.com/p/NEW/", 43)]
            )]
        );
    }
}

#[test]
fn test_no_eligible_sources_are_frozen_as_an_explicit_empty_selection() {
    let f = fixture();
    f.store
        .page(vec![batch()])
        .accounts(vec![account()])
        .items(vec![item(42, "https://example.com/post")]);

    assert_eq!(sync(&f.queue, &f.store, now())["submitted"], 0);

    assert_eq!(
        f.queue
            .get_setting(&format!("carousel_engagement_sources:{BATCH_ID}"))
            .unwrap(),
        Some(json!([]))
    );
    assert_eq!(
        f.store.acknowledgements(),
        vec![(
            BATCH_ID.to_owned(),
            f.queue.delivery_generation().to_owned(),
            vec![]
        )]
    );
}

#[test]
fn test_empty_cloud_selection_is_distinct_from_an_uncaptured_selection() {
    for (saved, expected_posts) in [(Some(json!([])), 0), (None, 1)] {
        let f = fixture();
        f.store
            .page(vec![PublishedBatch {
                browser_delivery_sources: saved.clone(),
                ..batch()
            }])
            .accounts(vec![account()])
            .items(vec![item(42, "https://www.instagram.com/p/EDITED/")]);

        assert_eq!(
            sync(&f.queue, &f.store, now())["posts"],
            expected_posts,
            "{saved:?}"
        );

        assert_eq!(f.store.item_reads().is_empty(), saved.is_some());
        assert_eq!(drain(&f.queue).len(), expected_posts);
        if saved.is_some() {
            assert_eq!(f.store.last_acknowledged_sources(), Vec::<Value>::new());
        }
    }
}

#[test]
fn test_frozen_source_receipt_failure_prevents_enqueue_and_cloud_acknowledgement() {
    let f = fixture();
    f.store
        .page(vec![batch()])
        .accounts(vec![account()])
        .items(vec![default_item()]);
    refuse(
        &f.queue,
        "settings",
        &format!("NEW.key = 'carousel_engagement_sources:{BATCH_ID}'"),
        "Frozen selection unavailable",
    );

    let error = sync_published_carousels(&f.queue, &f.store, Some(now())).unwrap_err();
    assert!(
        error.to_string().contains("Frozen selection unavailable"),
        "{error}"
    );

    restore(&f.queue);
    assert!(f.store.acknowledgements().is_empty());
    assert!(drain(&f.queue).is_empty());
}

#[test]
fn test_invalid_cloud_selection_is_not_queued_or_acknowledged() {
    for saved in [
        json!({}),
        json!([{"post_url": "https://example.com/post", "event_id": 42}]),
        json!([{"post_url": null, "event_id": 42}]),
        json!([{"post_url": "https://www.instagram.com/p/POST/", "event_id": true}]),
        json!([{"post_url": "https://www.instagram.com/p/POST/", "event_id": -1}]),
    ] {
        let f = fixture();
        f.store
            .page(vec![batch_with_sources(saved.clone())])
            .accounts(vec![account()]);

        assert_eq!(sync(&f.queue, &f.store, now())["skipped"], 1, "{saved}");

        assert!(f.store.acknowledgements().is_empty());
        assert!(drain(&f.queue).is_empty());
    }
}

#[test]
fn test_concurrent_collectors_adopt_one_atomic_cloud_selection() {
    let directory = tempfile::tempdir().unwrap();
    let host = FakeHost::idle();
    let queue = registered_queue(directory.path(), &host);
    let current_url = Arc::new(Mutex::new(
        "https://www.instagram.com/p/ORIGINAL/".to_owned(),
    ));
    let (captured_tx, captured_rx) = mpsc::channel::<()>();
    let (release_tx, release_rx) = mpsc::channel::<()>();
    let calls = AtomicUsize::new(0);
    let (captured_tx, release_rx) = (Mutex::new(captured_tx), Mutex::new(release_rx));
    let hook_url = current_url.clone();
    let store = FakeStore {
        items_hook: Some(Box::new(move |_| {
            let selection = vec![item(42, &hook_url.lock().unwrap())];
            if calls.fetch_add(1, Ordering::SeqCst) == 0 {
                captured_tx.lock().unwrap().send(()).unwrap();
                release_rx
                    .lock()
                    .unwrap()
                    .recv_timeout(Duration::from_secs(5))
                    .unwrap();
            }
            selection
        })),
        ..FakeStore::default()
    };
    store
        .page(vec![batch()])
        .accounts(vec![account()])
        .page(vec![batch()])
        .accounts(vec![account()]);

    std::thread::scope(|scope| {
        let first = scope.spawn(|| sync_published_carousels(&queue, &store, Some(now())));
        captured_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        *current_url.lock().unwrap() = "https://www.instagram.com/p/EDITED/".to_owned();
        let second = sync_published_carousels(&queue, &store, Some(now()));
        release_tx.send(()).unwrap();
        assert_eq!(second.unwrap()["submitted"], 1);
        assert_eq!(first.join().unwrap().unwrap()["skipped"], 1);
    });

    assert_eq!(store.freezes.lock().unwrap().len(), 2);
    let edited = current_url.lock().unwrap().clone();
    assert_eq!(post_urls(&drain(&queue)), [edited].into());
    assert_eq!(
        queue
            .get_setting(&format!("carousel_engagement_sources:{BATCH_ID}"))
            .unwrap(),
        Some(Value::from(store.frozen.lock().unwrap()[BATCH_ID].clone()))
    );
}

#[test]
fn test_partial_enqueue_then_sqlite_loss_replays_cloud_frozen_selection() {
    let f = fixture();
    refuse(
        &f.queue,
        "jobs",
        "json_extract(NEW.payload, '$.event_id') = 43",
        "Local enqueue interrupted",
    );
    f.store
        .page(vec![batch()])
        .accounts(vec![account()])
        .items(vec![
            default_item(),
            item(43, "https://www.instagram.com/p/SOURCE43/"),
        ]);
    let error = sync_published_carousels(&f.queue, &f.store, Some(now())).unwrap_err();
    assert!(
        error.to_string().contains("Local enqueue interrupted"),
        "{error}"
    );
    assert!(f.store.acknowledgements().is_empty());
    assert_eq!(
        f.queue
            .get_setting(&format!("carousel_engagement_batch:{BATCH_ID}"))
            .unwrap(),
        None
    );

    let rebuilt = open_queue(&f.directory.path().join("partial-loss"), &f.host);
    f.store.reset_records();
    let frozen = f.store.frozen.lock().unwrap()[BATCH_ID].clone();
    f.store
        .activation(ACTIVATED_AT)
        .page(vec![batch_with_sources(Value::from(frozen))])
        .accounts(vec![account()])
        .items(vec![item(42, "https://www.instagram.com/p/EDITED/")]);
    assert_eq!(sync(&rebuilt, &f.store, now())["submitted"], 2);

    assert_eq!(
        post_urls(&drain(&rebuilt)),
        [
            "https://www.instagram.com/p/SOURCE42/".to_owned(),
            "https://www.instagram.com/p/SOURCE43/".to_owned(),
        ]
        .into()
    );
    assert!(f.store.item_reads().is_empty());
}

#[test]
fn test_conflicting_local_and_cloud_receipts_fail_closed() {
    let f = fixture();
    f.queue
        .set_setting(
            &format!("carousel_engagement_sources:{BATCH_ID}"),
            json!([{"post_url": "https://www.instagram.com/p/ORIGINAL/", "event_id": 42}]),
        )
        .unwrap();
    f.store
        .page(vec![batch_with_sources(json!([
            {"post_url": "https://www.instagram.com/p/OTHER/", "event_id": 42}
        ]))])
        .accounts(vec![account()]);

    assert_eq!(sync(&f.queue, &f.store, now())["skipped"], 1);

    assert!(f.store.acknowledgements().is_empty());
    assert!(drain(&f.queue).is_empty());
}
