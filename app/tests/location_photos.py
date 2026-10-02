import io

from flask import Flask, request

from model.building import Building
from model.location import Location
from services import location_photos as gallery


class Session:
    def __init__(self):
        self.added = []
        self.deleted = []
        self.expired = []

    def add(self, photo):
        self.added.append(photo)

    def delete(self, photo):
        self.deleted.append(photo)

    def flush(self):
        pass

    def expire(self, record, attributes=None):
        self.expired.append((record, tuple(attributes or ())))


class Photo:
    def __init__(self, **values):
        # The real models leave photo_id unset until the database assigns one.
        self.photo_id = None
        self.__dict__.update(values)


def test_gallery_keeps_existing_cover_when_appending_and_changes_it_when_selected(monkeypatch):
    owner = Building(building_id=42)
    first = Photo(photo_id=1, building_id=42, position=0,
                  filename="front.png", mime_type="image/png", content=b"front", is_cover=True)
    session = Session()
    monkeypatch.setattr(gallery, "list_photos", lambda record: [first])
    monkeypatch.setattr(gallery, "BuildingPhoto", Photo)
    monkeypatch.setattr(gallery.db, "session", session)

    assert gallery.apply_gallery(owner, gallery.GalleryChange([("side.jpg", "image/jpeg", b"side")], [], None)) is None
    # Appending a photo must not disturb a cover the owner already chose, and
    # ``is_cover`` is the only place that choice is recorded now.
    assert first.is_cover is True
    assert len(session.added) == 1
    assert session.added[0].is_cover is False
    assert session.added[0].building_id == 42

    session.added[0].photo_id = 2
    monkeypatch.setattr(gallery, "list_photos", lambda record: [first, session.added[0]])
    assert gallery.apply_gallery(owner, gallery.GalleryChange([], [], 1)) is None
    assert first.is_cover is False
    assert session.added[0].is_cover is True


def test_an_indoor_location_is_routed_to_its_own_photo_table(monkeypatch):
    """A Building and a Location with the same id write to different tables."""
    session = Session()
    monkeypatch.setattr(gallery, "list_photos", lambda record: [])
    monkeypatch.setattr(gallery, "BuildingPhoto", Photo)
    monkeypatch.setattr(gallery, "LocationPhoto", Photo)
    monkeypatch.setattr(gallery.db, "session", session)

    assert gallery.gallery_of(Building(building_id=7))[:2] == (Photo, "building_id")
    assert gallery.gallery_of(Location(location_id=7))[:2] == (Photo, "location_id")

    assert gallery.apply_gallery(
        Location(location_id=7),
        gallery.GalleryChange([("front.png", "image/png", b"front")], [], None),
    ) is None
    assert session.added[0].location_id == 7
    assert not hasattr(session.added[0], "building_id")


def test_the_single_photo_field_is_read_as_a_cover_upload():
    app = Flask(__name__)
    with app.test_request_context("/locations/1", method="PUT", data={
        "photo": (io.BytesIO(b"png"), "front.png", "image/png"),
    }):
        change, cover_last_upload, error = gallery.read_photo_change(request)
        assert error is None
        assert cover_last_upload is True
        assert change.uploads == [("front.png", "image/png", b"png")]
        assert change.removed_ids == [] and change.cover_index is None

    with app.test_request_context("/locations/1", method="PUT", data={
        "photo": (io.BytesIO(b"pdf"), "notes.pdf", "application/pdf"),
    }):
        _, _, error = gallery.read_photo_change(request)
        assert error == "Choose a PNG, JPEG, or WebP image."


def test_a_lone_cover_upload_takes_the_cover_from_the_previous_one(monkeypatch):
    """The single ``photo`` field has no index to send, so its upload wins."""
    owner = Building(building_id=42)
    existing = Photo(photo_id=1, building_id=42, position=0, filename="old.png",
                     mime_type="image/png", content=b"old", is_cover=True)
    session = Session()
    monkeypatch.setattr(gallery, "list_photos", lambda record: [existing])
    monkeypatch.setattr(gallery, "BuildingPhoto", Photo)
    monkeypatch.setattr(gallery.db, "session", session)

    change = gallery.GalleryChange([("new.jpg", "image/jpeg", b"new")], [], None)
    assert gallery.apply_gallery(owner, change, cover_last_upload=True) is None
    assert existing.is_cover is False
    assert session.added[0].is_cover is True


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
