import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  WorkingSessionManager,
  createEntityOperation,
  updateGeometryOperation,
  updatePropertiesOperation,
  retireEntityOperation,
  restoreEntityOperation,
  linkFeatureOperation,
  unlinkFeatureOperation,
  compoundBatchOperation,
  traverseRevertOperation,
  traverseApplyOperation,
  handleWorkingSessionKeyboardShortcut,
} from "./WorkingSessionManager";
import type { ActiveToolDraft, WorkingOperation } from "./types";

describe("WorkingSessionManager", () => {
  let manager: WorkingSessionManager;

  beforeEach(() => {
    manager = new WorkingSessionManager();
  });

  describe("Undo / Redo Stack Maintenance", () => {
    it("initializes with empty past and future operations", () => {
      expect(manager.canUndo()).toBe(false);
      expect(manager.canRedo()).toBe(false);
      expect(manager.getPastOperations()).toHaveLength(0);
      expect(manager.getFutureOperations()).toHaveLength(0);
      expect(manager.isDirty).toBe(false);
      expect(manager.getUncommittedCount()).toBe(0);
    });

    it("executes an operation, pushing to pastOperations and clearing futureOperations", () => {
      const op = manager.executeOperation({
        type: "create_entity",
        domain: "Locations",
        entityId: "loc-1",
        before: null,
        after: { name: "Administration Building", code: "ADM" },
      });

      expect(op.id).toBeDefined();
      expect(manager.canUndo()).toBe(true);
      expect(manager.canRedo()).toBe(false);
      expect(manager.getPastOperations()).toHaveLength(1);
      expect(manager.getPastOperations()[0].entityId).toBe("loc-1");
      expect(manager.isDirty).toBe(true);
      expect(manager.getUncommittedCount()).toBe(1);
    });

    it("steps backward on undo and forward on redo", () => {
      const op1 = manager.executeOperation({
        type: "create_entity",
        domain: "Locations",
        entityId: "loc-1",
        before: null,
        after: { name: "Building 1" },
      });
      const op2 = manager.executeOperation({
        type: "update_properties",
        domain: "Locations",
        entityId: "loc-1",
        before: { name: "Building 1" },
        after: { name: "Building 1 Renamed" },
      });

      expect(manager.getPastOperations()).toHaveLength(2);

      // Undo op2
      const undoneOp = manager.undo();
      expect(undoneOp?.id).toBe(op2.id);
      expect(manager.getPastOperations()).toHaveLength(1);
      expect(manager.getFutureOperations()).toHaveLength(1);
      expect(manager.canUndo()).toBe(true);
      expect(manager.canRedo()).toBe(true);

      // Undo op1
      const undoneOp1 = manager.undo();
      expect(undoneOp1?.id).toBe(op1.id);
      expect(manager.getPastOperations()).toHaveLength(0);
      expect(manager.getFutureOperations()).toHaveLength(2);
      expect(manager.canUndo()).toBe(false);
      expect(manager.canRedo()).toBe(true);

      // Redo op1
      const redoneOp1 = manager.redo();
      expect(redoneOp1?.id).toBe(op1.id);
      expect(manager.getPastOperations()).toHaveLength(1);
      expect(manager.getFutureOperations()).toHaveLength(1);

      // Redo op2
      const redoneOp2 = manager.redo();
      expect(redoneOp2?.id).toBe(op2.id);
      expect(manager.getPastOperations()).toHaveLength(2);
      expect(manager.getFutureOperations()).toHaveLength(0);
      expect(manager.canRedo()).toBe(false);
    });

    it("clears future operations when a new operation is executed mid-stack", () => {
      manager.executeOperation({
        type: "create_entity",
        domain: "Locations",
        entityId: "loc-1",
        before: null,
        after: { name: "A" },
      });
      manager.executeOperation({
        type: "update_properties",
        domain: "Locations",
        entityId: "loc-1",
        before: { name: "A" },
        after: { name: "B" },
      });

      // Undo to first op
      manager.undo();
      expect(manager.getFutureOperations()).toHaveLength(1);

      // Execute new branch
      manager.executeOperation({
        type: "update_properties",
        domain: "Locations",
        entityId: "loc-1",
        before: { name: "A" },
        after: { name: "C" },
      });

      expect(manager.getPastOperations()).toHaveLength(2);
      expect(manager.getFutureOperations()).toHaveLength(0);
      expect(manager.canRedo()).toBe(false);
    });

    it("returns null when attempting to undo an empty stack or redo an empty future", () => {
      expect(manager.undo()).toBeNull();
      expect(manager.redo()).toBeNull();
    });
  });

  describe("Operation Types & Helper Factories", () => {
    it("creates create_entity operation via factory", () => {
      const op = createEntityOperation("Locations", "bld-1", { name: "Science Hall", code: "SCI" });
      expect(op.type).toBe("create_entity");
      expect(op.domain).toBe("Locations");
      expect(op.entityId).toBe("bld-1");
      expect(op.before).toBeNull();
      expect(op.after).toEqual({ name: "Science Hall", code: "SCI" });
    });

    it("creates update_geometry operation via factory", () => {
      const op = updateGeometryOperation(
        "Local Map Data",
        "feat-1",
        { points: [[0, 0], [10, 0], [10, 10], [0, 10]] },
        { points: [[0, 0], [20, 0], [20, 20], [0, 20]] }
      );
      expect(op.type).toBe("update_geometry");
      expect(op.domain).toBe("Local Map Data");
      expect(op.before).toEqual({ points: [[0, 0], [10, 0], [10, 10], [0, 10]] });
      expect(op.after).toEqual({ points: [[0, 0], [20, 0], [20, 20], [0, 20]] });
    });

    it("creates update_properties operation via factory", () => {
      const op = updatePropertiesOperation(
        "Routes & Paths",
        "pw-1",
        { surfaceType: "concrete" },
        { surfaceType: "asphalt" }
      );
      expect(op.type).toBe("update_properties");
      expect(op.domain).toBe("Routes & Paths");
      expect(op.before).toEqual({ surfaceType: "concrete" });
      expect(op.after).toEqual({ surfaceType: "asphalt" });
    });

    it("creates retire_entity and restore_entity operations via factories", () => {
      const currentRec = { id: "feat-1", name: "Old Walkway", status: "active" };
      const retireOp = retireEntityOperation("Local Map Data", "feat-1", currentRec);
      expect(retireOp.type).toBe("retire_entity");
      expect(retireOp.before).toEqual(currentRec);
      expect(retireOp.after).toEqual({ ...currentRec, status: "retired" });

      const retiredRec = { id: "feat-1", name: "Old Walkway", status: "retired" };
      const restoreOp = restoreEntityOperation("Local Map Data", "feat-1", retiredRec);
      expect(restoreOp.type).toBe("restore_entity");
      expect(restoreOp.before).toEqual(retiredRec);
      expect(restoreOp.after).toEqual({ ...retiredRec, status: "active" });
    });

    it("creates link_feature and unlink_feature operations via factories", () => {
      const linkData = { featureId: "poly-1", targetDomain: "Locations", targetEntityId: "bld-1" };
      const linkOp = linkFeatureOperation("Local Map Data", "link-1", linkData);
      expect(linkOp.type).toBe("link_feature");
      expect(linkOp.before).toBeNull();
      expect(linkOp.after).toEqual(linkData);

      const unlinkOp = unlinkFeatureOperation("Local Map Data", "link-1", linkData);
      expect(unlinkOp.type).toBe("unlink_feature");
      expect(unlinkOp.before).toEqual(linkData);
      expect(unlinkOp.after).toBeNull();
    });
  });

  describe("Compound Batch Operations & Atomic Reversion", () => {
    it("executes compound batch operation as a single atomic unit", () => {
      const opFootprint = createEntityOperation("Local Map Data", "poly-101", {
        family: "building_footprint",
        coordinates: [[0, 0], [10, 0], [10, 10], [0, 10]],
      });
      const opBuilding = createEntityOperation("Locations", "bld-202", {
        name: "Engineering Annex",
        code: "ENG-ANNEX",
      });
      const opLink = linkFeatureOperation("Local Map Data", "lnk-303", {
        featureId: "poly-101",
        targetEntityId: "bld-202",
      });

      const batchOp = manager.executeBatch(
        "Create building with footprint & link",
        "Locations",
        "bld-202",
        [opFootprint, opBuilding, opLink]
      );

      expect(batchOp.type).toBe("compound_batch");
      expect(batchOp.nestedOperations).toHaveLength(3);
      expect(manager.getPastOperations()).toHaveLength(1);

      // Undo whole batch in one step
      const undone = manager.undo();
      expect(undone?.id).toBe(batchOp.id);
      expect(undone?.nestedOperations).toHaveLength(3);
      expect(manager.getPastOperations()).toHaveLength(0);
      expect(manager.getFutureOperations()).toHaveLength(1);

      // Redo whole batch in one step
      const redone = manager.redo();
      expect(redone?.id).toBe(batchOp.id);
      expect(manager.getPastOperations()).toHaveLength(1);
    });

    it("traverses compound nested operations in LIFO order for reversion", () => {
      const op1 = createEntityOperation("Local Map Data", "p1", { name: "Footprint" });
      const op2 = createEntityOperation("Locations", "b1", { name: "Building" });
      const op3 = linkFeatureOperation("Local Map Data", "l1", { link: "active" });

      const batch = compoundBatchOperation("Locations", "b1", [op1, op2, op3]);

      const visitedIds: string[] = [];
      traverseRevertOperation(batch, (op) => {
        visitedIds.push(op.entityId);
      });

      // LIFO reverse order: l1 (op3) -> b1 (op2) -> p1 (op1) -> b1 (batch)
      expect(visitedIds).toEqual(["l1", "b1", "p1", "b1"]);
    });

    it("traverses compound nested operations in forward order for application", () => {
      const op1 = createEntityOperation("Local Map Data", "p1", { name: "Footprint" });
      const op2 = createEntityOperation("Locations", "b1", { name: "Building" });
      const op3 = linkFeatureOperation("Local Map Data", "l1", { link: "active" });

      const batch = compoundBatchOperation("Locations", "b1", [op1, op2, op3]);

      const visitedIds: string[] = [];
      traverseApplyOperation(batch, (op) => {
        visitedIds.push(op.entityId);
      });

      // Forward order: batch -> p1 -> b1 -> l1
      expect(visitedIds).toEqual(["b1", "p1", "b1", "l1"]);
    });
  });

  describe("Active Tool Draft & Interruption State Machine", () => {
    it("starts, updates, and discards active tool drafts", () => {
      expect(manager.hasActiveDraft()).toBe(false);

      const draft = manager.startDraft({
        toolType: "polygon",
        label: "Building Footprint",
        provisionalGeometry: { points: [{ x: 10, y: 10 }] },
      });

      expect(draft.id).toBeDefined();
      expect(draft.isSuspended).toBe(false);
      expect(manager.hasActiveDraft()).toBe(true);
      expect(manager.getActiveDraft()?.toolType).toBe("polygon");

      manager.updateDraft({
        provisionalGeometry: { points: [{ x: 10, y: 10 }, { x: 20, y: 20 }] },
      });
      expect(manager.getActiveDraft()?.provisionalGeometry.points).toHaveLength(2);

      manager.discardActiveDraft();
      expect(manager.hasActiveDraft()).toBe(false);
    });

    it("handles interruption with keep_draft: suspends into shelf and clears active", () => {
      manager.startDraft({
        id: "draft-polygon-1",
        toolType: "polygon",
        label: "Draft Footprint",
        provisionalGeometry: { points: [{ x: 5, y: 5 }, { x: 15, y: 5 }] },
      });

      const result = manager.handleInterruption("keep_draft");
      expect(result.actionTaken).toBe("keep_draft");
      expect(result.suspendedDraft?.id).toBe("draft-polygon-1");
      expect(result.suspendedDraft?.isSuspended).toBe(true);
      expect(manager.hasActiveDraft()).toBe(false);

      const shelf = manager.getSuspendedDrafts();
      expect(shelf).toHaveLength(1);
      expect(shelf[0].id).toBe("draft-polygon-1");
      expect(shelf[0].isSuspended).toBe(true);
    });

    it("handles interruption with continue_editing: leaves active draft intact", () => {
      manager.startDraft({
        id: "draft-path-1",
        toolType: "pathway",
        label: "Pathway Draft",
        provisionalGeometry: { startNodeId: "node-1" },
      });

      const result = manager.handleInterruption("continue_editing");
      expect(result.actionTaken).toBe("continue_editing");
      expect(manager.hasActiveDraft()).toBe(true);
      expect(manager.getActiveDraft()?.id).toBe("draft-path-1");
      expect(manager.getSuspendedDrafts()).toHaveLength(0);
    });

    it("handles interruption with discard_geometry: cleans up without leaving orphan records", () => {
      manager.startDraft({
        id: "draft-point-1",
        toolType: "point",
        label: "Outdoor Pin",
        provisionalGeometry: { points: [{ lat: 16.74, lng: 121.55, x: 100, y: 100 }] },
        nestedRecords: { tempName: "Orphaned Loc" },
      });

      const result = manager.handleInterruption("discard_geometry");
      expect(result.actionTaken).toBe("discard_geometry");
      expect(manager.hasActiveDraft()).toBe(false);
      expect(manager.getSuspendedDrafts()).toHaveLength(0);
      expect(manager.getPastOperations()).toHaveLength(0);
    });

    it("transitions directly to pendingDraft on keep_draft or discard_geometry", () => {
      manager.startDraft({
        id: "draft-1",
        toolType: "point",
        provisionalGeometry: {},
      });

      const nextDraft: ActiveToolDraft = {
        id: "draft-2",
        toolType: "polygon",
        isSuspended: false,
        provisionalGeometry: {},
      };

      const result = manager.handleInterruption("keep_draft", nextDraft);
      expect(result.activeDraft?.id).toBe("draft-2");
      expect(manager.getSuspendedDrafts()).toHaveLength(1);
      expect(manager.getSuspendedDrafts()[0].id).toBe("draft-1");
    });
  });

  describe("Suspended Drafts Shelf", () => {
    it("adds, removes, lists, and resumes suspended drafts", () => {
      const draftA: ActiveToolDraft = {
        id: "shelf-a",
        toolType: "polygon",
        isSuspended: false,
        provisionalGeometry: { points: [{ x: 1, y: 1 }] },
      };
      const draftB: ActiveToolDraft = {
        id: "shelf-b",
        toolType: "pathway",
        isSuspended: false,
        provisionalGeometry: { startNodeId: "n1" },
      };

      manager.addSuspendedDraft(draftA);
      manager.addSuspendedDraft(draftB);

      expect(manager.getSuspendedDrafts()).toHaveLength(2);
      expect(manager.getSuspendedDrafts()[0].isSuspended).toBe(true);

      // Resume draft A
      const resumed = manager.resumeSuspendedDraft("shelf-a");
      expect(resumed?.id).toBe("shelf-a");
      expect(resumed?.isSuspended).toBe(false);
      expect(manager.getActiveDraft()?.id).toBe("shelf-a");
      expect(manager.getSuspendedDrafts()).toHaveLength(1);
      expect(manager.getSuspendedDrafts()[0].id).toBe("shelf-b");

      // Remove draft B
      const removed = manager.removeSuspendedDraft("shelf-b");
      expect(removed).toBe(true);
      expect(manager.getSuspendedDrafts()).toHaveLength(0);

      // Attempting to remove non-existent returns false
      expect(manager.removeSuspendedDraft("non-existent")).toBe(false);
      expect(manager.resumeSuspendedDraft("non-existent")).toBeNull();
    });

    it("clears all suspended drafts", () => {
      manager.addSuspendedDraft({
        id: "d1",
        toolType: "polygon",
        isSuspended: true,
        provisionalGeometry: {},
      });
      manager.clearSuspendedDrafts();
      expect(manager.getSuspendedDrafts()).toHaveLength(0);
    });
  });

  describe("Dirtiness Tracking & Checkpoints", () => {
    it("tracks dirtiness accurately across operations, undos, and redos", () => {
      expect(manager.isDirty).toBe(false);
      expect(manager.getUncommittedCount()).toBe(0);

      manager.executeOperation(createEntityOperation("Locations", "l1", { name: "L1" }));
      expect(manager.isDirty).toBe(true);
      expect(manager.getUncommittedCount()).toBe(1);

      manager.executeOperation(createEntityOperation("Locations", "l2", { name: "L2" }));
      expect(manager.isDirty).toBe(true);
      expect(manager.getUncommittedCount()).toBe(2);

      // Undo back to start -> state is clean again!
      manager.undo();
      expect(manager.isDirty).toBe(true);
      expect(manager.getUncommittedCount()).toBe(1);

      manager.undo();
      expect(manager.isDirty).toBe(false);
      expect(manager.getUncommittedCount()).toBe(0);

      // Redo -> dirty again
      manager.redo();
      expect(manager.isDirty).toBe(true);
      expect(manager.getUncommittedCount()).toBe(1);

      // Mark saved / clean
      manager.markSaved();
      expect(manager.isDirty).toBe(false);
      expect(manager.getUncommittedCount()).toBe(0);
      expect(manager.getUncommittedOperations()).toHaveLength(0);

      // Add another op -> uncommitted count is 1 relative to checkpoint
      manager.executeOperation(createEntityOperation("Locations", "l3", { name: "L3" }));
      expect(manager.isDirty).toBe(true);
      expect(manager.getUncommittedCount()).toBe(1);
      expect(manager.getUncommittedOperations()).toHaveLength(1);
      expect(manager.getUncommittedOperations()[0].entityId).toBe("l3");
    });

    it("resets all state cleanly", () => {
      manager.executeOperation(createEntityOperation("Locations", "l1", { name: "L1" }));
      manager.startDraft({ toolType: "point", provisionalGeometry: {} });
      manager.addSuspendedDraft({ id: "s1", toolType: "polygon", isSuspended: true, provisionalGeometry: {} });

      manager.reset();
      expect(manager.getPastOperations()).toHaveLength(0);
      expect(manager.getFutureOperations()).toHaveLength(0);
      expect(manager.getActiveDraft()).toBeNull();
      expect(manager.getSuspendedDrafts()).toHaveLength(0);
      expect(manager.isDirty).toBe(false);
    });
  });

  describe("Subscriptions", () => {
    it("notifies listeners on mutations and unsubscribes properly", () => {
      const listener = vi.fn();
      const unsubscribe = manager.subscribe(listener);

      manager.executeOperation(createEntityOperation("Locations", "l1", { name: "L1" }));
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].pastOperations).toHaveLength(1);

      manager.undo();
      expect(listener).toHaveBeenCalledTimes(2);

      unsubscribe();
      manager.redo();
      expect(listener).toHaveBeenCalledTimes(2);
    });
  });

  describe("Keyboard Shortcuts Handler", () => {
    it("handles Ctrl+Z and Cmd+Z for undo", () => {
      manager.executeOperation(createEntityOperation("Locations", "l1", { name: "L1" }));

      const preventDefault = vi.fn();
      const onUndo = vi.fn();

      const event = {
        key: "z",
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        target: document.createElement("div"),
        preventDefault,
      } as unknown as KeyboardEvent;

      const handled = handleWorkingSessionKeyboardShortcut(event, manager, { onUndo });
      expect(handled).toBe(true);
      expect(preventDefault).toHaveBeenCalled();
      expect(onUndo).toHaveBeenCalledTimes(1);
      expect(manager.getPastOperations()).toHaveLength(0);
      expect(manager.getFutureOperations()).toHaveLength(1);
    });

    it("handles Ctrl+Shift+Z and Cmd+Shift+Z for redo", () => {
      manager.executeOperation(createEntityOperation("Locations", "l1", { name: "L1" }));
      manager.undo();

      const preventDefault = vi.fn();
      const onRedo = vi.fn();

      const event = {
        key: "z",
        ctrlKey: false,
        metaKey: true,
        shiftKey: true,
        altKey: false,
        target: document.createElement("div"),
        preventDefault,
      } as unknown as KeyboardEvent;

      const handled = handleWorkingSessionKeyboardShortcut(event, manager, { onRedo });
      expect(handled).toBe(true);
      expect(preventDefault).toHaveBeenCalled();
      expect(onRedo).toHaveBeenCalledTimes(1);
      expect(manager.getPastOperations()).toHaveLength(1);
    });

    it("handles Ctrl+Y for redo", () => {
      manager.executeOperation(createEntityOperation("Locations", "l1", { name: "L1" }));
      manager.undo();

      const preventDefault = vi.fn();

      const event = {
        key: "y",
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        target: document.createElement("div"),
        preventDefault,
      } as unknown as KeyboardEvent;

      const handled = handleWorkingSessionKeyboardShortcut(event, manager);
      expect(handled).toBe(true);
      expect(preventDefault).toHaveBeenCalled();
      expect(manager.getPastOperations()).toHaveLength(1);
    });

    it("ignores shortcuts when typing in inputs or textareas unless explicitly allowed", () => {
      manager.executeOperation(createEntityOperation("Locations", "l1", { name: "L1" }));

      const input = document.createElement("input");
      const event = {
        key: "z",
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        target: input,
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent;

      const handled = handleWorkingSessionKeyboardShortcut(event, manager);
      expect(handled).toBe(false);
      expect(manager.getPastOperations()).toHaveLength(1);
    });

    it("ignores shortcuts when blocked by isBlocked option", () => {
      manager.executeOperation(createEntityOperation("Locations", "l1", { name: "L1" }));

      const event = {
        key: "z",
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        target: document.createElement("div"),
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent;

      const handled = handleWorkingSessionKeyboardShortcut(event, manager, {
        isBlocked: () => true,
      });
      expect(handled).toBe(false);
      expect(manager.getPastOperations()).toHaveLength(1);
    });
  });
});
