import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEMO_ROUTE,
  advanceTraffic,
  createTrafficState,
  distanceToRouteMeters,
  isSignalRed,
  pointAtProgress,
  progressForCoordinate,
} from '../src/traffic.ts';

test('progress stays on a closed route and point is finite', () => {
  const point = pointAtProgress(DEMO_ROUTE, 1.25);
  assert.equal(point.length, 2);
  assert.ok(point.every(Number.isFinite));
  assert.ok(point[0] >= 49.85 && point[0] <= 49.88);
});

test('route position can be projected with a small residual', () => {
  const point = pointAtProgress(DEMO_ROUTE, 0.27);
  assert.ok(Math.abs(progressForCoordinate(DEMO_ROUTE, point) - 0.27) < 0.01);
  assert.ok(distanceToRouteMeters(DEMO_ROUTE, point) < 8);
});

test('traffic state advances deterministically and keeps vehicle count', () => {
  const start = createTrafficState(12);
  const next = advanceTraffic(start, [], 40, 0.5);
  assert.equal(next.vehicles.length, 12);
  assert.ok(next.time > start.time);
  assert.ok(next.vehicles.every((v) => v.progress >= 0 && v.progress < 1));
});

test('manual signal state overrides cycle', () => {
  const red = { id: 's1', name: 'test', coordinates: [49.86, 40.38], progress: 0.2, cycleSeconds: 60, greenShare: 0.6, offsetSeconds: 0, manualState: 'red', connectedToDemoRoute: true };
  const green = { ...red, manualState: 'green' };
  assert.equal(isSignalRed(red, 10), true);
  assert.equal(isSignalRed(green, 10), false);
});

test('signal cycle is bounded and wraps at its duration', () => {
  const signal = { id: 's1', name: 'test', coordinates: [49.86, 40.38], progress: 0.2, cycleSeconds: 60, greenShare: 0.5, offsetSeconds: 0, manualState: null, connectedToDemoRoute: true };
  assert.equal(isSignalRed(signal, 10), false);
  assert.equal(isSignalRed(signal, 50), true);
  assert.equal(isSignalRed(signal, 70), false);
});