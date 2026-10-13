# Map data, simulation provenance and limits

## Online data
- The basemap and 3D building vector tiles are loaded from OpenFreeMap. Tile freshness is controlled by the provider and does not prove every feature was recently surveyed.
- Road geometry, OSM node references, mapped signal nodes, directional lane tags and simple via-node turn restrictions are queried from the current OpenStreetMap database through Overpass for a small area around the visible map.
- OSM coverage is contributor-maintained. Missing tags are unknown data, not evidence that a road has no lanes, turn restrictions or signals.
- Public Overpass servers are shared infrastructure. The app throttles requests and limits the query area; it is not a nationwide data crawler.

## What the simulator now does
- Builds directed segment edges from OSM ways, separates opposing carriageways using directional lane counts where available, and derives per-lane centerlines.
- Creates lane-to-lane connector curves at graph junctions, infers geometric conflicts, and schedules non-conflicting movement groups in generated fixed-time phases at mapped signal nodes.
- Moves vehicles on imported street edges with acceleration/braking bounds, speed caps, lane occupancy, time-headway following and signal approach stopping.
- Allows users to export an editable signal-plan JSON template and import plans after schema, duration, movement coverage and geometric conflict validation.
- Allows CSV import of observed speed, hourly flow and queue length to adjust a first-pass set of model parameters.

## What is not live or verified
- No live municipal signal-controller connection exists. OSM signal nodes do not provide current lamp colour, phase, cycle offset or approved timing programmes. Automatically generated phases are fallback assumptions, not actual Baku signal timings. Use only verified field/controller plans for a real scenario.
- No live traffic feed exists. Demand, routes and vehicle behavior are synthetic even though vehicles move on imported street geometry. No connection exists to cameras, induction loops, navigation-provider telemetry or official traffic feeds.
- Complex via-way turn restrictions, complete lane-change behavior, pedestrian/cyclist interactions, public-transport priority, calibrated driver heterogeneity, measured origin-destination demand and grade-separated topology validation are not complete.
- The editor's user-drawn road drafts are not automatically inserted into the imported simulation graph.
- Calibration currently applies a first-pass aggregate parameter fit; it does not prove the model is accurate. It must be followed by independent validation on held-out observation windows.

## Safety boundary
This research prototype is not a certified transport engineering tool. Do not use it as the sole basis for road design, signal timing, emergency response or public-safety decisions. Research-grade use requires audited lane topology, complete legal movements, authoritative signal timing, representative measured demand, calibration, independent validation, uncertainty reporting and documented source timestamps.

## Attribution
Map data © OpenStreetMap contributors, licensed under the Open Database License (ODbL). OpenFreeMap hosts vector tiles. Keep attribution visible in any fork or distribution and review provider terms before production deployment.
