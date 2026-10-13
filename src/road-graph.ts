import type { Position } from './traffic';

export type RoadInput = {
  id: number;
  name: string;
  highway: string;
  coordinates: Position[];
  nodeRefs?: number[];
  lanes?: string;
  lanesForward?: string;
  lanesBackward?: string;
  turnLanesForward?: string;
  turnLanesBackward?: string;
  maxspeed?: string;
  oneway?: string;
  surface?: string;
  width?: string;
  access?: string;
  junction?: string;
  bridge?: string;
  tunnel?: string;
};

export type NetworkNode = {
  id: string;
  coordinate: Position;
  roadIds: number[];
  degree: number;
  intersection: boolean;
};
export type NetworkEdge = {
  id: string;
  from: string;
  to: string;
  roadId: number;
  roadName: string;
  roadClass: string;
  direction: 1 | -1;
  lanes: number;
  speedKmh: number;
  lengthMeters: number;
  geometry: Position[];
  oneWay: boolean;
};
export type RoadNetwork = {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  intersections: NetworkNode[];
  laneLines: Array<{ id: string; roadId: number; laneIndex: number; direction: 1 | -1; geometry: Position[] }>;
  stats: { roads: number; nodes: number; intersections: number; directedEdges: number; laneCount: number; connectedComponents: number };
};

