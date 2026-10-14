# Changelog

## 0.3.0 — unreleased

- Hide the schematic demonstration route by default to avoid the oversized loop dominating the map.
- Add collapsible tool and scenario sidebars.
- Add an in-app desktop update notice with download progress and restart/install actions.
- Configure GitHub Releases publishing for tagged Windows builds.

### Known limitations

- OTA updates are not considered verified until a Windows installer release and `latest.yml` are published and an installed prior version successfully updates.
- OSM traffic signals, speed cameras and other road equipment are incomplete where the source data is missing.
- Satellite imagery depends on a licensed tile provider and is not bundled or guaranteed at 4K.
- Custom road editing and vehicle physics remain under active development; this is not certified traffic-engineering software.
