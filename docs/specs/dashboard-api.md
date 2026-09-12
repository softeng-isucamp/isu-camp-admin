# Admin Dashboard API Contract

The admin frontend reads the dashboard through one authenticated aggregate endpoint. The backend owns all counts, time-window filtering, ranking, and audit ordering; the frontend does not reconstruct dashboard totals from paginated resource endpoints.

## Request

`GET /api/dashboard?range=week|month|all`

- Authentication uses the existing admin session cookie.
- `range` defaults to `week` when omitted.
- An unsupported range returns `400` with the standard `{ "success": false, "message": string }` error body.

## Successful response

The endpoint may return the object directly or under a `data` property:

```json
{
  "data": {
    "buildings": 142,
    "buildingChange": 2,
    "offices": 1854,
    "locations": 2034,
    "pathways": 87,
    "searches": 438,
    "topSearched": [
      {
        "rank": "1",
        "locationId": "42",
        "name": "University Library",
        "context": "Student Services",
        "searches": 126
      }
    ],
    "recent": [
      {
        "id": "981",
        "actor": "admin01",
        "action": "Updated Location",
        "target": "University Library",
        "targetId": "42",
        "detail": "Location metadata was updated.",
        "createdAt": "2026-09-12T08:30:00Z",
        "category": "Admin"
      }
    ]
  }
}
```

## Field semantics

- `buildings`: current number of Building records.
- `buildingChange`: Building records created in the selected range; use `null` when the backend cannot calculate this value.
- `offices`: current number of active Office locations.
- `locations`: current total directory size.
- `pathways`: current number of active pathways.
- `searches`: user location searches in the selected range.
- `topSearched`: descending search totals for the selected range. Return at most five rows and use stable location IDs when available.
- `recent`: newest audit entries first, limited to three rows. Timestamps must be ISO 8601 strings.

All numeric values must be non-negative integers except `buildingChange`, which may also be negative or `null`. Empty analytics and activity are represented by empty arrays, not omitted fields.
