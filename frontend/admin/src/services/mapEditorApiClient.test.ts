import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LocalMapEditorAdapter,
  HttpMapEditorApiClient,
  createCampusBoundaryGeoJson,
  createMapEditorApiClient,
  extractConcurrencyConflicts,
  extractEntityFromLayers,
  filterNonConflictingOperations,
  normalizeMapLayers,
  type BuildingEntity,
  type OutdoorLocationEntity,
  type RouteNodeEntity,
  type PathwayEntity,
  type LocalMapFeatureEntity,
  type FeatureLinkEntity,
  type MapEditorLayers,
  type RawSeedSources,
  type WorkingOperation,
} from "./mapEditorApiClient";
import type { Building, Location, Pathway, RouteNode } from "../types";

const mockRawBuildings: Building[] = [
  {
    id: "bld-eng-01",
    name: "Engineering Complex",
    code: "ENG-MAIN",
    points: [
      [16.721, 121.689],
      [16.722, 121.689],
      [16.722, 121.69],
      [16.721, 121.69],
    ],
    status: "Active",
  },
  {
    id: "bld-unlinked-02",
    name: "New Agronomy Hall",
    code: "AGRO-01",
    points: [], // No geometry yet
    status: "Active",
  },
];

const mockRawLocations: Location[] = [
  {
    id: "loc-bld-rec",
    name: "Engineering Building Record",
    code: "ENG-REC",
    type: "Building",
    parentId: null,
    status: "Active",
    lat: 16.721,
    lng: 121.689,
    positioned: true,
  },
  {
    id: "loc-outdoor-pos",
    name: "Freedom Grandstand",
    code: "FGS-01",
    type: "Facility",
    parentId: null,
    status: "Active",
    lat: 16.7215,
    lng: 121.6895,
    positioned: true,
  },
  {
    id: "loc-outdoor-unpos",
    name: "Campus Quad Gazebo",
    code: "GAZ-01",
    type: "Facility",
    parentId: null,
    status: "Active",
    lat: null,
    lng: null,
    positioned: false,
  },
];

const mockRawRouteNodes: RouteNode[] = [
  {
    id: "node-ent-01",
    name: "Engineering Main Entrance",
    nodeType: "Entrance",
    associatedPlaceId: "bld-eng-01",
    lat: 16.721,
    lng: 121.689,
    status: "Active",
  },
  {
    id: "node-junc-02",
    name: "Central Plaza Junction",
    nodeType: "Junction",
    lat: 16.7215,
    lng: 121.6895,
    status: "Active",
  },
];

const mockRawPathways: Pathway[] = [
  {
    id: "path-01",
    name: "Engineering Walkway",
    sourceNodeId: "node-ent-01",
    destinationNodeId: "node-junc-02",
    distance: "65m",
    time: "1 min",
    shade: "Mostly Shaded",
    type: "Pedestrian Walkway",
    direction: "Two-way",
    status: "Open",
    pathPoints: [
      [16.721, 121.689],
      [16.7215, 121.6895],
    ],
  },
];

const mockSeedSources: RawSeedSources = {
  buildings: mockRawBuildings,
  locations: mockRawLocations,
  routeNodes: mockRawRouteNodes,
  pathways: mockRawPathways,
};

