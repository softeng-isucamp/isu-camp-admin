# Store indoor locations as independent map points

An indoor location may have an optional coordinate inside its parent building's footprint, stored independently from the building's map position. This keeps a room's point from being confused with the building anchor and allows the editor to verify that a marker belongs within its building; indoor markers are only displayed at close zoom levels to keep the campus overview clear.
