# Convert a Path Point to a Route Node

In the live Map Editor, an administrator can select a saved interior Path Point and choose **Convert to Route Node**. Pending edits to its parent Pathway must first be persisted with **Update Pathway**. There is no separate global save step for this operation.

The conversion form shows the selected point's fixed coordinates. A new Route Node defaults to Junction with a suggested editable name. Entrance, Junction, and Access Point are available; Entrance requires a Building association. If an active Route Node already exists at that point, the form shows it and reuses it without creating another node.

The form previews two replacement Pathways, one on each side of the node. Both inherit and display the original's name, way type, direction, allowed travel modes, shade, and status as editable defaults. Each replacement can have different metadata. Distance and time are calculated from the segment geometry.

The form's **Save Route Node and Pathways** action creates the Route Node when needed, creates both replacement Pathways, and closes the original Pathway in one backend transaction. A failed save leaves the original Pathway active and creates no partial network split. Conversion of an already closed Pathway is unavailable.