describe("MapEditorApiClient - Normalization and Fixture Seeding", () => {
  it("normalizes entities across all 6 spatial layers", () => {
    const layers = normalizeMapLayers(mockSeedSources);

    // 1. Buildings
    expect(layers.buildings).toHaveLength(2);
    const engBuilding = layers.buildings.find((b) => b.id === "bld-eng-01");
    expect(engBuilding).toBeDefined();
    expect(engBuilding?.name).toBe("Engineering Complex");
    expect(engBuilding?.linkedFeatureId).toBe("feat-poly-bld-eng-01");
    expect(engBuilding?.entranceNodeIds).toEqual(["node-ent-01"]);

    const unlinkedBuilding = layers.buildings.find((b) => b.id === "bld-unlinked-02");
    expect(unlinkedBuilding?.linkedFeatureId).toBeNull();
    expect(unlinkedBuilding?.entranceNodeIds).toEqual([]);

    // 2. Outdoor Locations (filters out type: 'Building')
    expect(layers.outdoorLocations).toHaveLength(2);
    expect(layers.outdoorLocations.some((l) => l.id === "loc-bld-rec")).toBe(false);
    const posLoc = layers.outdoorLocations.find((l) => l.id === "loc-outdoor-pos");
    expect(posLoc?.positioned).toBe(true);
    const unposLoc = layers.outdoorLocations.find((l) => l.id === "loc-outdoor-unpos");
    expect(unposLoc?.positioned).toBe(false);

    // 3. Route Nodes
    expect(layers.routeNodes).toHaveLength(2);
    const entNode = layers.routeNodes.find((n) => n.id === "node-ent-01");
    expect(entNode?.nodeType).toBe("Entrance");
    expect(entNode?.buildingId).toBe("bld-eng-01");

    // 4. Pathways
    expect(layers.pathways).toHaveLength(1);
    expect(layers.pathways[0].id).toBe("path-01");
    expect(layers.pathways[0].pathPoints).toEqual([
      [16.721, 121.689],
      [16.7215, 121.6895],
    ]);

    // 5. Local Map Features (includes campus boundary, seeded basemap, and building footprint)
    const footprint = layers.localFeatures.find((f) => f.id === "feat-poly-bld-eng-01");
    expect(footprint).toBeDefined();
    expect(footprint?.family).toBe("building_footprint");
    expect(footprint?.linkedBuildingId).toBe("bld-eng-01");
    expect(footprint?.coordinates).toEqual(mockRawBuildings[0].points);

    const boundaryFeature = layers.localFeatures.find((f) => f.family === "campus_boundary");
    expect(boundaryFeature).toBeDefined();

    // 6. Feature Links
    expect(layers.featureLinks).toHaveLength(1);
    expect(layers.featureLinks[0]).toEqual({
      id: "link-bld-eng-01",
      featureId: "feat-poly-bld-eng-01",
      targetDomain: "Locations",
      targetEntityId: "bld-eng-01",
      linkType: "building_footprint",
      createdAt: "2026-08-15T00:00:00Z",
    });
  });

  it("constructs a valid closed GeoJSON polygon for campus boundary", () => {
    const geoJson = createCampusBoundaryGeoJson([
      [16.71, 121.68],
      [16.72, 121.69],
      [16.73, 121.68],
    ]);

    expect(geoJson.type).toBe("Polygon");
    expect(geoJson.coordinates).toHaveLength(1);
    const ring = geoJson.coordinates[0];
    expect(ring.length).toBe(4); // Closed ring (first === last)
    expect(ring[0]).toEqual([121.68, 16.71]); // [lng, lat] GeoJSON format
    expect(ring[ring.length - 1]).toEqual([121.68, 16.71]);
  });
});

