# RoadMind AZ Alpha

**A Windows-first digital-twin lab for exploring road infrastructure scenarios in Baku.**

RoadMind is being built toward one long-term goal: a geographically complete digital copy of Azerbaijan's transport network, where engineers can edit a proposed road layout, run traffic scenarios, and compare measured outcomes before physical changes are made. Alpha starts with an online basemap and a limited, transparent demonstration of the proposed workflow.

## What is in the current Alpha

- Desktop workspace built with React, TypeScript, MapLibre GL JS and Electron.
- Online light OpenFreeMap basemap, smooth zoom, 2D/3D tilt, adjustable camera pitch/bearing and a Baku/country navigation preset.
- Available 3D building geometry from OpenFreeMap vector tiles.
- On-demand OpenStreetMap import for road geometry, mapped traffic-signal nodes, OSM node references, speed/one-way/lane tags and road attributes in the current map area.
- Directed road graph built from shared OSM node IDs, one-way direction, directional lane counts, nominal 3.25 m lane-center geometry, junction connectivity, node-based OSM turn restrictions and `turn:lanes` tags when mapped. Unmapped lane data is estimated, not surveyed.
- Lane-level microscopic vehicle engine with acceleration/braking limits, time-headway following, per-lane vehicle spacing, explicit curved lane-to-lane turn connectors, conflict-graph checks, and fixed-time signal phase groups at mapped signal nodes.
- Editable signal-program JSON export/import with phase-duration validation, movement coverage checks and geometric-conflict rejection. Import approved timings from an authoritative controller plan; the automatically generated default phases are only fallback assumptions.
- CSV calibration import for measured speed, hourly flow and queue length. The current calibration is a first-pass parameter fit, not independent validation of the simulator.
- Scenario editor for traffic lights and road segments. Road endpoints snap to nearby graph nodes and connected draft roads are inserted into the active simulation graph; imported OSM geometry remains read-only.
- Vehicles run on imported directed street edges and turn connectors when a usable OSM graph is available. The legacy schematic route remains only as a fallback when the imported graph cannot initialize.
- Reproducible baseline-versus-scenario demo comparison, clear provenance labels, tests and a Windows installer workflow.
- Branded SVG logo and app icon generation, including an installer with desktop and Start Menu shortcuts.

## Run locally on Windows

Install Node.js 22 or later, then open a terminal in this repository:

~~~powershell
npm install
npm test
npm run dev
~~~

To launch the desktop wrapper during development:

~~~powershell
npm run desktop:dev
~~~

To build a Windows installer:

~~~powershell
npm run dist:win
~~~

The installer is produced under release/. GitHub Actions also runs tests and builds a Windows installer artifact after pushes to main and via Actions → Build Windows installer → Run workflow. Download the artifact from the workflow run after it completes.

## Data freshness and accuracy

- **Basemap:** OpenFreeMap vector tiles are fetched online. The provider's planet tile set is documented as updated weekly; the /planet/latest TileJSON alias follows the latest deployed tile set. This does not guarantee that every building or road was surveyed or updated in 2026. See [OpenFreeMap](https://github.com/hyperknot/openfreemap).
- **Detailed OSM overlay:** roads and objects tagged highway=traffic_signals are requested for a small visible area from the current OpenStreetMap database through a public Overpass endpoint. The app throttles requests and offers manual refresh. These objects exist only when OSM contributors have mapped them. Shared Overpass services can be rate-limited or temporarily unavailable. See [Overpass API guidance](https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances).
- **No live traffic feed:** the microscopic model runs on imported road geometry, but traffic demand and vehicle behavior are simulated. The app is not connected to municipal signal controllers, navigation-provider telemetry, traffic cameras, induction loops or official live traffic feeds.
- **Signal programme provenance:** OSM identifies mapped signal locations and turn restrictions, not actual lamp states, controller phases, offsets or approved timings. Default phases are generated from geometric conflicts. Use the signal-plan export/import control to load verified timing plans; imported plans must cover all modeled movements and may not green-light a detected conflict pair.
- **Not yet certified for engineering decisions:** the imported graph and lane connectors depend on OSM coverage. Via-way turn restrictions, complex roundabout lane selection, lane changes, pedestrians, cyclists, public transport priority, realistic car-following distributions and validated demand matrices are not fully modeled. Road drafts are inserted into the graph when their endpoints snap to existing nodes; an unsnapped endpoint remains disconnected until it is attached to the network. Calibration needs representative field measurements and independent validation before the model can be used for design or safety decisions.

The product interface marks these limitations deliberately. Do not use Alpha metrics as engineering recommendations or for public-safety decisions. A road-engineering claim needs complete, checked lane topology, lawful measured traffic observations, documented signal programmes, model calibration and independent validation.

## Attribution

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), licensed under the Open Database License (ODbL). Online vector tiles are hosted by [OpenFreeMap](https://openfreemap.org/). Keep attribution and review current provider terms when redistributing.

## Road graph notes

- Shared OSM way-node IDs are used as topological identity where supplied; coordinate quantization is a fallback for incomplete geometry responses.
- Each OSM way is split into directed segment edges. `oneway`, `lanes`, `lanes:forward`, `lanes:backward`, `maxspeed`, `turn:lanes:forward` and `turn:lanes:backward` affect direction, lane counts, speed caps and legal lane-turn candidates.
- Each junction gets lane-to-lane connector curves. A geometric conflict graph assigns mutually conflicting movements to separate fixed-time phases at mapped signal nodes; un-signalized junctions use conservative movement reservations.
- Lane-center overlays and vehicle trajectories use directional carriageway offsets and a nominal 3.25 m lane width. Missing or inconsistent OSM tags remain approximate. Signal-plan timing must come from an authoritative field source.

## Development roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md) and [docs/DATA_AND_LIMITS.md](docs/DATA_AND_LIMITS.md).