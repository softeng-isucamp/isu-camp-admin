# Location photo gallery

The Admin App's Locations form stores up to ten photos for each Campus Location. Buildings, Facilities, and Indoor Locations use the same interaction.

- The photo section starts minimized in Add and Edit Location. Its compact row shows the cover preview and photo count.
- **Choose photos** stays visible beside a round chevron that shows or minimizes the gallery.
- The section accepts multiple PNG, JPEG, or WebP files by file chooser or drag and drop. Each file is limited to 5 MB. Valid files in a mixed selection are accepted and rejected files are named in an error.
- New photos are appended. Admins can remove individual photos or choose a cover. The first photo becomes the cover by default. Display order is the order added; there is no manual reordering.
- Existing single photos become the first photo and cover. Photo access stays within Locations. The directory and map do not gain a gallery.
- Adding, removing, and cover changes are saved with the Location form. Cancel leaves stored photos unchanged.
- A description field is not required for photos.

Apply `migrations/20260925_location_photo_gallery.sql` before deploying the API. The migration preserves existing photo bytes and can be rerun safely. It enables row level security and revokes direct Supabase API access to the gallery table; photos are served through the authenticated admin Locations API.
