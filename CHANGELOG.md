# Changelog

## 0.3.0 — unreleased

- Hide the schematic demonstration route by default.
- Add a multi-point custom road editor with a cursor-following preview line, visible vertices, configurable lane count, and forward/reverse/bidirectional travel.
- Add collapsible tool and scenario sidebars.
- Add a selectable Esri satellite imagery layer placed beneath vector road overlays. Imagery capture dates and resolution vary by location and provider; it is not guaranteed to be 2026 or native 4K.
- Add an in-app desktop update notice with download progress and restart/install actions.
- Configure GitHub Releases publishing for tagged Windows builds.
- Guard junction connectors against simultaneous occupancy by multiple vehicles and add a high-volume simulation stress test.

### Release and data limitations

- OTA updates are not considered verified until a Windows installer release and `latest.yml` are published and an installed prior version successfully updates.
- OpenStreetMap traffic signals, speed cameras, crossings, and lane tags are incomplete where the source data is missing. This release does not claim complete radar coverage for Baku.
- Satellite imagery depends on the provider's availability, licensing, capture dates, and zoom level.
- The simulator is a research prototype, not certified transport-engineering software. Collision and driver-behavior validation still requires broader scenarios and comparison with observed traffic.