describe("LocalMapEditorAdapter - Queries and Commands", () => {
  let adapter: LocalMapEditorAdapter;

  beforeEach(() => {
    adapter = new LocalMapEditorAdapter({ seedSources: mockSeedSources });
  });

  it("loads map editor bootstrap payload with normalized layers and metadata", async () => {
    const bootstrap = await adapter.getMapEditorBootstrap("proj-echague");

    expect(bootstrap.adminDraft.draftVersion).toBe(1);
    expect(bootstrap.adminDraft.lastAuthorId).toBe("admin_justine");
    expect(bootstrap.publishedVersionId).toBe("pub-20260815-01");
    expect(bootstrap.campusBoundary.type).toBe("Polygon");
    expect(bootstrap.layers.buildings).toHaveLength(2);
    expect(bootstrap.layers.outdoorLocations).toHaveLength(2);
    expect(bootstrap.layers.routeNodes).toHaveLength(2);
    expect(bootstrap.layers.pathways).toHaveLength(1);
    expect(bootstrap.layers.localFeatures.length).toBeGreaterThan(0);
    expect(bootstrap.layers.featureLinks).toHaveLength(1);
  });

  describe("getEligibleUnattachedRecords", () => {
    it("returns eligible and ineligible buildings with ineligibility reasons", async () => {
      const buildings = await adapter.getEligibleUnattachedRecords("proj-echague", "buildings");

      const linked = buildings.find((b) => b.id === "bld-eng-01");
      expect(linked?.eligible).toBe(false);
      expect(linked?.ineligibleReason).toContain("Already linked to polygon feat-poly-bld-eng-01");

      const unlinked = buildings.find((b) => b.id === "bld-unlinked-02");
      expect(unlinked?.eligible).toBe(true);
      expect(unlinked?.ineligibleReason).toBeUndefined();
    });

    it("filters buildings by search query", async () => {
      const results = await adapter.getEligibleUnattachedRecords("proj-echague", "buildings", "agronomy");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("bld-unlinked-02");
    });

    it("returns eligible and ineligible outdoor locations based on position state", async () => {
      const locations = await adapter.getEligibleUnattachedRecords("proj-echague", "locations");

      const positioned = locations.find((l) => l.id === "loc-outdoor-pos");
      expect(positioned?.eligible).toBe(false);
      expect(positioned?.ineligibleReason).toContain("Already positioned at 16.7215, 121.6895");

      const unpositioned = locations.find((l) => l.id === "loc-outdoor-unpos");
      expect(unpositioned?.eligible).toBe(true);
      expect(unpositioned?.ineligibleReason).toBeUndefined();
    });

    it("filters locations by code or name search query", async () => {
      const results = await adapter.getEligibleUnattachedRecords("proj-echague", "locations", "GAZ-01");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("loc-outdoor-unpos");
    });
  });

  describe("saveDraft", () => {
    it("successfully applies operations, increments version, and updates layers", async () => {
      const newOutdoorLocation: OutdoorLocationEntity & { spatialRole: "building_footprint_owner" } = {
        id: "loc-outdoor-new",
        name: "New Student Plaza",
        code: "PLAZA-01",
        type: "Facility",
        status: "Active",
        parentId: null,
        lat: null,
        lng: null,
        positioned: false,
        spatialRole: "building_footprint_owner",
      };

      const operations: WorkingOperation[] = [
        {
          id: "op-create-loc-1",
          type: "create_entity",
          domain: "Locations",
          entityId: "loc-outdoor-new",
          before: null,
          after: newOutdoorLocation as unknown as Record<string, unknown>,
        },
        {
          id: "op-update-node-1",
          type: "update_geometry",
          domain: "Walking Network",
          entityId: "node-junc-02",
          before: { lat: 16.7215, lng: 121.6895 },
          after: { lat: 16.7218, lng: 121.6898 },
        },
      ];

      const saveResult = await adapter.saveDraft("proj-echague", 1, operations);
      expect(saveResult.success).toBe(true);
      if (saveResult.success) {
        expect(saveResult.newDraftVersion).toBe(2);
        expect(saveResult.updatedAt).toBeDefined();
      }

      // Verify layer state was updated
      const bootstrap = await adapter.getMapEditorBootstrap("proj-echague");
      expect(bootstrap.adminDraft.draftVersion).toBe(2);
      expect(bootstrap.layers.buildings.some((l) => l.id === "loc-outdoor-new")).toBe(true);
      const updatedNode = bootstrap.layers.routeNodes.find((n) => n.id === "node-junc-02");
      expect(updatedNode?.lat).toBe(16.7218);
      expect(updatedNode?.lng).toBe(121.6898);
    });

    it("applies compound batch operations atomically", async () => {
      const compoundOp: WorkingOperation = {
        id: "op-compound-bld",
        type: "compound_batch",
        domain: "Local Map Data",
        entityId: "feat-poly-new",
        before: null,
        after: null,
        nestedOperations: [
          {
            id: "sub-op-1",
            type: "create_entity",
            domain: "Local Map Data",
            entityId: "feat-poly-agro",
            before: null,
            after: {
              id: "feat-poly-agro",
              family: "building_footprint",
              name: "New Agronomy Footprint",
              isEditable: true,
              geometryType: "polygon",
              coordinates: [
                [16.723, 121.69],
                [16.724, 121.69],
                [16.724, 121.691],
                [16.723, 121.691],
              ],
              status: "active",
              linkedBuildingId: "bld-unlinked-02",
            } as unknown as Record<string, unknown>,
          },
          {
            id: "sub-op-2",
            type: "link_feature",
            domain: "Local Map Data",
            entityId: "link-bld-agro",
            before: null,
            after: {
              id: "link-bld-agro",
              featureId: "feat-poly-agro",
              targetDomain: "Locations",
              targetEntityId: "bld-unlinked-02",
              linkType: "building_footprint",
            } as unknown as Record<string, unknown>,
          },
        ],
      };

      const result = await adapter.saveDraft("proj-echague", 1, [compoundOp]);
      expect(result.success).toBe(true);

      const bootstrap = await adapter.getMapEditorBootstrap("proj-echague");
      const bld = bootstrap.layers.buildings.find((b) => b.id === "bld-unlinked-02");
      expect(bld?.linkedFeatureId).toBe("feat-poly-agro");
      expect(bootstrap.layers.featureLinks.some((l) => l.targetEntityId === "bld-unlinked-02")).toBe(true);
    });

    it("handles entity retirement, restoration, and unlinking operations", async () => {
      const retireOp: WorkingOperation = {
        id: "op-retire",
        type: "retire_entity",
        domain: "Local Map Data",
        entityId: "feat-poly-pkg-west",
        before: { status: "active" },
        after: { status: "retired" },
      };

      const unlinkOp: WorkingOperation = {
        id: "op-unlink",
        type: "unlink_feature",
        domain: "Local Map Data",
        entityId: "link-bld-eng-01",
        before: { linkedBuildingId: "bld-eng-01" },
        after: { linkedBuildingId: null },
      };

      const res = await adapter.saveDraft("proj-echague", 1, [retireOp, unlinkOp]);
      expect(res.success).toBe(true);

      const bootstrap = await adapter.getMapEditorBootstrap("proj-echague");
      const pkg = bootstrap.layers.localFeatures.find((f) => f.id === "feat-poly-pkg-west");
      expect(pkg?.status).toBe("retired");

      const bld = bootstrap.layers.buildings.find((b) => b.id === "bld-eng-01");
      expect(bld?.linkedFeatureId).toBeNull();
    });

    it("returns 409 CONCURRENCY_CONFLICT with structured diffs on base version mismatch", async () => {
      // Adapter is at draftVersion 1. Attempt save with baseDraftVersion 0 (stale)
      const operations: WorkingOperation[] = [
        {
          id: "op-stale-node",
          type: "update_geometry",
          domain: "Walking Network",
          entityId: "node-ent-01",
          before: { lat: 16.7205, lng: 121.6885 }, // Diverged from server's 16.721, 121.689
          after: { lat: 16.722, lng: 121.69 },
        },
        {
          id: "op-non-conflicting",
          type: "create_entity",
          domain: "Locations",
          entityId: "loc-new-temp",
          before: null,
          after: { id: "loc-new-temp", name: "Temp Gazebo" },
        },
      ];

      const saveResult = await adapter.saveDraft("proj-echague", 0, operations);
      expect(saveResult.success).toBe(false);
      if (!saveResult.success && saveResult.errorType === "CONCURRENCY_CONFLICT") {
        expect(saveResult.currentServerDraftVersion).toBe(1);
        expect(saveResult.conflictingEntities.length).toBeGreaterThan(0);
        const nodeConflict = saveResult.conflictingEntities.find((c) => c.entityId === "node-ent-01");
        expect(nodeConflict).toBeDefined();
        expect(nodeConflict?.field).toBe("lat");
        expect(nodeConflict?.serverValue).toBe(16.721);
        expect(nodeConflict?.clientValue).toBe(16.722);
        expect(nodeConflict?.conflictType).toBe("MODIFIED_BY_OTHER");
        expect(saveResult.nonConflictingOperationsCount).toBe(1);
      }
    });

    it("simulates injected concurrency conflicts and validation errors", async () => {
      adapter.setSimulatedConflict({
        serverVersion: 5,
        conflictingEntities: [
          {
            entityId: "node-ent-01",
            field: "lat",
            serverValue: 16.725,
            clientValue: 16.721,
            conflictType: "MODIFIED_BY_OTHER",
          },
        ],
      });

      const res = await adapter.saveDraft("proj-echague", 1, []);
      expect(res.success).toBe(false);
      if (!res.success && res.errorType === "CONCURRENCY_CONFLICT") {
        expect(res.currentServerDraftVersion).toBe(5);
        expect(res.conflictingEntities[0].serverValue).toBe(16.725);
      }

      adapter.setSimulatedConflict(null);
      adapter.setSimulatedError({
        success: false,
        errorType: "FEATURE_GEOMETRY_ERROR",
        message: "Self-intersecting polygon detected at edges (v1-v2) x (v3-v4).",
      });

      const errRes = await adapter.saveDraft("proj-echague", 1, []);
      expect(errRes.success).toBe(false);
      if (!errRes.success && errRes.errorType === "FEATURE_GEOMETRY_ERROR") {
        expect(errRes.message).toContain("Self-intersecting polygon");
      }
    });

    it("is idempotent for an accepted request and rejects an unowned update atomically", async () => {
      const operation: WorkingOperation = {
        id: "op-idempotent",
        type: "update_geometry",
        domain: "Walking Network",
        entityId: "node-ent-01",
        before: { lat: 16.721, lng: 121.689 },
        after: { lat: 16.7212, lng: 121.6892 },
      };
      const command = { projectId: "proj-echague", baseDraftVersion: 1, requestId: "request-1", operations: [operation] };
      const first = await adapter.saveDraft(command);
      const second = await adapter.saveDraft(command);
      expect(first).toEqual(second);
      expect((await adapter.getMapEditorBootstrap("proj-echague")).adminDraft.draftVersion).toBe(2);

      const rejected = await adapter.saveDraft({
        projectId: "proj-echague",
        baseDraftVersion: 2,
        requestId: "request-2",
        operations: [{ ...operation, id: "op-unowned", entityId: "missing-node" }],
      });
      expect(rejected).toMatchObject({ success: false, errorType: "FIELD_VALIDATION_ERROR" });
      expect((await adapter.getMapEditorBootstrap("proj-echague")).adminDraft.draftVersion).toBe(2);
    });

    it("applies a canonical Building create once and keeps it out of outdoor locations", async () => {
      const result = await adapter.saveDraft({
        projectId: "proj-echague",
        baseDraftVersion: 1,
        requestId: "request-building-once",
        operations: [{
          id: "op-create-building-once",
          type: "create_entity",
          domain: "Locations",
          entityId: "bld-new-once",
          before: null,
          after: {
            id: "bld-new-once",
            name: "New Building",
            code: "NEW-BLDG",
            type: "Building",
            status: "Active",
            parentId: null,
            lat: null,
            lng: null,
            positioned: false,
            spatialRole: "building_footprint_owner",
          },
        }],
      });

      expect(result.success).toBe(true);
      const layers = await adapter.getMapEditorBootstrap("proj-echague");
      expect(layers.layers.buildings.filter((building) => building.id === "bld-new-once")).toHaveLength(1);
      expect(layers.layers.outdoorLocations.some((location) => location.id === "bld-new-once")).toBe(false);
    });

    it("does not partially apply a compound command when a later nested operation fails", async () => {
      const result = await adapter.saveDraft({
        projectId: "proj-echague",
        baseDraftVersion: 1,
        requestId: "request-atomic-validation",
        operations: [{
          id: "op-atomic-validation",
          type: "compound_batch",
          domain: "Locations",
          entityId: "loc-atomic-validation",
          before: null,
          after: null,
          nestedOperations: [
            {
              id: "op-create-before-failure",
              type: "create_entity",
              domain: "Locations",
              entityId: "loc-created-before-failure",
              before: null,
              after: {
                id: "loc-created-before-failure",
                name: "Should Not Persist",
                code: "NO-PERSIST",
                type: "Facility",
                status: "Active",
                parentId: null,
                lat: 16.72,
                lng: 121.69,
                positioned: true,
              },
            },
            {
              id: "op-update-missing-after-create",
              type: "update_properties",
              domain: "Locations",
              entityId: "missing-location",
              before: { name: "Missing" },
              after: { name: "Still Missing" },
            },
          ],
        }],
      });

      expect(result).toMatchObject({ success: false, errorType: "FIELD_VALIDATION_ERROR" });
      const layers = await adapter.getMapEditorBootstrap("proj-echague");
      expect(layers.layers.outdoorLocations.some((location) => location.id === "loc-created-before-failure")).toBe(false);
      expect(layers.adminDraft.draftVersion).toBe(1);
    });
  });

  describe("publishDraft and discardDraft", () => {
    it("publishes draft successfully when draft version matches", async () => {
      const pubResult = await adapter.publishDraft("proj-echague", 1);
      expect(pubResult.success).toBe(true);
      expect(pubResult.newPublishedVersionId).toContain("pub-");
      expect(pubResult.publishedAt).toBeDefined();
    });

    it("fails publication if draft version is stale", async () => {
      const pubResult = await adapter.publishDraft("proj-echague", 99);
      expect(pubResult.success).toBe(false);
      expect(pubResult.warnings?.[0]).toContain("Draft version mismatch");
    });

    it("discards draft by restoring layers to published baseline", async () => {
      // Modify layers with save
      await adapter.saveDraft("proj-echague", 1, [
        {
          id: "op-rename",
          type: "update_properties",
          domain: "Locations",
          entityId: "bld-eng-01",
          before: { name: "Engineering Complex" },
          after: { name: "Renamed Complex" },
        },
      ]);

      let bootstrap = await adapter.getMapEditorBootstrap("proj-echague");
      expect(bootstrap.layers.buildings.find((b) => b.id === "bld-eng-01")?.name).toBe("Renamed Complex");

      const discardRes = await adapter.discardDraft("proj-echague", 2);
      expect(discardRes.success).toBe(true);

      bootstrap = await adapter.getMapEditorBootstrap("proj-echague");
      expect(bootstrap.layers.buildings.find((b) => b.id === "bld-eng-01")?.name).toBe("Engineering Complex");
    });
  });
});

