import type { Position } from './traffic';

export type RoadInput = {
  id: number;
  name: string;
  highway: string;
  coordinates: Position[];
  nodeRefs?: number[];
  lanes?: string;
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
  const parsed = Number.parseInt(road.lanes || '', 10);
  if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 12) return parsed;
  if (road.highway === 'motorway' || road.highway === 'trunk') return 2;
  if (road.highway === 'primary' || road.highway === 'secondary') return 2;
  return 1;
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
    const oneWay = isOneway(road);
    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i], b = coords[i + 1], from = ids[i], to = ids[i + 1];
      const length = distanceMeters(a, b);
      if (length < 0.3) continue;
      nodeMap.get(from)!.neighbours.add(to);
      nodeMap.get(to)!.neighbours.add(from);
      const forwardLanes = oneWay ? lanes : Math.max(1, Math.ceil(lanes / 2));
      const reverseLanes = oneWay ? 0 : Math.max(1, Math.floor(lanes / 2));
      const edgeId = road.id + ':' + i;
      edges.push({ id: edgeId + ':f', from, to, roadId: road.id, roadName: road.name, roadClass: road.highway, direction: 1, lanes: forwardLanes, speedKmh: roadSpeed(road), lengthMeters: length, geometry: [a, b], oneWay });
      if (!oneWay) edges.push({ id: edgeId + ':r', from: to, to: from, roadId: road.id, roadName: road.name, roadClass: road.highway, direction: -1, lanes: reverseLanes, speedKmh: roadSpeed(road), lengthMeters: length, geometry: [b, a], oneWay });
    }
    // Render each mapped lane as a separate centerline. Missing OSM lane tags are estimates, not survey data.
    const forwardLanes = oneWay ? lanes : Math.max(1, Math.ceil(lanes / 2));
    const reverseLanes = oneWay ? 0 : Math.max(1, Math.floor(lanes / 2));
    const total = forwardLanes + reverseLanes;
    for (let lane = 0; lane < total; lane++) {
      const reverse = !oneWay && lane >= forwardLanes;
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
