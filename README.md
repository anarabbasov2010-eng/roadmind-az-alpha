# RoadMind AZ Alpha

A Windows-first research prototype for exploring Baku's road network, editing scenario-only infrastructure, and comparing synthetic traffic simulations.

## Product boundary

- Live vector basemap: OpenFreeMap, based on OpenStreetMap data. The public planet tiles are updated by the provider on a weekly cadence; freshness is therefore not real-time.
- On-demand road and mapped-traffic-signal query: OpenStreetMap through a public Overpass API endpoint, limited to a small area around the visible map. Requests are cached/rate-limited in the app.
- User-added traffic lights and roads are scenario edits stored locally; they do not alter OpenStreetMap or official infrastructure.
- Vehicles and metrics in this Alpha are synthetic. They are a demonstrator, not an official traffic feed or an engineering-grade prediction.

## Run on Windows

Install Node.js 22 or later, then run `npm install`, `npm run dev`, or `npm run desktop:dev`.

To build the installer, run `npm run dist:win`. The installer is generated in the release folder. GitHub Actions builds a Windows installer on pushes to main and uploads it as an artifact.

## Tech stack

React, TypeScript, MapLibre GL JS, OpenFreeMap, OpenStreetMap/Overpass, Electron and GitHub Actions.

## Data and licensing

Map data © OpenStreetMap contributors (ODbL). Vector tiles hosted by OpenFreeMap. OpenFreeMap and Overpass are community services; availability, coverage, and freshness are not guaranteed. The app displays attribution and must not be used as the sole basis for real-world traffic engineering decisions.

See docs/DATA_AND_LIMITS.md and docs/ROADMAP.md.