describe("Conflict Resolution & Session State Helpers", () => {
  it("filters non-conflicting operations to prevent wiping clean local session state", () => {
    const operations: WorkingOperation[] = [
      {
        id: "op-1",
        type: "update_geometry",
        domain: "Walking Network",
        entityId: "node-ent-01",
        before: { lat: 16.72 },
        after: { lat: 16.721 },
      },
      {
        id: "op-2",
        type: "create_entity",
        domain: "Locations",
        entityId: "loc-safe-01",
        before: null,
        after: { id: "loc-safe-01", name: "Safe Gazebo" },
      },
    ];

    const conflictingEntityIds = new Set(["node-ent-01"]);
    const retained = filterNonConflictingOperations(operations, conflictingEntityIds);

    expect(retained).toHaveLength(1);
    expect(retained[0].entityId).toBe("loc-safe-01");
  });

  it("extracts entity by domain and ID accurately", () => {
    const layers = normalizeMapLayers(mockSeedSources);
    const bld = extractEntityFromLayers(layers, "Locations", "bld-eng-01");
    expect(bld?.name).toBe("Engineering Complex");

    const node = extractEntityFromLayers(layers, "Walking Network", "node-ent-01");
    expect(node?.name).toBe("Engineering Main Entrance");

    const feat = extractEntityFromLayers(layers, "Local Map Data", "feat-poly-bld-eng-01");
    expect(feat?.family).toBe("building_footprint");

    const missing = extractEntityFromLayers(layers, "Locations", "non-existent");
    expect(missing).toBeNull();
  });
});