const RAD = Math.PI / 180;
export function distanceMeters(a: Position, b: Position): number {
  const p1 = a[1] * RAD, p2 = b[1] * RAD;
  const dLat = (b[1] - a[1]) * RAD, dLon = (b[0] - a[0]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

function roadSpeed(road: RoadInput): number {
  const raw = Number.parseFloat((road.maxspeed || '').replace(',', '.'));
  if (Number.isFinite(raw) && raw >= 5 && raw <= 160) return raw;
  const defaults: Record<string, number> = {
    motorway: 100, trunk: 80, primary: 60, secondary: 50, tertiary: 40,
    unclassified: 30, residential: 30, living_street: 10, service: 15,
    motorway_link: 40, trunk_link: 35, primary_link: 30, secondary_link: 25, tertiary_link: 25,
    busway: 30, road: 30
  };
  return defaults[road.highway] || 25;
}
function laneCount(road: RoadInput): number {
  const directionalTotal = Number.parseInt(road.lanesForward || '', 10) + Number.parseInt(road.lanesBackward || '', 10);
  if (Number.isFinite(directionalTotal) && directionalTotal >= 1 && directionalTotal <= 12) return directionalTotal;
  const parsed = Number.parseInt(road.lanes || '', 10);
  if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 12) return parsed;
  if (road.highway === 'motorway' || road.highway === 'trunk') return 2;
  if (road.highway === 'primary' || road.highway === 'secondary') return 2;
  return 1;
}
function directionalLaneCounts(road: RoadInput): { forward: number; backward: number } {
  const parse = (value?: string): number | null => {
    const result = Number.parseInt(value || '', 10);
    return Number.isFinite(result) && result >= 1 && result <= 12 ? result : null;
  };
  const total = laneCount(road);
  const forward = parse(road.lanesForward), backward = parse(road.lanesBackward);
  const reverseOnly = (road.oneway || '').toLowerCase() === '-1';
  if (isOneway(road)) return reverseOnly ? { forward: 0, backward: backward ?? total } : { forward: forward ?? total, backward: 0 };
  if (forward !== null && backward !== null) return { forward, backward };
  if (forward !== null) return { forward, backward: Math.max(1, total - forward) };
  if (backward !== null) return { forward: Math.max(1, total - backward), backward };
  return { forward: Math.max(1, Math.ceil(total / 2)), backward: Math.max(1, Math.floor(total / 2)) };
}
function isOneway(road: RoadInput): boolean {
  return ['yes', '1', 'true', '-1'].includes((road.oneway || '').toLowerCase()) ||
    road.junction === 'roundabout' || road.highway === 'motorway';
}
function offsetLine(points: Position[], offsetMeters: number): Position[] {
  if (points.length < 2 || Math.abs(offsetMeters) < 0.02) return points;
  return points.map((point, index) => {
    const before = points[Math.max(0, index - 1)], after = points[Math.min(points.length - 1, index + 1)];
    const cos = Math.max(0.15, Math.cos(point[1] * RAD));
    const dx = (after[0] - before[0]) * 111320 * cos;
    const dy = (after[1] - before[1]) * 110540;
    const length = Math.hypot(dx, dy) || 1;
    return [
      point[0] - (dy / length) * offsetMeters / (111320 * cos),
      point[1] + (dx / length) * offsetMeters / 110540
    ];
  });
}
function keyFor(point: Position, ref?: number): string {
  if (ref !== undefined && Number.isFinite(ref)) return 'n' + ref;
  // Fallback only for incomplete geometry responses; quantization is about 1.1 m.
  return 'g' + Math.round(point[0] * 1e5) + ':' + Math.round(point[1] * 1e5);
}

/** Build a directed street graph. OSM node references take precedence over coordinate snapping. */
export function buildRoadNetwork(roads: RoadInput[]): RoadNetwork {
  const nodeMap = new Map<string, { coordinate: Position; roadIds: Set<number>; neighbours: Set<string> }>();
  const edges: NetworkEdge[] = [];
  const laneLines: RoadNetwork['laneLines'] = [];
  const validRoads = roads.filter((road) => road.coordinates.length >= 2);
  const addNode = (id: string, coordinate: Position, roadId: number) => {
    let node = nodeMap.get(id);
    if (!node) { node = { coordinate, roadIds: new Set(), neighbours: new Set() }; nodeMap.set(id, node); }
    node.roadIds.add(roadId);
    return node;
  };
  for (const road of validRoads) {
    const coords = road.coordinates;
    const refs = road.nodeRefs && road.nodeRefs.length === coords.length ? road.nodeRefs : [];
    const ids = coords.map((point, i) => keyFor(point, refs[i]));
    ids.forEach((id, i) => addNode(id, coords[i], road.id));
    const lanes = laneCount(road);
    const directional = directionalLaneCounts(road);
    const oneWay = isOneway(road);
    const reverseOnly = (road.oneway || '').toLowerCase() === '-1';
    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i], b = coords[i + 1], from = ids[i], to = ids[i + 1];
      const length = distanceMeters(a, b);
      if (length < 0.3) continue;
      nodeMap.get(from)!.neighbours.add(to);
      nodeMap.get(to)!.neighbours.add(from);
      const forwardLanes = directional.forward;
      const reverseLanes = directional.backward;
      const edgeId = road.id + ':' + i;
      if (!reverseOnly) edges.push({ id: edgeId + ':f', from, to, roadId: road.id, roadName: road.name, roadClass: road.highway, direction: 1, lanes: forwardLanes, speedKmh: roadSpeed(road), lengthMeters: length, geometry: [a, b], oneWay });
      if (!oneWay || reverseOnly) edges.push({ id: edgeId + ':r', from: to, to: from, roadId: road.id, roadName: road.name, roadClass: road.highway, direction: -1, lanes: reverseOnly ? lanes : reverseLanes, speedKmh: roadSpeed(road), lengthMeters: length, geometry: [b, a], oneWay });
    }
    // Render each mapped lane as a separate centerline. Missing OSM lane tags are estimates, not survey data.
    const forwardLanes = directional.forward;
    const reverseLanes = directional.backward;
    const total = forwardLanes + reverseLanes;
    for (let lane = 0; lane < total; lane++) {
      const reverse = reverseOnly || (!oneWay && lane >= forwardLanes);
      const localIndex = reverse ? lane - forwardLanes : lane;
      const count = reverse ? reverseLanes : forwardLanes;
      const signedOffset = oneWay ? (localIndex - (count - 1) / 2) * 3.25 : -((count / 2) - localIndex - 0.5) * 3.25;
      const geometry = offsetLine(reverse ? [...coords].reverse() : coords, signedOffset);
      laneLines.push({ id: road.id + ':lane:' + lane, roadId: road.id, laneIndex: lane, direction: reverse ? -1 : 1, geometry });
    }
  }
  const nodes: NetworkNode[] = Array.from(nodeMap.entries()).map(([id, node]) => ({
    id, coordinate: node.coordinate, roadIds: Array.from(node.roadIds), degree: node.neighbours.size,
    intersection: node.neighbours.size >= 3
  }));
  const adjacency = new Map<string, Set<string>>();
  for (const node of nodes) adjacency.set(node.id, new Set());
  for (const edge of edges) { adjacency.get(edge.from)?.add(edge.to); adjacency.get(edge.to)?.add(edge.from); }
  const componentsSeen = new Set<string>();
  let connectedComponents = 0;
  for (const node of nodes) {
    if (componentsSeen.has(node.id)) continue;
    connectedComponents += 1;
    const stack = [node.id]; componentsSeen.add(node.id);
    while (stack.length) {
      const current = stack.pop()!;
      for (const next of adjacency.get(current) || []) {
        if (!componentsSeen.has(next)) { componentsSeen.add(next); stack.push(next); }
      }
    }
  }
  const intersections = nodes.filter((node) => node.intersection);
  return {
    nodes, edges, intersections, laneLines,
    stats: { roads: validRoads.length, nodes: nodes.length, intersections: intersections.length, directedEdges: edges.length, laneCount: laneLines.length, connectedComponents }
  };
}

