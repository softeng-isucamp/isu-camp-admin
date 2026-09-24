import io

from flask import Flask, request

from model.building import Building
from services import location_photos as gallery


class Session:
    def __init__(self):
        self.added = []
        self.deleted = []

    def add(self, photo):
        self.added.append(photo)

    def delete(self, photo):
        self.deleted.append(photo)

    def flush(self):
        pass


class Photo:
    def __init__(self, **values):
        self.__dict__.update(values)


def test_gallery_keeps_existing_cover_when_appending_and_changes_it_when_selected(monkeypatch):
    owner = Building(building_id=42)
    first = Photo(photo_id=1, owner_type="building", owner_id=42, position=0,
                  filename="front.png", mime_type="image/png", content=b"front", is_cover=True)
    session = Session()
    monkeypatch.setattr(gallery, "list_photos", lambda record: [first])
    monkeypatch.setattr(gallery, "LocationPhoto", Photo)
    monkeypatch.setattr(gallery.db, "session", session)

    assert gallery.apply_gallery(owner, gallery.GalleryChange([("side.jpg", "image/jpeg", b"side")], [], None)) is None
    assert first.is_cover is True
    assert owner.photo == b"front"
    assert len(session.added) == 1

    session.added[0].photo_id = 2
    monkeypatch.setattr(gallery, "list_photos", lambda record: [first, session.added[0]])
    assert gallery.apply_gallery(owner, gallery.GalleryChange([], [], 1)) is None
    assert first.is_cover is False
    assert session.added[0].is_cover is True
    assert owner.photo == b"side"


def test_gallery_rejects_invalid_file_and_accepts_multiple_valid_uploads():
    app = Flask(__name__)
    with app.test_request_context("/photos", method="POST", data={
        "photos": [
            (io.BytesIO(b"png"), "front.png", "image/png"),
            (io.BytesIO(b"jpeg"), "side.jpg", "image/jpeg"),
        ],
        "coverIndex": "1",
        "removePhotoIds": "[]",
    }):
        change, error = gallery.read_gallery_change(request)
        assert error is None
        assert change.cover_index == 1
        assert len(change.uploads) == 2

    with app.test_request_context("/photos", method="POST", data={
        "photos": (io.BytesIO(b"pdf"), "notes.pdf", "application/pdf"),
        "removePhotoIds": "[]",
    }):
        _, error = gallery.read_gallery_change(request)
        assert error == "Choose PNG, JPEG, or WebP images."
