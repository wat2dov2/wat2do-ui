from services.instagram_notifications import profile_retrieval as module
from services.instagram_notifications.browser_queue import BrowserJobQueue

RECIPIENT_ID = "12342599092"
PROFILE = "https://www.instagram.com/ubcclub/"


def _listed(queue, *, posts, requested=True, url=PROFILE):
    job_id = queue.enqueue_retrieval(
        school="ubc", recipient_id=RECIPIENT_ID, account_username="wat2do.ubc", url=url
    )
    if requested:
        queue.set_setting(f"profile_request:{job_id}", True)
    queue.finish(queue.claim_next(), result={"target_url": url, "posts": posts})
    return job_id


def test_each_listed_post_joins_the_ingestion_queue_once(tmp_path, monkeypatch):
    queue = BrowserJobQueue(tmp_path / "state")
    calls = []
    monkeypatch.setattr(
        module.items,
        "queue_instagram",
        lambda urls, *, school: calls.append((urls, school)) or len(urls),
    )
    _listed(
        queue,
        posts=[
            {"url": "https://www.instagram.com/p/One/"},
            {"url": "https://www.instagram.com/reel/Two/"},
        ],
    )
    # A retrieval nobody requested as a profile listing (an old notification read).
    _listed(
        queue,
        posts=[{"url": "https://www.instagram.com/p/Old/"}],
        requested=False,
        url="https://www.instagram.com/otherclub/",
    )

    assert module.queue_retrieved_profiles(queue) == {"queued": 2, "invalid": 0}
    assert module.queue_retrieved_profiles(queue) == {"queued": 0, "invalid": 0}
    assert calls == [
        (["https://www.instagram.com/p/One/", "https://www.instagram.com/reel/Two/"], "ubc")
    ]


def test_a_mismatched_result_is_not_queued(tmp_path, monkeypatch):
    queue = BrowserJobQueue(tmp_path / "state")
    monkeypatch.setattr(module.items, "queue_instagram", lambda *_a, **_k: 1 / 0)
    job_id = queue.enqueue_retrieval(
        school="ubc", recipient_id=RECIPIENT_ID, account_username="wat2do.ubc", url=PROFILE
    )
    queue.set_setting(f"profile_request:{job_id}", True)
    queue.finish(
        queue.claim_next(),
        result={"target_url": "https://www.instagram.com/elsewhere/", "posts": []},
    )

    assert module.queue_retrieved_profiles(queue) == {"queued": 0, "invalid": 1}
