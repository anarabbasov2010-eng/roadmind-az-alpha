# RoadMind AZ Alpha

**A Windows-first digital-twin lab for exploring road infrastructure scenarios in Baku.**

RoadMind is being built toward one long-term goal: a geographically complete digital copy of Azerbaijan's transport network, where engineers can edit a proposed road layout, run traffic scenarios, and compare measured outcomes before physical changes are made. Alpha starts with an online basemap and a limited, transparent demonstration of the proposed workflow.

## What is in the current Alpha

- Desktop workspace built with React, TypeScript, MapLibre GL JS and Electron.
- Online dark basemap based on OpenStreetMap, smooth zoom around the center, bounded camera, 2D/3D tilt and a Baku/Country navigation preset.
- Available 3D building geometry from OpenFreeMap vector tiles.
- On-demand OpenStreetMap import for road geometry, mapped traffic-signal nodes, OSM node references, speed/one-way/lane tags and road attributes in the current map area.
- Directed road-segment graph built from shared OSM node IDs, junction-degree detection, connected-component counts, and per-lane geometry overlays. Lane counts use OSM tags where available and documented class defaults otherwise; defaults are estimates, not survey measurements.
- Scenario-only editor to place traffic lights and draw draft road segments; imported OSM reference geometry is read-only.
- A small synthetic demo route with virtual vehicles, configurable demo signal cycles, model-speed setting, local scenario save and JSON export.
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
- **No live traffic feed:** moving vehicles and traffic performance metrics are synthetic. The app is not connected to municipal signal controllers, navigation-provider telemetry, traffic cameras, induction loops or official live traffic feeds.
- **No signal timing feed:** mapped OSM traffic-signal points do not include the current signal colour, live phase, offsets or approved traffic-signal programmes.
- **No production-grade network yet:** imported OSM road lines are not a fully connected lane-by-lane graph. User-created road lines are design drafts and are not automatically connected to the simulation. Only the explicitly labeled schematic route drives the current demonstration cars.

The product interface marks these limitations deliberately. Do not use Alpha metrics as engineering recommendations or for public-safety decisions. A road-engineering claim needs complete, checked lane topology, lawful measured traffic observations, documented signal programmes, model calibration and independent validation.

## Attribution

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), licensed under the Open Database License (ODbL). Online vector tiles are hosted by [OpenFreeMap](https://openfreemap.org/). Keep attribution and review current provider terms when redistributing.

## Road graph notes

- Shared OSM way-node IDs are used as topological identity where supplied; coordinate quantization is a fallback for incomplete geometry responses.
- Each road geometry is split into directed segment edges. `oneway`, `lanes`, and `maxspeed` tags affect edge direction, lane counts and default speeds.
- Intersection markers identify nodes with at least three unique neighbouring nodes. Complex junctions still require explicit turn connectors and lane-level conflict modelling.
- Lane-center overlays are derived from lane counts and nominal 3.25 m lane width. Roads with absent or inconsistent OSM lane metadata remain approximate.

## Development roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md) and [docs/DATA_AND_LIMITS.md](docs/DATA_AND_LIMITS.md).