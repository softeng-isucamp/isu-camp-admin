# 05: Complete type-aware actions and Building map handoff

**What to build:** Make every Locations action lead somewhere valid for its Campus Location kind. Buildings, Indoor Locations, and standalone outdoor Facilities must receive relevant row and post-save actions, and Indoor Locations must use their Building as the outdoor map destination rather than pretending to have independent coordinates.

**Blocked by:** 02: Complete Indoor Location add, edit, and contextual quick-add.

**Status:** done

- [ ] Building rows offer relevant editing, contextual Indoor Location creation, map, history, and deletion actions.
- [ ] Indoor Location rows offer relevant editing, parent-Building map, history, and deletion actions without independent position calibration.
- [ ] Standalone outdoor Facility rows offer relevant editing, map calibration, history, and deletion actions.
- [ ] Derived Floor Level grouping rows expose no record actions.
- [ ] An Indoor Location map action navigates to and selects its Building context.
- [ ] A successful Indoor Location save offers a parent-Building map action and communicates its Floor Level context.
- [ ] A successful Building or outdoor Facility save offers applicable placement or position-editing actions.
- [ ] Missing or incompatible parent data produces a clear recovery message rather than navigating to an invalid map target.
- [ ] Contextual Add Indoor Location actions close their source menu and open the correct locked-Building flow.
- [ ] Existing Map Editor work on the feature branch remains intact and unrelated draft behavior is not rewritten.
- [ ] Rendered-page and relevant Map Editor tests assert action labels, navigation targets, and visible outcomes rather than router or component internals.
