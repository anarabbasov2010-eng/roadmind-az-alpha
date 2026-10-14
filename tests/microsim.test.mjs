import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoadNetwork } from '../src/road-graph.ts';
import {
  buildMicroNetwork, createMicroState, stepMicroSimulation, signalStateAt, DEFAULT_MICRO_CONFIG,
  parseCalibrationCsv, calibrateMicroConfig, vehiclePosition
} from '../src/microsim.ts';

const road = (id, coordinates, nodeRefs, tags = {}) => ({
  id, name: 'Road ' + id, highway: 'primary', coordinates, nodeRefs, lanes: '2', ...tags
});
function squareNetwork() {
  return buildRoadNetwork([
    road(31, [[49, 40], [49.002, 40]], [301, 302], { oneway: 'yes' }),
    road(32, [[49.002, 40], [49.002, 40.002]], [302, 303], { oneway: 'yes' }),
    road(33, [[49.002, 40.002], [49, 40.002]], [303, 304], { oneway: 'yes' }),
    road(34, [[49, 40.002], [49, 40]], [304, 301], { oneway: 'yes' }),
    road(35, [[49.001, 39.999], [49.001, 40.003]], [305, 302, 306], { oneway: 'yes' })
  ]);
}

test('microscopic graph builds lane-level movements and safe phase plans', () => {
  const micro = buildMicroNetwork(squareNetwork());
  assert.ok(micro.movements.length > 0);
  assert.ok(micro.stats.controlledJunctions > 0);
  assert.ok(micro.stats.laneConnections > 0);
  for (const controller of micro.controllers.values()) {
    const phaseMembership = new Map();
    for (const phase of controller.phases) {
      for (const id of phase.movementIds) {
        assert.ok(!phaseMembership.has(id), 'movement appears in multiple phases');
        phaseMembership.set(id, phase.id);
      }
    }
    for (const movement of micro.movements.filter((m) => m.nodeId === controller.nodeId)) {
      assert.ok(phaseMembership.has(movement.id), 'every movement receives a signal phase');
    }
  }
});

test('signal phases switch green, yellow and red at configured boundaries', () => {
  const controller = {
    nodeId: 'j1', cycleOffsetSeconds: 0,
    phases: [
      { id: 'p1', name: 'first', movementIds: ['m1'], greenSeconds: 10, yellowSeconds: 3, allRedSeconds: 1 },
      { id: 'p2', name: 'second', movementIds: ['m2'], greenSeconds: 8, yellowSeconds: 3, allRedSeconds: 1 }
    ]
  };
  assert.equal(signalStateAt(controller, 2, 'm1'), 'green');
  assert.equal(signalStateAt(controller, 11, 'm1'), 'yellow');
  assert.equal(signalStateAt(controller, 15, 'm2'), 'green');
  assert.equal(signalStateAt(controller, 2, 'm2'), 'red');
});

test('vehicles use imported street edges and advance with acceleration limits', () => {
  const micro = buildMicroNetwork(squareNetwork());
  const initial = createMicroState(micro, { vehicleCount: 12, defaultSpeedKmh: 35, desiredHeadwaySeconds: 1.5, standstillGapMeters: 2, maxAccelerationMps2: 1.5, comfortableDecelerationMps2: 2.2, emergencyDecelerationMps2: 6, reactionTimeSeconds: 0.8, seed: 9 });
  assert.ok(initial.vehicles.length > 0);
  const before = vehiclePosition(micro, initial.vehicles[0]);
  let next = initial;
  for (let i = 0; i < 100; i++) next = stepMicroSimulation(micro, next, { vehicleCount: 12, defaultSpeedKmh: 35, desiredHeadwaySeconds: 1.5, standstillGapMeters: 2, maxAccelerationMps2: 1.5, comfortableDecelerationMps2: 2.2, emergencyDecelerationMps2: 6, reactionTimeSeconds: 0.8, seed: 9 }, 0.1);
  const after = vehiclePosition(micro, next.vehicles[0]);
  assert.ok(Number.isFinite(after[0]) && Number.isFinite(after[1]));
  assert.ok(Math.abs(after[0] - before[0]) + Math.abs(after[1] - before[1]) > 0);
  assert.ok(next.vehicles.every((vehicle) => vehicle.speedMps >= 0 && Number.isFinite(vehicle.accelerationMps2)));
});

