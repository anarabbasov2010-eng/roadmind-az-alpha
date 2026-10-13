import type { NetworkEdge, RoadNetwork } from './road-graph';
import type { Position, ScenarioSignal } from './traffic';

export type TurnKind = 'left' | 'through' | 'right';
export type SignalColor = 'red' | 'yellow' | 'green';
export type Movement = {
  id: string; nodeId: string; fromEdgeId: string; toEdgeId: string;
  kind: TurnKind; fromLane: number; toLane: number; turnSpeedKmh: number;
  geometry: Position[]; lengthMeters: number; exitDistanceMeters: number; conflictIds: string[];
};
export type SignalPhase = { id: string; name: string; movementIds: string[]; greenSeconds: number; yellowSeconds: number; allRedSeconds: number };
export type JunctionController = { nodeId: string; cycleOffsetSeconds: number; phases: SignalPhase[]; source?: 'generated' | 'scenario' | 'imported'; forcedState?: SignalColor | null };
export type MicroVehicle = {
  id: number; routeEdgeIds: string[]; routeLaneIndices: number[]; routeIndex: number; laneIndex: number;
  distanceOnEdge: number; speedMps: number; accelerationMps2: number;
  stoppedSeconds: number; delaySeconds: number; activeMovementId: string | null;
  connectorDistance: number; completedTrips: number;
};
export type MicroState = { timeSeconds: number; vehicles: MicroVehicle[]; completedTrips: number; totalDelaySeconds: number };
export type MicroConfig = {
  vehicleCount: number; defaultSpeedKmh: number; desiredHeadwaySeconds: number;
  standstillGapMeters: number; maxAccelerationMps2: number; comfortableDecelerationMps2: number;
  emergencyDecelerationMps2: number; reactionTimeSeconds: number; seed: number;
};
export type TurnRestriction = { fromWayId: number; toWayId: number; viaNodeId: string; restriction: string; fromDirection?: 1 | -1; toDirection?: 1 | -1 };
export type MicroNetwork = {
  source: RoadNetwork; movements: Movement[]; movementsByIncomingEdge: Map<string, Movement[]>;
  controllers: Map<string, JunctionController>; edgesById: Map<string, NetworkEdge>; outgoingByNode: Map<string, NetworkEdge[]>;
  movementsById: Map<string, Movement>; movementsByNode: Map<string, Movement[]>;
  stats: { movements: number; conflicts: number; controlledJunctions: number; laneConnections: number };
};
export const DEFAULT_MICRO_CONFIG: MicroConfig = {
  vehicleCount: 48, defaultSpeedKmh: 40, desiredHeadwaySeconds: 1.6,
  standstillGapMeters: 2.2, maxAccelerationMps2: 1.7,
  comfortableDecelerationMps2: 2.4, emergencyDecelerationMps2: 6.5,
  reactionTimeSeconds: 0.8, seed: 42
};
const RAD = Math.PI / 180, DEG = 180 / Math.PI;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const edgeLen = (e: NetworkEdge) => Math.max(0.1, e.lengthMeters);
function distance(a: Position, b: Position): number {
  const lat = (a[1] + b[1]) * 0.5 * RAD;
  return Math.hypot((b[0] - a[0]) * 111320 * Math.cos(lat), (b[1] - a[1]) * 110540);
}
export function bearingDegrees(a: Position, b: Position): number {
  return (Math.atan2((b[0] - a[0]) * Math.cos((a[1] + b[1]) * 0.5 * RAD), b[1] - a[1]) * DEG + 360) % 360;
}
function deltaAngle(a: number, b: number): number { return ((b - a + 540) % 360) - 180; }
function classifyTurn(a: number, b: number): TurnKind {
  const d = deltaAngle(a, b);
  return d > 32 ? 'right' : d < -32 ? 'left' : 'through';
}
function mix(a: Position, b: Position, t: number): Position { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
function lanePoint(edge: NetworkEdge, point: Position, laneIndex: number): Position {
  const a = edge.geometry[0], b = edge.geometry[edge.geometry.length - 1];
  const latitude = point[1] * RAD, xScale = 111320 * Math.max(0.15, Math.cos(latitude));
  const dx = (b[0] - a[0]) * xScale, dy = (b[1] - a[1]) * 110540;
  const length = Math.hypot(dx, dy) || 1;
  const offset = (edge.carriagewayOffsetMeters || 0) + (laneIndex - (laneCount(edge) - 1) / 2) * 3.25;
  return [point[0] - (dy / length) * offset / xScale, point[1] + (dx / length) * offset / 110540];
}
function connector(from: NetworkEdge, to: NetworkEdge, kind: TurnKind, fromLane: number, toLane: number): { geometry: Position[]; exitDistanceMeters: number } {
  const node = from.geometry[from.geometry.length - 1];
  const next = to.geometry[Math.min(1, to.geometry.length - 1)];
  const startPoint = lanePoint(from, node, fromLane);
  const endPoint = lanePoint(to, mix(node, next, 0.24), toLane);
  const previous = lanePoint(from, from.geometry[Math.max(0, from.geometry.length - 2)], fromLane);
  const outgoing = lanePoint(to, next, toLane);
  const c1: Position = [startPoint[0] + (startPoint[0] - previous[0]) * 0.42, startPoint[1] + (startPoint[1] - previous[1]) * 0.42];
  const lateral = kind === 'left' ? -0.000006 : kind === 'right' ? 0.000006 : 0;
  const toNode = lanePoint(to, node, toLane);
  const c2: Position = [endPoint[0] - (outgoing[0] - toNode[0]) * 0.18 + lateral, endPoint[1] - (outgoing[1] - toNode[1]) * 0.18 - lateral * 0.7];
  const geometry: Position[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12, u = 1 - t;
    geometry.push([
      u ** 3 * startPoint[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t ** 3 * endPoint[0],
      u ** 3 * startPoint[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t ** 3 * endPoint[1]
    ]);
  }
  return { geometry, exitDistanceMeters: distance(toNode, endPoint) };
}
function lineCross(a: Position, b: Position, c: Position, d: Position): boolean {
  const orient = (p: Position, q: Position, r: Position) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0;
}
function conflicts(a: Position[], b: Position[]): boolean {
  for (let i = 1; i < a.length; i++) for (let j = 1; j < b.length; j++) if (lineCross(a[i - 1], a[i], b[j - 1], b[j])) return true;
  return false;
}
function laneTurnAllowed(turn: TurnKind, lane: number, count: number, tags: string): boolean {
  const lanes = tags.split('|');
  const options = (lanes[count - 1 - lane] || '').split(';').map((value) => value.trim().toLowerCase());
  if (!options.length || !options[0]) return true;
  return options.some((value) =>
    value === 'through' && turn === 'through' ||
    ['left', 'slight_left', 'sharp_left', 'merge_to_left'].includes(value) && turn === 'left' ||
    ['right', 'slight_right', 'sharp_right', 'merge_to_right'].includes(value) && turn === 'right' ||
    ['reverse', 'uturn'].includes(value) && turn === 'left'
  );
}
function laneCount(edge: NetworkEdge): number { return clamp(Math.floor(edge.lanes || 1), 1, 8); }

export function buildMicroNetwork(network: RoadNetwork, signalNodeIds?: Set<string>, restrictions: TurnRestriction[] = []): MicroNetwork {
  const incoming = new Map<string, NetworkEdge[]>(), outgoing = new Map<string, NetworkEdge[]>();
  const edgesById = new Map(network.edges.map((edge) => [edge.id, edge]));
  for (const edge of network.edges) {
    incoming.set(edge.to, [...(incoming.get(edge.to) || []), edge]);
    outgoing.set(edge.from, [...(outgoing.get(edge.from) || []), edge]);
  }
  const movements: Movement[] = [];
  for (const [nodeId, ins] of incoming) {
    for (const from of ins) for (const to of outgoing.get(nodeId) || []) {
      if (from.id === to.id || (from.roadId === to.roadId && from.from === to.to)) continue;
      const nodeRestrictions = restrictions.filter((restriction) => restriction.viaNodeId === nodeId && restriction.fromWayId === from.roadId && (restriction.fromDirection === undefined || restriction.fromDirection === from.direction));
      const applicableRestrictions = nodeRestrictions.filter((restriction) => restriction.toDirection === undefined || restriction.toDirection === to.direction);
      const onlyRestrictions = applicableRestrictions.filter((restriction) => restriction.restriction.startsWith('only_'));
      if (onlyRestrictions.length && !onlyRestrictions.some((restriction) => restriction.toWayId === to.roadId)) continue;
      if (applicableRestrictions.some((restriction) => restriction.toWayId === to.roadId && restriction.restriction.startsWith('no_'))) continue;
      const kind = classifyTurn(bearingDegrees(from.geometry[0], from.geometry[from.geometry.length - 1]), bearingDegrees(to.geometry[0], to.geometry[to.geometry.length - 1]));
      if (Math.abs(deltaAngle(bearingDegrees(from.geometry[0], from.geometry[from.geometry.length - 1]), bearingDegrees(to.geometry[0], to.geometry[to.geometry.length - 1]))) > 150 && (outgoing.get(nodeId) || []).length > 1) continue;
      const countIn = laneCount(from), countOut = laneCount(to);
      const lanePairs: Array<[number, number]> = [];
      for (let lane = 0; lane < countIn; lane++) {
        if (from.turnLanes && !laneTurnAllowed(kind, lane, countIn, from.turnLanes)) continue;
        const toLane = kind === 'left' ? Math.min(countOut - 1, lane) : kind === 'right' ? Math.max(0, countOut - countIn + lane) : clamp(lane, 0, countOut - 1);
        lanePairs.push([lane, toLane]);
      }
      for (const [fromLane, toLane] of lanePairs) {
        const curve = connector(from, to, kind, fromLane, toLane);
        let lengthMeters = 0;
        for (let i = 1; i < curve.geometry.length; i++) lengthMeters += distance(curve.geometry[i - 1], curve.geometry[i]);
        movements.push({
          id: nodeId + ':' + from.id + ':' + to.id + ':' + fromLane, nodeId,
          fromEdgeId: from.id, toEdgeId: to.id, kind, fromLane, toLane,
          turnSpeedKmh: kind === 'left' ? 18 : kind === 'right' ? 14 : 32,
          geometry: curve.geometry, lengthMeters: Math.max(2, lengthMeters),
          exitDistanceMeters: curve.exitDistanceMeters, conflictIds: []
        });
      }
    }
  }
  const movementsAtNode = new Map<string, Movement[]>();
  for (const movement of movements) movementsAtNode.set(movement.nodeId, [...(movementsAtNode.get(movement.nodeId) || []), movement]);
  for (const atNode of movementsAtNode.values()) for (let i = 0; i < atNode.length; i++) for (let j = i + 1; j < atNode.length; j++) {
    const a = atNode[i], b = atNode[j];
    if ((a.fromEdgeId === b.fromEdgeId && a.fromLane === b.fromLane) || (a.toEdgeId === b.toEdgeId && a.toLane === b.toLane)) continue;
    if (conflicts(a.geometry, b.geometry)) { a.conflictIds.push(b.id); b.conflictIds.push(a.id); }
  }
  const movementsByIncomingEdge = new Map<string, Movement[]>();
  for (const movement of movements) movementsByIncomingEdge.set(movement.fromEdgeId, [...(movementsByIncomingEdge.get(movement.fromEdgeId) || []), movement]);
  const controllers = new Map<string, JunctionController>();
  for (const [nodeId, atNode] of movementsAtNode) {
    if (!atNode.length || (signalNodeIds && !signalNodeIds.has(nodeId))) continue;
    // Greedy conflict-graph colouring produces phases that never intentionally green-light a geometric conflict pair.
    const colors: Movement[][] = [];
    for (const movement of atNode) {
      let color = colors.find((group) => group.every((other) => !movement.conflictIds.includes(other.id)));
      if (!color) { color = []; colors.push(color); }
      color.push(movement);
    }
    controllers.set(nodeId, {
      nodeId, cycleOffsetSeconds: 0, source: 'generated', forcedState: null,
      phases: colors.map((group, index) => ({ id: nodeId + ':phase:' + index, name: 'Фаза ' + (index + 1), movementIds: group.map((movement) => movement.id), greenSeconds: index === 0 ? 24 : 12, yellowSeconds: 3, allRedSeconds: 1 }))
    });
  }
  return { source: network, movements, movementsByIncomingEdge, controllers, edgesById, outgoingByNode: outgoing, movementsById: new Map(movements.map((movement) => [movement.id, movement])), movementsByNode: movementsAtNode, stats: {
    movements: movements.length,
    conflicts: movements.reduce((sum, movement) => sum + movement.conflictIds.length, 0) / 2,
    controlledJunctions: controllers.size,
    laneConnections: movements.length
  }};
}
export function signalStateAt(controller: JunctionController, timeSeconds: number, movementId: string): SignalColor {
  if (controller.forcedState) return controller.forcedState;
  const phases = controller.phases.filter((phase) => phase.movementIds.length);
  if (!phases.length) return 'red';
  const cycle = phases.reduce((sum, phase) => sum + phase.greenSeconds + phase.yellowSeconds + phase.allRedSeconds, 0);
  let t = ((timeSeconds + controller.cycleOffsetSeconds) % cycle + cycle) % cycle;
  for (const phase of phases) {
    const greenEnd = phase.greenSeconds, yellowEnd = greenEnd + phase.yellowSeconds;
    if (phase.movementIds.includes(movementId)) {
      if (t < greenEnd) return 'green';
      if (t < yellowEnd) return 'yellow';
      return 'red';
    }
    const duration = greenEnd + phase.yellowSeconds + phase.allRedSeconds;
    if (t < duration) return 'red';
    t -= duration;
  }
  return 'red';
}
function randomFor(seed: number): () => number {
  let value = seed >>> 0;
  return () => { value = (Math.imul(1664525, value) + 1013904223) >>> 0; return value / 4294967296; };
}
function findRoute(net: MicroNetwork, startEdge: NetworkEdge, random: () => number, startLane = 0): { edgeIds: string[]; laneIndices: number[] } {
  const firstLane = clamp(startLane, 0, laneCount(startEdge) - 1);
  const queue: Array<{ edge: NetworkEdge; lane: number; edgeIds: string[]; laneIndices: number[]; length: number }> = [
    { edge: startEdge, lane: firstLane, edgeIds: [startEdge.id], laneIndices: [firstLane], length: edgeLen(startEdge) }
  ];
  const visited = new Set([startEdge.id + ':' + firstLane]);
  const candidates: Array<{ edgeIds: string[]; laneIndices: number[]; length: number }> = [];
  for (let i = 0; i < queue.length && i < 5000; i++) {
    const current = queue[i];
    if (current.edgeIds.length >= 3 && current.length >= 250) candidates.push(current);
    if (current.edgeIds.length >= 18 || current.length > 5000) continue;
    for (const movement of net.movementsByIncomingEdge.get(current.edge.id) || []) {
      if (movement.fromLane !== current.lane) continue;
      const key = movement.toEdgeId + ':' + movement.toLane;
      if (visited.has(key)) continue;
      visited.add(key);
      const edge = net.edgesById.get(movement.toEdgeId);
      if (edge) queue.push({ edge, lane: movement.toLane, edgeIds: [...current.edgeIds, edge.id], laneIndices: [...current.laneIndices, movement.toLane], length: current.length + edgeLen(edge) });
    }
  }
  if (!candidates.length) return { edgeIds: [startEdge.id], laneIndices: [firstLane] };
  const selected = candidates[Math.floor(random() * candidates.length)];
  return { edgeIds: selected.edgeIds, laneIndices: selected.laneIndices };
}
export function createMicroState(net: MicroNetwork, config: MicroConfig = DEFAULT_MICRO_CONFIG): MicroState {
  const random = randomFor(config.seed);
  const edges = net.source.edges.filter((edge) => edge.lengthMeters > 18 && edge.lanes > 0);
  const vehicles: MicroVehicle[] = [];
  for (let i = 0; i < clamp(config.vehicleCount, 0, 500); i++) {
    if (!edges.length) break;
    const edge = edges[Math.floor(random() * edges.length)];
    const initialLane = Math.floor(random() * laneCount(edge));
    const route = findRoute(net, edge, random, initialLane);
    if (!route.edgeIds.length) continue;
    vehicles.push({ id: i + 1, routeEdgeIds: route.edgeIds, routeLaneIndices: route.laneIndices, routeIndex: 0, laneIndex: route.laneIndices[0],
      distanceOnEdge: random() * Math.min(edge.lengthMeters * 0.7, 45), speedMps: random() * 2.5, accelerationMps2: 0,
      stoppedSeconds: 0, delaySeconds: 0, activeMovementId: null, connectorDistance: 0, completedTrips: 0 });
  }
  return { timeSeconds: 0, vehicles, completedTrips: 0, totalDelaySeconds: 0 };
}
export function vehiclePosition(net: MicroNetwork, vehicle: MicroVehicle): Position {
  const edge = net.edgesById.get(vehicle.routeEdgeIds[vehicle.routeIndex]);
  if (!edge) return [0, 0];
  if (vehicle.activeMovementId) {
    const movement = net.movementsById.get(vehicle.activeMovementId);
    if (movement) {
      let d = vehicle.connectorDistance;
      for (let i = 1; i < movement.geometry.length; i++) {
        const segment = distance(movement.geometry[i - 1], movement.geometry[i]);
        if (d <= segment) return mix(movement.geometry[i - 1], movement.geometry[i], segment ? d / segment : 0);
        d -= segment;
      }
      return movement.geometry[movement.geometry.length - 1];
    }
  }
  const t = clamp(vehicle.distanceOnEdge / edgeLen(edge), 0, 1);
  return lanePoint(edge, mix(edge.geometry[0], edge.geometry[edge.geometry.length - 1], t), vehicle.laneIndex);
}
export function vehicleBearing(net: MicroNetwork, vehicle: MicroVehicle): number {
  if (vehicle.activeMovementId) {
    const movement = net.movementsById.get(vehicle.activeMovementId);
    if (movement) return bearingDegrees(movement.geometry[0], movement.geometry[Math.min(2, movement.geometry.length - 1)]);
  }
  const edge = net.edgesById.get(vehicle.routeEdgeIds[vehicle.routeIndex]);
  return edge ? bearingDegrees(edge.geometry[0], edge.geometry[edge.geometry.length - 1]) : 0;
}
export function microVehicleCollection(net: MicroNetwork, state: MicroState) {
  return { type: 'FeatureCollection' as const, features: state.vehicles.map((vehicle) => ({
    type: 'Feature' as const, id: vehicle.id, geometry: { type: 'Point' as const, coordinates: vehiclePosition(net, vehicle) },
    properties: { id: vehicle.id, bearing: vehicleBearing(net, vehicle), stopped: vehicle.speedMps < 0.15, icon: vehicle.id % 5 === 0 ? 'rm-car-amber' : 'rm-car' }
  })) };
}
export function stepMicroSimulation(net: MicroNetwork, state: MicroState, config: MicroConfig, deltaSeconds: number): MicroState {
  const dt = clamp(deltaSeconds, 0, 0.2);
  if (dt <= 0) return state;
  const now = state.timeSeconds + dt;
  const vehicles = state.vehicles.map((vehicle) => ({ ...vehicle }));
  const occupancy = new Map<string, MicroVehicle[]>();
  for (const vehicle of vehicles) {
    if (vehicle.activeMovementId) continue;
    const key = vehicle.routeEdgeIds[vehicle.routeIndex] + ':' + vehicle.laneIndex;
    occupancy.set(key, [...(occupancy.get(key) || []), vehicle]);
  }
  for (const list of occupancy.values()) list.sort((a, b) => b.distanceOnEdge - a.distanceOnEdge);
  const occupiedMovements = new Set<string>(vehicles.map((vehicle) => vehicle.activeMovementId).filter((id): id is string => Boolean(id)));
  let completedTrips = state.completedTrips, totalDelaySeconds = state.totalDelaySeconds;
  const updateOrder = [...vehicles].sort((a, b) => {
    const aKey = a.activeMovementId ? '~' + a.activeMovementId : a.routeEdgeIds[a.routeIndex] + ':' + a.laneIndex;
    const bKey = b.activeMovementId ? '~' + b.activeMovementId : b.routeEdgeIds[b.routeIndex] + ':' + b.laneIndex;
    return aKey.localeCompare(bKey) || b.distanceOnEdge - a.distanceOnEdge;
  });
  for (const vehicle of updateOrder) {
    if (vehicle.activeMovementId) {
      const movement = net.movements.find((item) => item.id === vehicle.activeMovementId);
      if (!movement) { vehicle.activeMovementId = null; vehicle.connectorDistance = 0; continue; }
      const targetTurnSpeed = movement.turnSpeedKmh / 3.6;
      const turnAcceleration = clamp((targetTurnSpeed - vehicle.speedMps) / dt, -config.emergencyDecelerationMps2, config.maxAccelerationMps2);
      vehicle.speedMps = Math.max(0, vehicle.speedMps + turnAcceleration * dt);
      vehicle.accelerationMps2 = turnAcceleration;
      vehicle.connectorDistance += vehicle.speedMps * dt;
      if (vehicle.speedMps < 0.15) { vehicle.stoppedSeconds += dt; vehicle.delaySeconds += dt; totalDelaySeconds += dt; }
      if (vehicle.connectorDistance >= movement.lengthMeters) {
        vehicle.activeMovementId = null; vehicle.connectorDistance = 0;
        vehicle.routeIndex = Math.min(vehicle.routeIndex + 1, vehicle.routeEdgeIds.length - 1);
        vehicle.distanceOnEdge = movement.exitDistanceMeters;
        vehicle.laneIndex = clamp(movement.toLane, 0, Math.max(0, laneCount(net.edgesById.get(movement.toEdgeId)!) - 1));
      }
      continue;
    }
    const edge = net.edgesById.get(vehicle.routeEdgeIds[vehicle.routeIndex]);
    if (!edge) continue;
    let remaining = edgeLen(edge) - vehicle.distanceOnEdge;
    if (vehicle.routeIndex >= vehicle.routeEdgeIds.length - 1 && remaining < Math.max(24, vehicle.speedMps * 3.5)) {
      const exits = (net.outgoingByNode.get(edge.to) || []).filter((candidate) => (net.movementsByIncomingEdge.get(edge.id) || []).some((movement) => movement.toEdgeId === candidate.id && movement.fromLane === vehicle.laneIndex));
      if (exits.length) {
        const random = randomFor(vehicle.id * 7919 + vehicle.completedTrips * 104729 + Math.floor(now));
        const nextEdge = exits[Math.floor(random() * exits.length)];
        const transition = (net.movementsByIncomingEdge.get(edge.id) || []).find((movement) => movement.toEdgeId === nextEdge.id && movement.fromLane === vehicle.laneIndex);
        if (transition) {
          const extension = findRoute(net, nextEdge, random, transition.toLane);
          vehicle.routeEdgeIds = [...vehicle.routeEdgeIds, ...extension.edgeIds];
          vehicle.routeLaneIndices = [...vehicle.routeLaneIndices, ...extension.laneIndices];
        }
      }
    }
    const nextId = vehicle.routeEdgeIds[vehicle.routeIndex + 1];
    const movement = nextId ? (net.movementsByIncomingEdge.get(edge.id) || []).find((item) => item.toEdgeId === nextId && item.fromLane === vehicle.laneIndex) : null;
    const controller = movement ? net.controllers.get(movement.nodeId) : undefined;
    const light = movement && controller ? signalStateAt(controller, now, movement.id) : 'green';
    const conflictBusy = movement?.conflictIds.some((id) => occupiedMovements.has(id)) || false;
    const isLast = vehicle.routeIndex >= vehicle.routeEdgeIds.length - 1;
    let targetSpeed = Math.min(config.defaultSpeedKmh, edge.speedKmh || config.defaultSpeedKmh) / 3.6;
    if (isLast) {
      targetSpeed = Math.min(targetSpeed, Math.sqrt(Math.max(0, 2 * config.comfortableDecelerationMps2 * Math.max(0, remaining - 1))));
    } else if (!movement) {
      targetSpeed = 0;
    } else {
      const turnSpeed = movement.turnSpeedKmh / 3.6;
      targetSpeed = Math.min(targetSpeed, Math.sqrt(turnSpeed * turnSpeed + 2 * config.comfortableDecelerationMps2 * Math.max(0, remaining - 0.6)));
      if (light !== 'green' || conflictBusy) {
        targetSpeed = Math.min(targetSpeed, Math.sqrt(Math.max(0, 2 * config.comfortableDecelerationMps2 * Math.max(0, remaining - 1.8))));
      }
    }
    const leaders = occupancy.get(edge.id + ':' + vehicle.laneIndex) || [];
    const leaderIndex = leaders.findIndex((candidate) => candidate.id === vehicle.id);
    if (leaderIndex > 0) {
      const leader = leaders[leaderIndex - 1];
      const gap = Math.max(0, leader.distanceOnEdge - vehicle.distanceOnEdge - 4.6);
      const safeGap = config.standstillGapMeters + vehicle.speedMps * config.desiredHeadwaySeconds;
      if (gap < safeGap) targetSpeed = Math.min(targetSpeed, Math.max(0, leader.speedMps + (gap - config.standstillGapMeters) / Math.max(0.4, config.reactionTimeSeconds)));
    }
    const acceleration = clamp((targetSpeed - vehicle.speedMps) / dt, -config.emergencyDecelerationMps2, config.maxAccelerationMps2);
    vehicle.speedMps = Math.max(0, vehicle.speedMps + acceleration * dt);
    vehicle.accelerationMps2 = acceleration;
    vehicle.distanceOnEdge = Math.min(edgeLen(edge), vehicle.distanceOnEdge + vehicle.speedMps * dt);
    if (leaderIndex > 0) {
      const leader = leaders[leaderIndex - 1];
      const safePosition = Math.max(0, leader.distanceOnEdge - 4.8);
      if (vehicle.distanceOnEdge > safePosition) {
        vehicle.distanceOnEdge = safePosition;
        vehicle.speedMps = Math.min(vehicle.speedMps, leader.speedMps);
      }
    }
    if (vehicle.speedMps < 0.15) { vehicle.stoppedSeconds += dt; vehicle.delaySeconds += dt; totalDelaySeconds += dt; }
    if (vehicle.distanceOnEdge >= edgeLen(edge) - 0.05) {
      if (isLast) {
        vehicle.distanceOnEdge = Math.max(0, edgeLen(edge) - 0.1);
        vehicle.speedMps = 0;
      } else if (movement && light === 'green' && !conflictBusy) {
        occupiedMovements.add(movement.id);
        vehicle.activeMovementId = movement.id; vehicle.connectorDistance = 0;
      } else {
        vehicle.distanceOnEdge = Math.min(vehicle.distanceOnEdge, edgeLen(edge) - 1.8);
        vehicle.speedMps = Math.min(vehicle.speedMps, 0.2);
      }
    }
  }
  return { timeSeconds: now, vehicles, completedTrips, totalDelaySeconds };
}
export type CalibrationSample = {
  observedSpeedKmh: number;
  observedFlowVehPerHour: number;
  observedQueueMeters: number;
  timestamp: string;
  location: string;
  source: string;
};
export function parseCalibrationCsv(csv: string): CalibrationSample[] {
  const lines = csv.replace(/^\uFEFF/, '').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].toLowerCase().split(/[;,]/).map((v) => v.trim());
  const find = (aliases: string[]) => header.findIndex((v) => aliases.includes(v));
  const timestamp = find(['timestamp', 'datetime', 'date_time', 'дата_время']);
  const location = find(['location', 'site', 'segment_id', 'место', 'участок']);
  const source = find(['source', 'source_id', 'источник']);
  const speed = find(['speed_kmh', 'speed', 'скорость', 'скорость_кмч']);
  const flow = find(['flow_veh_per_hour', 'flow', 'поток', 'машин_в_час']);
  const queue = find(['queue_meters', 'queue', 'очередь', 'очередь_метры']);
  if ([timestamp, location, source, speed, flow, queue].some((v) => v < 0)) return [];
  const parseNumber = (cell: string | undefined) => !cell || !cell.trim() ? NaN : Number(cell.trim().replace(',', '.'));
  return lines.slice(1).map((line) => line.split(';').length > 1 ? line.split(';') : line.split(','))
    .map((row) => ({
      timestamp: row[timestamp]?.trim() || '',
      location: row[location]?.trim() || '',
      source: row[source]?.trim() || '',
      observedSpeedKmh: parseNumber(row[speed]),
      observedFlowVehPerHour: parseNumber(row[flow]),
      observedQueueMeters: parseNumber(row[queue])
    }))
    .filter((sample) => Boolean(sample.timestamp && sample.location && sample.source) &&
      Number.isFinite(sample.observedSpeedKmh) && sample.observedSpeedKmh >= 0 && sample.observedSpeedKmh <= 160 &&
      Number.isFinite(sample.observedFlowVehPerHour) && sample.observedFlowVehPerHour >= 0 && sample.observedFlowVehPerHour <= 10000 &&
      Number.isFinite(sample.observedQueueMeters) && sample.observedQueueMeters >= 0 && sample.observedQueueMeters <= 100000);
}
export function calibrateMicroConfig(samples: CalibrationSample[], base: MicroConfig = DEFAULT_MICRO_CONFIG) {
  if (!samples.length) return { config: base, sampleCount: 0, speedSpreadKmh: 0 };
  const mean = (select: (sample: CalibrationSample) => number) => samples.reduce((sum, sample) => sum + select(sample), 0) / samples.length;
  const speed = mean((sample) => sample.observedSpeedKmh);
  const flow = mean((sample) => sample.observedFlowVehPerHour);
  const queue = mean((sample) => sample.observedQueueMeters);
  const config = { ...base, defaultSpeedKmh: clamp(speed, 10, 100), desiredHeadwaySeconds: clamp(3600 / Math.max(1, flow), 0.8, 3.2), standstillGapMeters: clamp(queue / Math.max(1, samples.length * 3), 1.5, 8) };
  const speedSpreadKmh = Math.sqrt(samples.reduce((sum, sample) => sum + (sample.observedSpeedKmh - config.defaultSpeedKmh) ** 2, 0) / samples.length);
  return { config, sampleCount: samples.length, speedSpreadKmh };
}

export type SignalPlanImportResult = { ok: boolean; updated: number; errors: string[] };
export function exportSignalPlanJson(net: MicroNetwork): string {
  return JSON.stringify({
    schemaVersion: 1,
    source: 'RoadMind AZ signal timing plan',
    note: 'Replace phase timings with verified controller data. Generated defaults are estimates, not actual field programs.',
    controllers: Array.from(net.controllers.values()).map((controller) => ({
      nodeId: controller.nodeId,
      cycleOffsetSeconds: controller.cycleOffsetSeconds,
      phases: controller.phases.map((phase) => ({
        id: phase.id, name: phase.name, greenSeconds: phase.greenSeconds,
        yellowSeconds: phase.yellowSeconds, allRedSeconds: phase.allRedSeconds,
        movementIds: phase.movementIds
      }))
    }))
  }, null, 2);
}
export function importSignalPlanJson(net: MicroNetwork, input: string): SignalPlanImportResult {
  const errors: string[] = [];
  let payload: unknown;
  try { payload = JSON.parse(input); } catch { return { ok: false, updated: 0, errors: ['Файл не является корректным JSON.'] }; }
  if (!payload || typeof payload !== 'object' || (payload as { schemaVersion?: unknown }).schemaVersion !== 1 || !Array.isArray((payload as { controllers?: unknown }).controllers)) {
    return { ok: false, updated: 0, errors: ['Ожидается файл схемы RoadMind signal plan, schemaVersion: 1.'] };
  }
  const source = payload as { controllers: Array<{ nodeId?: unknown; cycleOffsetSeconds?: unknown; phases?: unknown }> };
  const staged: JunctionController[] = [];
  for (const item of source.controllers) {
    const nodeId = typeof item.nodeId === 'string' ? item.nodeId : '';
    const current = net.controllers.get(nodeId);
    if (!current) { errors.push('Неизвестный узел светофора: ' + (nodeId || '(пусто)')); continue; }
    if (!Array.isArray(item.phases) || item.phases.length < 1 || item.phases.length > 16) { errors.push(nodeId + ': число фаз должно быть от 1 до 16.'); continue; }
    const phases: SignalPhase[] = [];
    const allowed = new Set(net.movements.filter((movement) => movement.nodeId === nodeId).map((movement) => movement.id));
    const covered = new Set<string>();
    for (const raw of item.phases as Array<Record<string, unknown>>) {
      const movementIds = Array.isArray(raw.movementIds) ? raw.movementIds.filter((id): id is string => typeof id === 'string') : [];
      const greenSeconds = Number(raw.greenSeconds), yellowSeconds = Number(raw.yellowSeconds), allRedSeconds = Number(raw.allRedSeconds);
      if (!movementIds.length || movementIds.some((id) => !allowed.has(id)) || new Set(movementIds).size !== movementIds.length || movementIds.some((id) => covered.has(id))) { errors.push(nodeId + ': фаза содержит пустые, неизвестные или повторные движения.'); continue; }
      if (!Number.isFinite(greenSeconds) || greenSeconds < 5 || greenSeconds > 180 || !Number.isFinite(yellowSeconds) || yellowSeconds < 2 || yellowSeconds > 8 || !Number.isFinite(allRedSeconds) || allRedSeconds < 0 || allRedSeconds > 8) {
        errors.push(nodeId + ': некорректная длительность фазы.'); continue;
      }
      const conflictSet = new Set(movementIds);
      if (net.movements.some((movement) => movement.nodeId === nodeId && conflictSet.has(movement.id) && movement.conflictIds.some((id) => conflictSet.has(id)))) {
        errors.push(nodeId + ': в одной фазе есть геометрически конфликтующие манёвры.'); continue;
      }
      movementIds.forEach((id) => covered.add(id));
      phases.push({ id: typeof raw.id === 'string' ? raw.id : nodeId + ':imported:' + phases.length, name: typeof raw.name === 'string' ? raw.name : 'Фаза ' + (phases.length + 1), movementIds, greenSeconds, yellowSeconds, allRedSeconds });
    }
    if (covered.size !== allowed.size) errors.push(nodeId + ': план должен назначить каждое движение ровно одной фазе.');
    if (phases.length === item.phases.length && covered.size === allowed.size) staged.push({ nodeId, cycleOffsetSeconds: Number.isFinite(Number(item.cycleOffsetSeconds)) ? Number(item.cycleOffsetSeconds) : 0, phases });
  }
  if (errors.length) return { ok: false, updated: 0, errors };
  for (const controller of staged) net.controllers.set(controller.nodeId, controller);
  return { ok: true, updated: staged.length, errors: [] };
}

export function ensureJunctionController(net: MicroNetwork, nodeId: string): JunctionController | null {
  const existing = net.controllers.get(nodeId);
  if (existing) return existing;
  const atNode = net.movementsByNode.get(nodeId) || [];
  if (!atNode.length) return null;
  const colors: Movement[][] = [];
  for (const movement of atNode) {
    let color = colors.find((group) => group.every((other) => !movement.conflictIds.includes(other.id)));
    if (!color) { color = []; colors.push(color); }
    color.push(movement);
  }
  const controller: JunctionController = {
    nodeId, cycleOffsetSeconds: 0, source: 'scenario', forcedState: null,
    phases: colors.map((group, index) => ({
      id: nodeId + ':scenario-phase:' + index, name: 'Фаза ' + (index + 1),
      movementIds: group.map((movement) => movement.id), greenSeconds: index === 0 ? 24 : 12,
      yellowSeconds: 3, allRedSeconds: 1
    }))
  };
  net.controllers.set(nodeId, controller);
  return controller;
}
export function configureScenarioSignal(net: MicroNetwork, nodeId: string, signal: Pick<ScenarioSignal, 'cycleSeconds' | 'greenShare' | 'offsetSeconds' | 'manualState'>): void {
  const controller = ensureJunctionController(net, nodeId);
  if (!controller || controller.source === 'imported') return;
  controller.source = 'scenario';
  controller.cycleOffsetSeconds = Number(signal.offsetSeconds) || 0;
  controller.forcedState = signal.manualState;
  if (signal.manualState) return;
  const phaseCount = Math.max(1, controller.phases.length);
  const cycle = clamp(Math.max(Number(signal.cycleSeconds) || 80, phaseCount * 9), 20, 240);
  const intergreen = 4 * phaseCount;
  const totalGreen = Math.max(5 * phaseCount, cycle - intergreen);
  const weights = controller.phases.map((phase) => Math.max(1, phase.greenSeconds));
  const remainingWeight = weights.slice(1).reduce((sum, weight) => sum + weight, 0);
  const share = clamp(Number(signal.greenShare) || 0.58, 0.25, 0.85);
  const firstGreen = phaseCount > 1 ? clamp(totalGreen * share, 5, totalGreen - 5 * (phaseCount - 1)) : totalGreen;
  controller.phases.forEach((phase, index) => {
    phase.greenSeconds = index === 0 ? firstGreen : Math.max(5, (totalGreen - firstGreen) * weights[index] / Math.max(1, remainingWeight));
    phase.yellowSeconds = 3;
    phase.allRedSeconds = 1;
  });
}

export function resetScenarioController(net: MicroNetwork, nodeId: string): void {
  const controller = net.controllers.get(nodeId);
  if (!controller || controller.source === 'imported') return;
  controller.source = 'generated';
  controller.forcedState = null;
  controller.cycleOffsetSeconds = 0;
  controller.phases.forEach((phase, index) => {
    phase.greenSeconds = index === 0 ? 24 : 12;
    phase.yellowSeconds = 3;
    phase.allRedSeconds = 1;
  });
}
