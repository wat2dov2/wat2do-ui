from io import BytesIO

from PIL import Image

from scripts import make_event_image_thumbnails as script
from services.image_thumbnails import Thumbnail


def _jpeg(width: int, height: int) -> bytes:
    out = BytesIO()
    Image.new("RGB", (width, height), "red").save(out, format="JPEG")
    return out.getvalue()


def test_missing_thumbnails_are_made_beside_their_posters_and_others_left_alone(tmp_path, capsys):
    images = tmp_path / "event-images"
    images.mkdir()
    poster = _jpeg(1080, 1350)
    (images / "new.jpg").write_bytes(poster)
    (images / "done.png").write_bytes(_jpeg(100, 100))
    (images / "done.thumb.webp").write_bytes(b"existing thumbnail")
    (images / "broken.gif").write_bytes(b"not an image")
    (tmp_path / "event-videos").mkdir()
    (tmp_path / "event-videos" / "clip.mp4").write_bytes(b"video")

    assert script.main(["--media-dir", str(tmp_path), "--workers", "2"]) == 1

    # The same bytes an upload of this poster stores.
    assert (images / "new.thumb.webp").read_bytes() == Thumbnail.EVENT_IMAGE.make(poster)
    assert (images / "done.thumb.webp").read_bytes() == b"existing thumbnail"
    assert not (images / "broken.thumb.webp").exists()
    assert sorted(path.name for path in images.iterdir()) == [
        "broken.gif",
        "done.png",
        "done.thumb.webp",
        "new.jpg",
        "new.thumb.webp",
    ]
    assert list((tmp_path / "event-videos").iterdir()) == [tmp_path / "event-videos" / "clip.mp4"]
    output = capsys.readouterr()
    assert output.out.strip() == (
        "3 posters: made 1 thumbnails, 1 already had one, 1 could not be read"
    )
    assert "Not an image: broken.gif" in output.err

    # A rerun finds nothing new to make.
    (images / "broken.gif").unlink()
    assert script.main(["--media-dir", str(tmp_path), "--workers", "1"]) == 0
    assert "made 0 thumbnails, 2 already had one" in capsys.readouterr().out