test('vehicles are seeded only on connected lane routes with valid lane states', () => {
  const micro = buildMicroNetwork(squareNetwork());
  const state = createMicroState(micro, {
    vehicleCount: 32, defaultSpeedKmh: 35, desiredHeadwaySeconds: 1.5,
    standstillGapMeters: 2, maxAccelerationMps2: 1.5,
    comfortableDecelerationMps2: 2.2, emergencyDecelerationMps2: 6,
    reactionTimeSeconds: 0.8, seed: 2026
  });
  assert.ok(state.vehicles.length > 0);
  for (const vehicle of state.vehicles) {
    assert.ok(vehicle.routeEdgeIds.length >= 3);
    assert.equal(vehicle.routeLaneIndices.length, vehicle.routeEdgeIds.length);
    assert.ok(vehicle.laneIndex >= 0);
    const edge = micro.edgesById.get(vehicle.routeEdgeIds[0]);
    assert.ok(edge);
    assert.ok(vehicle.laneIndex < edge.lanes);
  }
});

test('vehicle positions follow intermediate vertices on curved roads instead of a straight chord', () => {
  const curved = buildRoadNetwork([
    road(701, [[49, 40], [49.0005, 40.0008], [49.001, 40]], [701, 702], { oneway: 'yes', lanes: '1' }),
    road(702, [[49.001, 40], [49.002, 40]], [702, 703], { oneway: 'yes', lanes: '1' }),
    road(703, [[49.001, 40], [49.001, 40.001]], [702, 704], { oneway: 'yes', lanes: '1' })
  ]);
  const micro = buildMicroNetwork(curved);
  const state = createMicroState(micro, {
    vehicleCount: 8, defaultSpeedKmh: 30, desiredHeadwaySeconds: 1.5,
    standstillGapMeters: 2, maxAccelerationMps2: 1.5,
    comfortableDecelerationMps2: 2.2, emergencyDecelerationMps2: 6,
    reactionTimeSeconds: 0.8, seed: 5
  });
  const vehicle = state.vehicles.find((item) => item.routeEdgeIds[0] === '701:0:f');
  if (vehicle) {
    vehicle.distanceOnEdge = 45;
    const position = vehiclePosition(micro, vehicle);
    assert.ok(position[1] > 40.00015, 'position should follow the curved intermediate vertex');
  }
});

test('calibration CSV parses observations and adjusts simulation parameters', () => {
  const samples = parseCalibrationCsv('timestamp;location;source;speed_kmh;flow_veh_per_hour;queue_meters\n2026-10-13T10:00:00Z;Baku-J1;manual-counter;32;900;45\n2026-10-13T10:05:00Z;Baku-J1;manual-counter;28;720;60');
  assert.equal(samples.length, 2);
  const result = calibrateMicroConfig(samples);
  assert.equal(result.sampleCount, 2);
  assert.ok(result.config.defaultSpeedKmh > 0);
  assert.ok(result.config.desiredHeadwaySeconds > 0);
  assert.ok(result.speedSpreadKmh >= 0);
});

test('OSM turn restrictions remove prohibited movements at a via node', () => {
  const network = buildRoadNetwork([
    road(101, [[49.000, 40.000], [49.001, 40.000]], [1, 2]),
    road(102, [[49.001, 40.000], [49.002, 40.000]], [2, 3]),
    road(103, [[49.001, 40.000], [49.001, 40.001]], [2, 4])
  ]);
  const micro = buildMicroNetwork(network, new Set(), [
    { fromWayId: 101, toWayId: 102, viaNodeId: 'n2', restriction: 'no_straight_on' }
  ]);
  assert.ok(!micro.movements.some((movement) => movement.nodeId === 'n2' && movement.fromEdgeId.startsWith('101:') && movement.toEdgeId.startsWith('102:')));
});

test('signal plan export is a complete editable template and rejects incomplete plans', async () => {
  const { exportSignalPlanJson, importSignalPlanJson } = await import('../src/microsim.ts');
  const micro = buildMicroNetwork(squareNetwork());
  const template = JSON.parse(exportSignalPlanJson(micro));
  assert.equal(template.schemaVersion, 1);
  assert.ok(template.controllers.length > 0);
  const controller = template.controllers[0];
  controller.phases[0].movementIds = [];
  const result = importSignalPlanJson(micro, JSON.stringify(template));
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0);
});