describe("HttpMapEditorApiClient", () => {
  let fetchMock: any;
  let client: HttpMapEditorApiClient;

  beforeEach(() => {
    client = new HttpMapEditorApiClient("http://localhost:5001");
    fetchMock = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches bootstrap payload via HTTP GET", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          adminDraft: { draftVersion: 3, updatedAt: "2026-08-28T12:00:00Z", lastAuthorId: "admin_1" },
          publishedVersionId: "pub-001",
          campusBoundary: { type: "Polygon", coordinates: [] },
          layers: {
            buildings: [],
            outdoorLocations: [],
            routeNodes: [],
            pathways: [],
            localFeatures: [],
            featureLinks: [],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const bootstrap = await client.getMapEditorBootstrap("proj-1");
    expect(bootstrap.adminDraft.draftVersion).toBe(3);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:5001/api/map-editor/bootstrap?projectId=proj-1",
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("searches unattached records via HTTP GET", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { id: "bld-1", code: "ENG", name: "Engineering", category: "Academic", eligible: true },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const records = await client.getEligibleUnattachedRecords("proj-1", "buildings", "eng");
    expect(records).toHaveLength(1);
    expect(records[0].code).toBe("ENG");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:5001/api/map-editor/unattached-records?projectId=proj-1&domain=buildings&searchQuery=eng",
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("dispatches saveDraft via HTTP POST and handles structured 409 response", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: false,
          errorType: "CONCURRENCY_CONFLICT",
          currentServerDraftVersion: 4,
          conflictingEntities: [
            {
              entityId: "bld-1",
              field: "name",
              serverValue: "Server Name",
              clientValue: "Client Name",
              conflictType: "MODIFIED_BY_OTHER",
            },
          ],
          nonConflictingOperationsCount: 2,
        }),
        { status: 409, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await client.saveDraft("proj-1", 3, []);
    expect(result.success).toBe(false);
    if (!result.success && result.errorType === "CONCURRENCY_CONFLICT") {
      expect(result.currentServerDraftVersion).toBe(4);
      expect(result.conflictingEntities[0].conflictType).toBe("MODIFIED_BY_OTHER");
    }
  });

  it("publishes and discards draft via HTTP POST", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          newPublishedVersionId: "pub-002",
          publishedAt: "2026-08-28T12:00:00Z",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const pubRes = await client.publishDraft("proj-1", 3);
    expect(pubRes.success).toBe(true);

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const discardRes = await client.discardDraft("proj-1", 3);
    expect(discardRes.success).toBe(true);
  });
});

describe("createMapEditorApiClient factory", () => {
  it("uses the local adapter when the dedicated test adapter is enabled", () => {
    const client = createMapEditorApiClient();

    expect(client).toBeInstanceOf(LocalMapEditorAdapter);
  });

  it("creates a local adapter in local mode and http adapter in mock/real mode", () => {
    const local = createMapEditorApiClient({ mode: "local" });
    expect(local).toBeInstanceOf(LocalMapEditorAdapter);

    const remote = createMapEditorApiClient({ mode: "real", baseUrl: "https://api.isucamp.edu" });
    expect(remote).toBeInstanceOf(HttpMapEditorApiClient);
  });
});
