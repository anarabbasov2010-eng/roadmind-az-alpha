import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClosedSimulationRoute, buildRoadNetwork, routeLengthMeters } from '../src/road-graph.ts';

test('directed street cycle produces a closed simulation route', () => {
  const roads = [
    { id: 31, name: 'A', highway: 'primary', oneway: 'yes', coordinates: [[49, 40], [49.002, 40]], nodeRefs: [301, 302] },
    { id: 32, name: 'B', highway: 'primary', oneway: 'yes', coordinates: [[49.002, 40], [49.002, 40.002]], nodeRefs: [302, 303] },
    { id: 33, name: 'C', highway: 'primary', oneway: 'yes', coordinates: [[49.002, 40.002], [49, 40.002]], nodeRefs: [303, 304] },
    { id: 34, name: 'D', highway: 'primary', oneway: 'yes', coordinates: [[49, 40.002], [49, 40]], nodeRefs: [304, 301] }
  ];
  const route = buildClosedSimulationRoute(buildRoadNetwork(roads));
  assert.ok(route);
  assert.ok(route.length >= 5);
  assert.ok(routeLengthMeters(route) > 500);
  const first = route[0], last = route[route.length - 1];
  assert.ok(Math.abs(first[0] - last[0]) < 0.00001);
  assert.ok(Math.abs(first[1] - last[1]) < 0.00001);
});
