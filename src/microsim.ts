import type { NetworkEdge, RoadNetwork } from './road-graph';
import type { Position } from './traffic';

export type TurnKind = 'left' | 'through' | 'right';
export type SignalColor = 'red' | 'yellow' | 'green';
export type Movement = {
  id: string; nodeId: string; fromEdgeId: string; toEdgeId: string;
  kind: TurnKind; fromLane: number; toLane: number;
  geometry: Position[]; lengthMeters: number; conflictIds: string[];
};
export type SignalPhase = { id: string; name: string; movementIds: string[]; greenSeconds: number; yellowSeconds: number; allRedSeconds: number };
export type JunctionController = { nodeId: string; cycleOffsetSeconds: number; phases: SignalPhase[] };
export type MicroVehicle = {
  id: number; routeEdgeIds: string[]; routeIndex: number; laneIndex: number;
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
export type MicroNetwork = {
  source: RoadNetwork; movements: Movement[]; movementsByIncomingEdge: Map<string, Movement[]>;
  controllers: Map<string, JunctionController>; edgesById: Map<string, NetworkEdge>;
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
const pair = (a: string, b: string) => a + '>' + b;
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
function connector(from: NetworkEdge, to: NetworkEdge, kind: TurnKind): Position[] {
  const node = from.geometry[from.geometry.length - 1];
  const next = to.geometry[to.geometry.length - 1];
  const start = mix(from.geometry[0], node, 0.84);
  const end = mix(node, next, 0.16);
  const control = mix(start, end, 0.5);
  const lateral = kind === 'left' ? -0.000018 : kind === 'right' ? 0.000018 : 0;
  const bend: Position = [control[0] + lateral, control[1] - lateral * 0.7];
  const points: Position[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10, u = 1 - t;
    points.push([u * u * start[0] + 2 * u * t * bend[0] + t * t * end[0], u * u * start[1] + 2 * u * t * bend[1] + t * t * end[1]]);
  }
  return points;
}
function lineCross(a: Position, b: Position, c: Position, d: Position): boolean {
  const orient = (p: Position, q: Position, r: Position) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0;
}
function conflicts(a: Position[], b: Position[]): boolean {
  for (let i = 1; i < a.length; i++) for (let j = 1; j < b.length; j++) if (lineCross(a[i - 1], a[i], b[j - 1], b[j])) return true;
  return false;
}
function laneCount(edge: NetworkEdge): number { return clamp(Math.floor(edge.lanes || 1), 1, 8); }

export function buildMicroNetwork(network: RoadNetwork): MicroNetwork {
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
      const kind = classifyTurn(bearingDegrees(from.geometry[0], from.geometry[from.geometry.length - 1]), bearingDegrees(to.geometry[0], to.geometry[to.geometry.length - 1]));
      if (Math.abs(deltaAngle(bearingDegrees(from.geometry[0], from.geometry[from.geometry.length - 1]), bearingDegrees(to.geometry[0], to.geometry[to.geometry.length - 1]))) > 150) continue;
      const countIn = laneCount(from), countOut = laneCount(to);
      const geometry = connector(from, to, kind);
      let lengthMeters = 0;
      for (let i = 1; i < geometry.length; i++) lengthMeters += distance(geometry[i - 1], geometry[i]);
      const lanePairs: Array<[number, number]> = [];
      for (let lane = 0; lane < countIn; lane++) {
        const allowed = kind === 'left' ? lane >= Math.max(0, countIn - 2) : kind === 'right' ? lane <= 1 : lane <= countIn - 1;
        if (!allowed) continue;
        const toLane = kind === 'left' ? Math.min(countOut - 1, lane) : kind === 'right' ? Math.max(0, countOut - countIn + lane) : clamp(lane, 0, countOut - 1);
        lanePairs.push([lane, toLane]);
      }
      for (const [fromLane, toLane] of lanePairs) movements.push({
        id: nodeId + ':' + from.id + ':' + to.id + ':' + fromLane, nodeId,
        fromEdgeId: from.id, toEdgeId: to.id, kind, fromLane, toLane,
        geometry, lengthMeters: Math.max(2, lengthMeters), conflictIds: []
      });
    }
  }
  for (let i = 0; i < movements.length; i++) for (let j = i + 1; j < movements.length; j++) {
    const a = movements[i], b = movements[j];
    if (a.nodeId !== b.nodeId || (a.fromEdgeId === b.fromEdgeId && a.fromLane === b.fromLane) || (a.toEdgeId === b.toEdgeId && a.toLane === b.toLane)) continue;
    if (conflicts(a.geometry, b.geometry)) { a.conflictIds.push(b.id); b.conflictIds.push(a.id); }
  }
  const movementsByIncomingEdge = new Map<string, Movement[]>();
  for (const movement of movements) movementsByIncomingEdge.set(movement.fromEdgeId, [...(movementsByIncomingEdge.get(movement.fromEdgeId) || []), movement]);
  const controllers = new Map<string, JunctionController>();
  for (const [nodeId] of incoming) {
    const atNode = movements.filter((movement) => movement.nodeId === nodeId);
    if (!atNode.length) continue;
    // Greedy conflict-graph colouring produces phases that never intentionally green-light a geometric conflict pair.
    const colors: Movement[][] = [];
    for (const movement of atNode) {
      let color = colors.find((group) => group.every((other) => !movement.conflictIds.includes(other.id)));
      if (!color) { color = []; colors.push(color); }
      color.push(movement);
    }
    controllers.set(nodeId, {
      nodeId, cycleOffsetSeconds: 0,
      phases: colors.map((group, index) => ({ id: nodeId + ':phase:' + index, name: 'Фаза ' + (index + 1), movementIds: group.map((movement) => movement.id), greenSeconds: index === 0 ? 24 : 12, yellowSeconds: 3, allRedSeconds: 1 }))
    });
  }
  return { source: network, movements, movementsByIncomingEdge, controllers, edgesById, stats: {
    movements: movements.length,
    conflicts: movements.reduce((sum, movement) => sum + movement.conflictIds.length, 0) / 2,
    controlledJunctions: controllers.size,
    laneConnections: movements.length
  }};
}
export function signalStateAt(controller: JunctionController, timeSeconds: number, movementId: string): SignalColor {
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
function findRoute(net: MicroNetwork, startEdge: NetworkEdge, random: () => number): string[] {
  const queue: Array<{ edge: NetworkEdge; path: string[]; length: number }> = [{ edge: startEdge, path: [startEdge.id], length: edgeLen(startEdge) }];
  const visited = new Set([startEdge.id]);
  const candidates: Array<{ path: string[]; length: number }> = [];
  for (let i = 0; i < queue.length && i < 5000; i++) {
    const current = queue[i];
    if (current.path.length >= 3 && current.length >= 250) candidates.push({ path: current.path, length: current.length });
    if (current.path.length >= 18 || current.length > 5000) continue;
    for (const movement of net.movementsByIncomingEdge.get(current.edge.id) || []) {
      if (visited.has(movement.toEdgeId)) continue;
      visited.add(movement.toEdgeId);
      const edge = net.edgesById.get(movement.toEdgeId);
      if (edge) queue.push({ edge, path: [...current.path, edge.id], length: current.length + edgeLen(edge) });
    }
  }
  if (!candidates.length) return [startEdge.id];
  const selected = candidates[Math.floor(random() * candidates.length)];
  return selected.path;
}
export function createMicroState(net: MicroNetwork, config: MicroConfig = DEFAULT_MICRO_CONFIG): MicroState {
  const random = randomFor(config.seed);
  const edges = net.source.edges.filter((edge) => edge.lengthMeters > 18 && edge.lanes > 0);
  const vehicles: MicroVehicle[] = [];
  for (let i = 0; i < clamp(config.vehicleCount, 0, 500); i++) {
    if (!edges.length) break;
    const edge = edges[Math.floor(random() * edges.length)];
    const route = findRoute(net, edge, random);
    if (!route.length) continue;
    vehicles.push({ id: i + 1, routeEdgeIds: route, routeIndex: 0, laneIndex: Math.floor(random() * laneCount(edge)),
      distanceOnEdge: random() * Math.min(edge.lengthMeters * 0.7, 45), speedMps: random() * 2.5, accelerationMps2: 0,
      stoppedSeconds: 0, delaySeconds: 0, activeMovementId: null, connectorDistance: 0, completedTrips: 0 });
  }
  return { timeSeconds: 0, vehicles, completedTrips: 0, totalDelaySeconds: 0 };
}
export function vehiclePosition(net: MicroNetwork, vehicle: MicroVehicle): Position {
  const edge = net.edgesById.get(vehicle.routeEdgeIds[vehicle.routeIndex]);
  if (!edge) return [0, 0];
  if (vehicle.activeMovementId) {
    const movement = net.movements.find((item) => item.id === vehicle.activeMovementId);
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
  return mix(edge.geometry[0], edge.geometry[edge.geometry.length - 1], t);
}
export function vehicleBearing(net: MicroNetwork, vehicle: MicroVehicle): number {
  if (vehicle.activeMovementId) {
    const movement = net.movements.find((item) => item.id === vehicle.activeMovementId);
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
  const occupiedMovements = new Set<string>();
  let completedTrips = state.completedTrips, totalDelaySeconds = state.totalDelaySeconds;
  for (let index = 0; index < vehicles.length; index++) {
    const vehicle = vehicles[index];
    if (vehicle.activeMovementId) {
      const movement = net.movements.find((item) => item.id === vehicle.activeMovementId);
      if (!movement) { vehicle.activeMovementId = null; vehicle.connectorDistance = 0; continue; }
      vehicle.connectorDistance += vehicle.speedMps * dt;
      if (vehicle.connectorDistance >= movement.lengthMeters) {
        vehicle.activeMovementId = null; vehicle.connectorDistance = 0;
        vehicle.routeIndex = Math.min(vehicle.routeIndex + 1, vehicle.routeEdgeIds.length - 1);
        vehicle.distanceOnEdge = 0;
        vehicle.laneIndex = clamp(movement.toLane, 0, Math.max(0, laneCount(net.edgesById.get(movement.toEdgeId)!) - 1));
      }
      continue;
    }
    const edge = net.edgesById.get(vehicle.routeEdgeIds[vehicle.routeIndex]);
    if (!edge) continue;
    const remaining = edgeLen(edge) - vehicle.distanceOnEdge;
    const nextId = vehicle.routeEdgeIds[vehicle.routeIndex + 1];
    const movement = nextId ? (net.movementsByIncomingEdge.get(edge.id) || []).find((item) => item.toEdgeId === nextId && item.fromLane === vehicle.laneIndex) : null;
    const controller = movement ? net.controllers.get(movement.nodeId) : undefined;
    const light = movement && controller ? signalStateAt(controller, now, movement.id) : 'green';
    const conflictBusy = movement?.conflictIds.some((id) => occupiedMovements.has(id)) || false;
    const isLast = vehicle.routeIndex >= vehicle.routeEdgeIds.length - 1;
    let targetSpeed = Math.min(config.defaultSpeedKmh, edge.speedKmh || config.defaultSpeedKmh) / 3.6;
    if (isLast) targetSpeed = Math.min(targetSpeed, Math.sqrt(Math.max(0, 2 * config.comfortableDecelerationMps2 * Math.max(0, remaining - 1))));
    else if (!movement || light !== 'green' || conflictBusy) {
      targetSpeed = Math.min(targetSpeed, Math.sqrt(Math.max(0, 2 * config.comfortableDecelerationMps2 * Math.max(0, remaining - 1.8))));
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
    if (vehicle.speedMps < 0.15) { vehicle.stoppedSeconds += dt; vehicle.delaySeconds += dt; totalDelaySeconds += dt; }
    if (vehicle.distanceOnEdge >= edgeLen(edge) - 0.05) {
      if (isLast) {
        vehicle.routeIndex = 0; vehicle.distanceOnEdge = 0; vehicle.completedTrips++; completedTrips++;
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
export type CalibrationSample = { observedSpeedKmh: number; observedFlowVehPerHour: number; observedQueueMeters: number };
export function parseCalibrationCsv(csv: string): CalibrationSample[] {
  const lines = csv.replace(/^\uFEFF/, '').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].toLowerCase().split(/[;,]/).map((v) => v.trim());
  const find = (aliases: string[]) => header.findIndex((v) => aliases.includes(v));
  const speed = find(['speed_kmh', 'speed', 'скорость', 'скорость_кмч']);
  const flow = find(['flow_veh_per_hour', 'flow', 'поток', 'машин_в_час']);
  const queue = find(['queue_meters', 'queue', 'очередь', 'очередь_метры']);
  if ([speed, flow, queue].some((v) => v < 0)) return [];
  return lines.slice(1).map((line) => line.split(';').length > 1 ? line.split(';') : line.split(','))
    .map((row) => ({ observedSpeedKmh: Number(row[speed]?.trim().replace(',', '.')), observedFlowVehPerHour: Number(row[flow]?.trim().replace(',', '.')), observedQueueMeters: Number(row[queue]?.trim().replace(',', '.')) }))
    .filter((sample) => Number.isFinite(sample.observedSpeedKmh) && sample.observedSpeedKmh >= 0 && sample.observedSpeedKmh <= 160 && Number.isFinite(sample.observedFlowVehPerHour) && sample.observedFlowVehPerHour >= 0 && sample.observedFlowVehPerHour <= 10000 && Number.isFinite(sample.observedQueueMeters) && sample.observedQueueMeters >= 0 && sample.observedQueueMeters <= 100000);
}
export function calibrateMicroConfig(samples: CalibrationSample[], base: MicroConfig = DEFAULT_MICRO_CONFIG) {
  if (!samples.length) return { config: base, sampleCount: 0, rmseSpeedKmh: 0 };
  const mean = (select: (sample: CalibrationSample) => number) => samples.reduce((sum, sample) => sum + select(sample), 0) / samples.length;
  const speed = mean((sample) => sample.observedSpeedKmh);
  const flow = mean((sample) => sample.observedFlowVehPerHour);
  const queue = mean((sample) => sample.observedQueueMeters);
  const config = { ...base, defaultSpeedKmh: clamp(speed, 10, 100), desiredHeadwaySeconds: clamp(3600 / Math.max(1, flow), 0.8, 3.2), standstillGapMeters: clamp(queue / Math.max(1, samples.length * 3), 1.5, 8) };
  const rmseSpeedKmh = Math.sqrt(samples.reduce((sum, sample) => sum + (sample.observedSpeedKmh - config.defaultSpeedKmh) ** 2, 0) / samples.length);
  return { config, sampleCount: samples.length, rmseSpeedKmh };
}
