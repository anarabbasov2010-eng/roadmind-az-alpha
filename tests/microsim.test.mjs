import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoadNetwork } from '../src/road-graph.ts';
import {
  buildMicroNetwork, createMicroState, stepMicroSimulation, signalStateAt,
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

test('calibration CSV parses observations and adjusts simulation parameters', () => {
  const samples = parseCalibrationCsv('speed_kmh;flow_veh_per_hour;queue_meters\n32;900;45\n28;720;60');
  assert.equal(samples.length, 2);
  const result = calibrateMicroConfig(samples);
  assert.equal(result.sampleCount, 2);
  assert.ok(result.config.defaultSpeedKmh > 0);
  assert.ok(result.config.desiredHeadwaySeconds > 0);
  assert.ok(result.rmseSpeedKmh >= 0);
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

test('signal plan export is a complete editable template and rejects conflicting plans', async () => {
  const { exportSignalPlanJson, importSignalPlanJson } = await import('../src/microsim.ts');
  const micro = buildMicroNetwork(squareNetwork());
  const template = JSON.parse(exportSignalPlanJson(micro));
  assert.equal(template.schemaVersion, 1);
  if (template.controllers.length) {
    const controller = template.controllers[0];
    const movementIds = micro.movements.filter((movement) => movement.nodeId === controller.nodeId);
    if (movementIds.length > 1) {
      controller.phases = [{
        id: 'bad', name: 'unsafe', greenSeconds: 30, yellowSeconds: 3, allRedSeconds: 1,
        movementIds: movementIds.map((movement) => movement.id)
      }];
      const result = importSignalPlanJson(micro, JSON.stringify(template));
      assert.equal(result.ok, false);
    }
  }
});
