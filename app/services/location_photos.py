import json
from dataclasses import dataclass

from extensions import db
from model.building import Building
from model.location_photo import LocationPhoto

MAX_PHOTOS = 10
MAX_BYTES = 5 * 1024 * 1024
MIME_TYPES = {"image/png", "image/jpeg", "image/webp"}


@dataclass
class GalleryChange:
    uploads: list[tuple[str, str, bytes]]
    removed_ids: list[int]
    cover_index: int | None


def owner_key(record):
    if isinstance(record, Building):
        return "building", record.building_id
    return "location", record.location_id


def list_photos(record):
    owner_type, owner_id = owner_key(record)
    return LocationPhoto.query.filter_by(owner_type=owner_type, owner_id=owner_id).order_by(LocationPhoto.position, LocationPhoto.photo_id).all()


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


def apply_gallery(record, change):
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
    for photo in remaining:
        photo.is_cover = False
    db.session.flush()

    owner_type, owner_id = owner_key(record)
    for index, (filename, mime_type, content) in enumerate(change.uploads, start=len(remaining)):
        photo = LocationPhoto(owner_type=owner_type, owner_id=owner_id, position=index,
                              filename=filename, mime_type=mime_type, content=content, is_cover=False)
        db.session.add(photo)
        remaining.append(photo)
    for index, photo in enumerate(remaining):
        photo.position = index
    cover_index = change.cover_index
    if cover_index is None and remaining:
        previous_cover = next((index for index, photo in enumerate(remaining) if photo.photo_id == previous_cover_id), None)
        cover_index = previous_cover if previous_cover is not None else 0
    cover = remaining[cover_index] if cover_index is not None else None
    if cover is not None:
        cover.is_cover = True
    record.photo = cover.content if cover else None
    record.photo_mime_type = cover.mime_type if cover else None
    return None
