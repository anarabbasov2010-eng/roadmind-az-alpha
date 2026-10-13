# Map data and limits

## What is online
- The basemap and 3D building vector tiles are loaded from OpenFreeMap over the network.
- OpenFreeMap documents the public planet tile set as automatically updated weekly. Online tiles are not proof that every feature was updated today.
- Road geometry and mapped traffic-signal nodes can be queried from the current OpenStreetMap database through Overpass for a small area around the visible map.
- OSM only contains objects mapped by contributors. Missing traffic-signal nodes, lane counts, turn restrictions, lane connections and signal programs must never be assumed absent or correct.
- Public Overpass servers are shared infrastructure. The app limits query area, avoids frequent repeats and allows manual refresh. Do not use it to download all of Azerbaijan repeatedly.

## What is not live traffic
Moving vehicles and metrics in this Alpha are synthetic demo agents. They are not connected to municipal sensors, navigation-service feeds, cameras or live vehicle telemetry. OSM traffic-signal nodes are reference points; OSM does not provide current signal phase timing and imported markers do not control the simulation.

## Safety boundary
This research prototype stores road-editor changes in a local scenario. It does not publish changes to OSM or municipal systems. Never use it as the sole basis for road design, signal timing, emergency response or public-safety decisions. A serious engineering model must be calibrated and validated using measured traffic data, lane-level network connectivity, turn movements, signal timings and independent observations.

## Attribution
Map data © OpenStreetMap contributors, licensed under the Open Database License (ODbL). OpenFreeMap hosts the vector tiles. Keep provider attribution visible in any fork or distribution. Review provider terms before production deployment.