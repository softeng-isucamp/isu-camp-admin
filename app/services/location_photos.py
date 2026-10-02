import json
from dataclasses import dataclass

from extensions import db
from model.building_photo import BuildingPhoto
from model.location_photo import LocationPhoto

MAX_PHOTOS = 10
MAX_BYTES = 5 * 1024 * 1024
MIME_TYPES = {"image/png", "image/jpeg", "image/webp"}


@dataclass
class GalleryChange:
    uploads: list[tuple[str, str, bytes]]
    removed_ids: list[int]
    cover_index: int | None


def gallery_of(record):
    """The photo model owning this record's gallery, and how to address it.

    Buildings and indoor Locations keep their photos in separate tables, so a
    caller holding either one asks here instead of branching itself. An indoor
    Location is the one with a ``location_id``; a Building has only a
    ``building_id``, while a Location has both. The models are read off the
    module so a test can substitute them.
    """
    if hasattr(record, "location_id"):
        return LocationPhoto, "location_id", record.location_id
    return BuildingPhoto, "building_id", record.building_id


def list_photos(record):
    """Gallery rows in display order. ``content`` stays deferred."""
    model, column, owner_id = gallery_of(record)
    return (
        model.query
        .filter_by(**{column: owner_id})
        .order_by(model.position, model.photo_id)
        .all()
    )


def find_photo(record, photo_id):
    """One of this owner's photos, with its bytes, without reading the others."""
    model, column, owner_id = gallery_of(record)
    return (
        model.query
        .options(db.undefer(model.content))
        .filter_by(**{column: owner_id, "photo_id": photo_id})
        .first()
    )


def find_cover(record):
    """This owner's cover photo, with its bytes, or None.

    The cover is what the single-image /photo endpoint serves. It used to be a
    copy kept in ``building.photo`` / ``location.photo``; the ``is_cover`` flag
    is now the only place the choice is recorded.
    """
    model, column, owner_id = gallery_of(record)
    return (
        model.query
        .options(db.undefer(model.content))
        .filter_by(**{column: owner_id, "is_cover": True})
        .first()
    )


def read_gallery_change(request):
    uploads = request.files.getlist("photos")
    changed = bool(uploads) or "removePhotoIds" in request.form or "coverIndex" in request.form
    if not changed:
        return None, None
    try:
        removed = json.loads(request.form.get("removePhotoIds", "[]"))
        cover_value = request.form.get("coverIndex")
        cover_index = int(cover_value) if cover_value is not None else None
        if not isinstance(removed, list) or any(not isinstance(item, int) or item < 1 for item in removed):
            raise ValueError
        if len(set(removed)) != len(removed) or (cover_index is not None and cover_index < 0):
            raise ValueError
    except (ValueError, TypeError):
        return None, "Invalid photo changes."
    if len(uploads) > MAX_PHOTOS:
        return None, "A location can have up to 10 photos."
    prepared = []
    for upload in uploads:
        if upload.mimetype not in MIME_TYPES or not upload.filename:
            return None, "Choose PNG, JPEG, or WebP images."
        content = upload.read(MAX_BYTES + 1)
        if len(content) > MAX_BYTES:
            return None, "Each photo must be 5 MB or smaller."
        prepared.append((upload.filename.rsplit("/", 1)[-1].rsplit("\\", 1)[-1][:255], upload.mimetype, content))
    return GalleryChange(prepared, removed, cover_index), None


def read_photo_change(request):
    """The gallery edit a write request asks for, from either upload field.

    Returns ``(change, cover_last_upload, error)``. ``photos`` with
    ``coverIndex``/``removePhotoIds`` is the gallery editor. The older single
    ``photo`` field wrote straight into the owner's own photo column; that
    column is gone, so its image is appended to the gallery and becomes the
    cover -- which is what the field always meant.

    It appends rather than replacing the old cover on purpose. The admin sends
    this field only when it could not load the gallery (see the ``gallery ===
    undefined`` branch in the frontend's locations save), so the request is
    made without knowing what is already there and must not delete any of it.
    """
    change, error = read_gallery_change(request)
    if error is not None:
        return None, False, error
    if change is not None:
        return change, False, None

    upload = request.files.get("photo")
    if upload is None or not upload.filename:
        return None, False, None
    if upload.mimetype not in MIME_TYPES:
        return None, False, "Choose a PNG, JPEG, or WebP image."
    content = upload.read(MAX_BYTES + 1)
    if len(content) > MAX_BYTES:
        return None, False, "Photo must be 5 MB or smaller."
    filename = upload.filename.rsplit("/", 1)[-1].rsplit("\\", 1)[-1][:255]
    return GalleryChange([(filename, upload.mimetype, content)], [], None), True, None


def apply_gallery(record, change, cover_last_upload=False):
    """Apply uploads, removals, and a cover choice to one owner's gallery.

    ``cover_last_upload`` covers the single-photo field, which has no index to
    send: whatever it uploaded becomes the cover.
    """
    if change is None:
        return None
    existing = list_photos(record)
    by_id = {photo.photo_id: photo for photo in existing}
    if any(photo_id not in by_id for photo_id in change.removed_ids):
        return "A photo to remove no longer belongs to this location."
    remaining = [photo for photo in existing if photo.photo_id not in change.removed_ids]
    previous_cover_id = next((photo.photo_id for photo in remaining if photo.is_cover), None)
    if len(remaining) + len(change.uploads) > MAX_PHOTOS:
        return "A location can have up to 10 photos."
    if change.cover_index is not None and change.cover_index >= len(remaining) + len(change.uploads):
        return "Select an existing cover photo."

    for photo_id in change.removed_ids:
        db.session.delete(by_id[photo_id])
    # Cleared and flushed before any row claims the cover: the database allows
    # only one cover per owner, so the old one has to be gone first.
    for photo in remaining:
        photo.is_cover = False
    db.session.flush()

    model, column, owner_id = gallery_of(record)
    for index, (filename, mime_type, content) in enumerate(change.uploads, start=len(remaining)):
        photo = model(position=index, filename=filename, mime_type=mime_type,
                      content=content, is_cover=False, **{column: owner_id})
        db.session.add(photo)
        remaining.append(photo)
    for index, photo in enumerate(remaining):
        photo.position = index

    cover_index = change.cover_index
    if cover_index is None and cover_last_upload and change.uploads:
        cover_index = len(remaining) - 1
    if cover_index is None and remaining:
        previous_cover = next((index for index, photo in enumerate(remaining) if photo.photo_id == previous_cover_id), None)
        cover_index = previous_cover if previous_cover is not None else 0
    if cover_index is not None:
        remaining[cover_index].is_cover = True
    # ``photo_present`` is a subquery over the rows just staged, so let the
    # next read of it see them.
    db.session.flush()
    db.session.expire(record, ["photo_present"])
    return None
