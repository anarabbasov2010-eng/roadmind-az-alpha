import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoadNetwork, distanceMeters } from '../src/road-graph.ts';

const road = (id, coordinates, nodeRefs, tags = {}) => ({
  id, name: 'Road ' + id, highway: 'primary', coordinates, nodeRefs, ...tags
});

test('shared OSM node references produce a connected four-arm intersection', () => {
  const roads = [
    road(1, [[49.0, 40.0], [49.001, 40.0]], [10, 11]),
    road(2, [[49.001, 40.0], [49.002, 40.0]], [11, 12]),
    road(3, [[49.001, 39.999], [49.001, 40.0]], [13, 11]),
    road(4, [[49.001, 40.0], [49.001, 40.001]], [11, 14])
  ];
  const graph = buildRoadNetwork(roads);
  const junction = graph.nodes.find((node) => node.id === 'n11');
  assert.ok(junction);
  assert.equal(junction.degree, 4);
  assert.equal(junction.intersection, true);
  assert.equal(graph.stats.connectedComponents, 1);
  assert.equal(graph.stats.intersections, 1);
});

test('one-way road creates only forward directed edges', () => {
  const graph = buildRoadNetwork([
    road(9, [[49.0, 40.0], [49.001, 40.0], [49.002, 40.0]], [1, 2, 3], { oneway: 'yes', lanes: '2' })
  ]);
  assert.equal(graph.edges.length, 2);
  assert.ok(graph.edges.every((edge) => edge.direction === 1));
  assert.equal(graph.stats.laneCount, 2);
});

test('two-way road creates both directions and separate lane geometries', () => {
  const graph = buildRoadNetwork([
    road(12, [[49.0, 40.0], [49.001, 40.0]], [21, 22], { lanes: '4' })
  ]);
  assert.equal(graph.edges.length, 2);
  assert.deepEqual(graph.edges.map((edge) => edge.direction).sort(), [-1, 1]);
  assert.equal(graph.stats.laneCount, 4);
  assert.ok(graph.laneLines.every((lane) => lane.geometry.length === 2));
});

test('lengths are metric and finite', () => {
  const distance = distanceMeters([49, 40], [49.001, 40]);
  assert.ok(distance > 80 && distance < 100);
});

test('opposing carriageways are offset to separate sides of a bidirectional road', () => {
  const graph = buildRoadNetwork([
    road(41, [[49.0, 40.0], [49.002, 40.0]], [401, 402], { lanes: '4' })
  ]);
  assert.equal(graph.laneLines.length, 4);
  const forward = graph.laneLines.filter((lane) => lane.direction === 1);
  const reverse = graph.laneLines.filter((lane) => lane.direction === -1);
  const averageLat = (lane) => lane.geometry.reduce((sum, point) => sum + point[1], 0) / lane.geometry.length;
  assert.ok(forward.every((lane) => averageLat(lane) < 40));
  assert.ok(reverse.every((lane) => averageLat(lane) > 40));
});

test('directional OSM lane counts override a generic total', () => {
  const graph = buildRoadNetwork([
    road(42, [[49.0, 40.0], [49.001, 40.0]], [411, 412], { lanesForward: '3', lanesBackward: '1' })
  ]);
  const forward = graph.edges.filter((edge) => edge.roadId === 42 && edge.direction === 1);
  const reverse = graph.edges.filter((edge) => edge.roadId === 42 && edge.direction === -1);
  assert.ok(forward.every((edge) => edge.lanes === 3));
  assert.ok(reverse.every((edge) => edge.lanes === 1));
  assert.equal(graph.stats.laneCount, 4);
});
