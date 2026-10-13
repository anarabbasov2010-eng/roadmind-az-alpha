# Roadmap

## Alpha 0.2 — current milestone
- Windows desktop shell and app icon.
- Online 3D basemap with smooth, bounded zoom and 2D/3D camera.
- Baku-centered view and navigation to the wider territory of Azerbaijan.
- On-demand OpenStreetMap import for roads and mapped traffic-signal nodes.
- Scenario-only traffic-light/road editor, local save and JSON export.
- Explicit labeling for synthetic traffic.

## Next: data quality
1. Select a small cluster of Baku junctions and audit geometry against imagery and field observations.
2. Convert road lines into a connected directed graph with lane-level attributes and legal turns.
3. Add junction connectors, pedestrian crossings, stop lines, turn restrictions and speed limits.
4. Represent signal programs as phases and controlled movements, not just points.
5. Import repeatable vehicle counts and turning ratios from lawful, documented sources.
6. Calibrate on one observation window and validate against a held-out period.

## Later: simulation and scale
- Integrate a dedicated microscopic traffic engine (SUMO is a candidate).
- Add scenario branching, before/after comparison, uncertainty intervals and reproducible runs.
- Build a managed regional data pipeline or use documented feeds before offering nationwide refresh.
- Expand detailed coverage beyond Baku only after the local network passes validation.

## Definition of done for a research-grade intersection
- Every modeled lane and movement is checked against trustworthy source data.
- Signal phases and offsets are supported by evidence, not guessed.
- At least one calibration and one independent validation period are documented.
- Travel-time, queue-length and throughput errors are reported.
- Every live value has a source and observation timestamp.