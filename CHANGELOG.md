# Changelog

All notable RoadMind AZ changes are documented here. The project follows semantic versioning: MAJOR.MINOR.PATCH.

## [0.3.0] - 2026-10-14
### Added
- GitHub Releases-based desktop update pipeline configuration.
- Update checks on packaged-app startup, explicit download, progress reporting, and restart-to-install flow.
- Secure renderer bridge for update actions; renderer does not receive direct Node.js access.
- Author metadata: 242NM.
- Road-construction animation, custom multi-lane markings, imported crossing markings, curved-road vehicle tracking, connected route seeding, and safer lane-change gap checks.

### Changed
- Windows installer uses stable application identity and NSIS install mode intended to upgrade the existing installation.
- Desktop release build uses the GitHub Releases provider.

### Important
- Automatic updates only work after a published GitHub Release contains the installer and electron-builder update metadata (including latest.yml). A CI artifact alone is not a published release.
- The first installation must use the same app identity and a compatible installation path. Back up important scenario data before major updates.
- The 3D road surface, sidewalks and curbs are still not a surveyed, physically exact road mesh; map-rendered bands are an interim representation.
- Traffic simulation is not certified transport-engineering software. 120 FPS depends on hardware and scene load.
