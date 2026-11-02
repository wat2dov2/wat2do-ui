from types import SimpleNamespace

from scripts import backfill_directory_event_images as module


class _FakeTable:
    def __init__(self, recorder):
        self._recorder = recorder
        self._payload = None
        self._id = None

    def update(self, payload):
        self._payload = payload
        return self

    def eq(self, _column, value):
        self._id = value
        return self

    def execute(self):
        self._recorder.append((self._id, self._payload))
        return SimpleNamespace(data=[{}])


def test_without_shared_defaults_drops_the_site_default():
    found = {
        1: "https://e.edu/a.png",
        2: "https://e.edu/default.png",
        3: "https://e.edu/default.png",
        4: "https://e.edu/default.png",
        5: "https://e.edu/default.png",
        6: "https://e.edu/default.png",  # shared by 5 events -> a site default
    }
    assert module.without_shared_defaults(found) == {1: "https://e.edu/a.png"}


def test_store_dry_run_writes_nothing(monkeypatch):
    writes: list = []
    monkeypatch.setattr(
        module, "get_sb", lambda: SimpleNamespace(table=lambda _n: _FakeTable(writes))
    )

    stats = module.store({1: "https://e.edu/a.png", 2: "https://e.edu/b.png"}, apply=False)

    assert stats["would_store"] == 2
    assert writes == []


def test_store_updates_only_successful_uploads(monkeypatch):
    writes: list = []
    monkeypatch.setattr(
        module, "get_sb", lambda: SimpleNamespace(table=lambda _n: _FakeTable(writes))
    )

    def upload(src, *, bucket, allow_all_domains):
        assert allow_all_domains is True
        return None if src.endswith("b.png") else "https://s3/" + src.rsplit("/", 1)[-1]

    monkeypatch.setattr(module, "upload_image_from_url", upload)

    stats = module.store({1: "https://e.edu/a.png", 2: "https://e.edu/b.png"}, apply=True)

    assert stats["stored"] == 1
    assert stats["download_failed"] == 1
    assert writes == [(1, {"source_image_url": "https://s3/a.png"})]
