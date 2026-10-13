# Roadmap

## Alpha 0.3 — lane-level simulation foundation
- Windows desktop shell, light engineering UI, adjustable 2D/3D camera.
- OSM road graph with directed segments, lane offsets, turn-lane tags and simple via-node restrictions.
- Lane-specific connector curves and geometric conflict analysis.
- Microscopic vehicle movement with acceleration, braking, following distance and signal-controlled stopping.
- Fixed-time phase templates, import/export validation for authoritative signal plans.
- CSV ingestion for observed speeds, flows and queues; first-pass aggregate parameter fitting.
- Automated tests for graph topology, connectors, phase safety, dynamics and calibration parsing.

## Next: close the engineering data gap
1. Audit a small Baku intersection cluster against imagery, official drawings and field observations.
2. Add via-way turn restrictions, explicit lane-change edges, stop lines, crosswalks and grade-separated crossing handling.
3. Import verified signal controller schedules, offsets, phase sequence and pedestrian phases from authoritative files.
4. Add vehicle class mix, stochastic driver behavior, lane-changing models and route demand matrices.
5. Run a reproducible calibration search against multiple observation windows, then validate against held-out data.
6. Report error metrics for speed, queue length, travel time and throughput with confidence intervals.
7. Connect editor-created roads to the network only after node snapping, intersection repair and topology validation are implemented.

## Scale and deployment
- Consider a mature microscopic simulator integration such as SUMO for larger networks and more established car-following/lane-changing models.
- Move OSM import into a cache-aware data pipeline instead of repeated direct queries to public Overpass.
- Add scenario branching, deterministic seeds, run metadata, exports and before/after comparisons with uncertainty intervals.
- Expand beyond the imported local map area only after data quality and performance are measured.

## Definition of done for a research-grade intersection
- Every lane and legal movement is checked against authoritative source data.
- Conflicting movements are never given overlapping right-of-way in the same phase.
- Signal phases and offsets come from documented evidence rather than guessed defaults.
- Calibration and independent validation windows are recorded.
- Errors for travel time, queue length, speed and throughput are reported against field measurements.
- Each imported or measured value has a source and timestamp.