export function networkNodeCollection(network: RoadNetwork) {
  return {
    type: 'FeatureCollection' as const,
    features: network.nodes.map((node) => ({
      type: 'Feature' as const, id: node.id,
      geometry: { type: 'Point' as const, coordinates: node.coordinate },
      properties: { id: node.id, degree: node.degree, intersection: node.intersection, roads: node.roadIds.length }
    }))
  };
}
export function laneLineCollection(network: RoadNetwork) {
  return {
    type: 'FeatureCollection' as const,
    features: network.laneLines.map((lane) => ({
      type: 'Feature' as const, id: lane.id,
      geometry: { type: 'LineString' as const, coordinates: lane.geometry },
      properties: { id: lane.id, roadId: lane.roadId, laneIndex: lane.laneIndex, direction: lane.direction }
    }))
  };
}

export function routeLengthMeters(route: Position[]): number {
  let total = 0;
  for (let i = 1; i < route.length; i++) total += distanceMeters(route[i - 1], route[i]);
  return total;
}

/** Find a directed cycle in the imported street graph so demo vehicles can follow real street geometry. */
export function buildClosedSimulationRoute(network: RoadNetwork): Position[] | null {
  if (network.edges.length < 3) return null;
  const outgoing = new Map<string, NetworkEdge[]>();
  for (const edge of network.edges) {
    const list = outgoing.get(edge.from) || [];
    list.push(edge);
    outgoing.set(edge.from, list);
  }
  let best: Position[] | null = null;
  let bestLength = 0;
  const candidates = network.edges.slice(0, Math.min(180, network.edges.length));
  for (const first of candidates) {
    const baseId = first.id.replace(/:[fr]$/, '');
    const queue = [first.to];
    const previous = new Map<string, NetworkEdge | null>([[first.to, null]]);
    let cursor = 0;
    while (cursor < queue.length && !previous.has(first.from)) {
      const current = queue[cursor++];
      for (const edge of outgoing.get(current) || []) {
        if (edge.id.replace(/:[fr]$/, '') === baseId || previous.has(edge.to)) continue;
        previous.set(edge.to, edge);
        queue.push(edge.to);
        if (edge.to === first.from) break;
      }
    }
    if (!previous.has(first.from)) continue;
    const tail: NetworkEdge[] = [];
    let node = first.from;
    while (node !== first.to) {
      const edge = previous.get(node);
      if (!edge) { tail.length = 0; break; }
      tail.push(edge);
      node = edge.from;
    }
    if (!tail.length) continue;
    tail.reverse();
    const route: Position[] = [...first.geometry];
    for (const edge of tail) route.push(...edge.geometry.slice(1));
    if (route.length < 4) continue;
    const length = routeLengthMeters(route);
    if (length > bestLength && length >= 250 && length <= 12000) {
      best = route;
      bestLength = length;
    }
  }
  return best;
}