test('directional turn-lane tags restrict illegal lane-to-turn connectors', () => {
  const network = buildRoadNetwork([
    road(201, [[49.000, 40.000], [49.001, 40.000]], [21, 22], { lanes: '3', lanesForward: '2', lanesBackward: '1', turnLanesForward: 'through|left' }),
    road(202, [[49.001, 40.000], [49.002, 40.000]], [22, 23]),
    road(203, [[49.001, 40.000], [49.001, 40.001]], [22, 24]),
    road(204, [[49.001, 40.000], [49.001, 39.999]], [22, 25])
  ]);
  const micro = buildMicroNetwork(network);
  const incoming = micro.movements.filter((movement) => movement.fromEdgeId === '201:0:f');
  assert.ok(incoming.some((movement) => movement.toEdgeId.startsWith('202:') && movement.kind === 'through' && movement.fromLane === 1));
  assert.ok(incoming.some((movement) => movement.toEdgeId.startsWith('203:') && movement.kind === 'left' && movement.fromLane === 0));
  assert.ok(!incoming.some((movement) => movement.toEdgeId.startsWith('204:') && movement.kind === 'right'));
});

test('scenario signal overrides control its junction but imported plans stay authoritative', async () => {
  const { configureScenarioSignal } = await import('../src/microsim.ts');
  const base = buildRoadNetwork([
    road(501, [[49, 40], [49.001, 40]], [501, 502], { oneway: 'yes' }),
    road(502, [[49.001, 40], [49.002, 40]], [502, 503], { oneway: 'yes' }),
    road(503, [[49.001, 39.999], [49.001, 40]], [504, 502], { oneway: 'yes' }),
    road(504, [[49.001, 40], [49.001, 40.001]], [502, 505], { oneway: 'yes' })
  ]);
  const nodeId = 'n502';
  const micro = buildMicroNetwork(base, new Set([nodeId]));
  const controller = micro.controllers.get(nodeId);
  assert.ok(controller);
  const movementId = controller.phases[0].movementIds[0];
  configureScenarioSignal(micro, nodeId, { cycleSeconds: 80, greenShare: 0.6, offsetSeconds: 3, manualState: 'red' });
  assert.equal(signalStateAt(controller, 0, movementId), 'red');
  controller.source = 'scenario';
  configureScenarioSignal(micro, nodeId, { cycleSeconds: 80, greenShare: 0.6, offsetSeconds: 3, manualState: null });
  const cycleLength = controller.phases.reduce((sum, phase) => sum + phase.greenSeconds + phase.yellowSeconds + phase.allRedSeconds, 0);
  assert.ok(Math.abs(cycleLength - 80) < 0.1);
  controller.source = 'imported';
  controller.forcedState = null;
  const previousOffset = controller.cycleOffsetSeconds;
  configureScenarioSignal(micro, nodeId, { cycleSeconds: 100, greenShare: 0.4, offsetSeconds: 50, manualState: 'green' });
  assert.equal(controller.cycleOffsetSeconds, previousOffset);
  assert.equal(controller.forcedState, null);
});


test('stress simulation keeps connector occupancy exclusive and vehicle state finite', () => {
  const micro = buildMicroNetwork(squareNetwork());
  let state = createMicroState(micro, { vehicleCount: 180, defaultSpeedKmh: 45, desiredHeadwaySeconds: 1.6, standstillGapMeters: 2.5 });
  for (let tick = 0; tick < 1800; tick++) {
    state = stepMicroSimulation(micro, state, { ...DEFAULT_MICRO_CONFIG, defaultSpeedKmh: 45, desiredHeadwaySeconds: 1.6, standstillGapMeters: 2.5 }, 0.1);
    const active = state.vehicles.map((vehicle) => vehicle.activeMovementId).filter(Boolean);
    assert.equal(new Set(active).size, active.length, 'a connector must not contain multiple vehicles at once');
    for (const vehicle of state.vehicles) {
      assert.ok(Number.isFinite(vehicle.speedMps) && vehicle.speedMps >= 0, 'speed remains finite and non-negative');
      assert.ok(Number.isFinite(vehicle.distanceOnEdge) && vehicle.distanceOnEdge >= 0, 'edge distance remains finite and non-negative');
    }
  }
});
