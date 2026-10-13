export type Position = [number, number];
export type SignalPhase = 'red' | 'green' | null;

export type ScenarioSignal = {
  id: string;
  name: string;
  coordinates: Position;
  progress: number;
  cycleSeconds: number;
  greenShare: number;
  offsetSeconds: number;
  manualState: SignalPhase;
  connectedToDemoRoute: boolean;
};

export type Vehicle = {
  id: number;
  progress: number;
  speedKmh: number;
  stopped: boolean;
  waitSeconds: number;
};

export type TrafficState = {
  time: number;
  completedTrips: number;
  totalWaitSeconds: number;
  vehicles: Vehicle[];
};

export const DEMO_ROUTE: Position[] = [
  [49.8568, 40.3782],
  [49.8602, 40.3801],
  [49.8647, 40.3832],
  [49.8691, 40.3864],
  [49.8731, 40.3892],
  [49.8760, 40.3921],
  [49.8751, 40.3961],
  [49.8715, 40.3990],
  [49.8670, 40.3972],
  [49.8637, 40.3939],
  [49.8601, 40.3900],
  [49.8577, 40.3846],
  [49.8568, 40.3782],
];

function distanceMeters(a: Position, b: Position): number {
  const rad = Math.PI / 180;
  const lat1 = a[1] * rad;
  const lat2 = b[1] * rad;
  const dLat = (b[1] - a[1]) * rad;
  const dLng = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

function routeLengths(route: Position[]) {
  const lengths: number[] = [];
  let total = 0;
  for (let i = 0; i < route.length - 1; i += 1) {
    const length = distanceMeters(route[i], route[i + 1]);
    lengths.push(length);
    total += length;
  }
  return { lengths, total: total || 1 };
}

export function pointAtProgress(route: Position[], progress: number): Position {
  const p = ((progress % 1) + 1) % 1;
  const data = routeLengths(route);
  let target = p * data.total;
  for (let i = 0; i < data.lengths.length; i += 1) {
    const segmentLength = data.lengths[i];
    if (target <= segmentLength || i === data.lengths.length - 1) {
      const ratio = segmentLength > 0 ? target / segmentLength : 0;
      const a = route[i];
      const b = route[i + 1];
      return [a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio];
    }
    target -= segmentLength;
  }
  return route[0];
}

export function progressForCoordinate(route: Position[], point: Position): number {
  const data = routeLengths(route);
  let cumulative = 0;
  let closestProgress = 0;
  let closestDistance = Infinity;
  for (let i = 0; i < route.length - 1; i += 1) {
    const a = route[i];
    const b = route[i + 1];
    const midLat = (a[1] + b[1] + point[1]) / 3;
    const xScale = Math.cos((midLat * Math.PI) / 180);
    const ax = a[0] * xScale;
    const ay = a[1];
    const bx = b[0] * xScale;
    const by = b[1];
    const px = point[0] * xScale;
    const py = point[1];
    const dx = bx - ax;
    const dy = by - ay;
    const denominator = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / denominator));
    const dist = Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
    if (dist < closestDistance) {
      closestDistance = dist;
      closestProgress = (cumulative + data.lengths[i] * t) / data.total;
    }
    cumulative += data.lengths[i];
  }
  return closestProgress;
}

export function distanceToRouteMeters(route: Position[], point: Position): number {
  return distanceMeters(point, pointAtProgress(route, progressForCoordinate(route, point)));
}

export function isSignalRed(signal: ScenarioSignal, time: number): boolean {
  if (signal.manualState === 'red') return true;
  if (signal.manualState === 'green') return false;
  const cycle = Math.max(20, Number(signal.cycleSeconds) || 80);
  const greenShare = Math.min(0.85, Math.max(0.25, Number(signal.greenShare) || 0.58));
  const offset = Number(signal.offsetSeconds) || 0;
  const phase = ((time + offset) % cycle + cycle) % cycle;
  return phase >= cycle * greenShare;
}

export function createTrafficState(count = 18): TrafficState {
  const safeCount = Math.max(1, Math.min(100, Math.floor(count)));
  return {
    time: 0,
    completedTrips: 0,
    totalWaitSeconds: 0,
    vehicles: Array.from({ length: safeCount }, (_, index) => ({
      id: index + 1,
      progress: ((index + 0.35) / safeCount) % 1,
      speedKmh: 0,
      stopped: false,
      waitSeconds: 0,
    })),
  };
}

export function advanceTraffic(
  state: TrafficState,
  signals: ScenarioSignal[],
  speedLimitKmh: number,
  deltaSeconds: number,
): TrafficState {
  const dt = Math.max(0, Math.min(1, Number(deltaSeconds) || 0));
  const speedLimit = Math.max(10, Math.min(100, Number(speedLimitKmh) || 40));
  const nextTime = state.time + dt;
  const ordered = [...state.vehicles].sort((a, b) => a.progress - b.progress);
  let completedTrips = state.completedTrips;
  let totalWaitSeconds = state.totalWaitSeconds;

  const vehicles = ordered.map((vehicle, index) => {
    const leader = ordered[(index + 1) % ordered.length];
    const gap = leader.id === vehicle.id ? 1 : (leader.progress - vehicle.progress + 1) % 1;
    let speed = speedLimit * 0.72;
    let stopped = false;

    if (leader.id !== vehicle.id && gap < 0.0068) {
      speed *= Math.max(0, gap / 0.0068);
      if (gap < 0.0028) stopped = true;
    }

    for (const signal of signals) {
      if (!signal.connectedToDemoRoute || !isSignalRed(signal, nextTime)) continue;
      const ahead = (signal.progress - vehicle.progress + 1) % 1;
      if (ahead < 0.010 && ahead > 0.0005) {
        speed = 0;
        stopped = true;
        break;
      }
    }

    const nextProgressRaw = vehicle.progress + ((speed / 3600) / 2.6) * dt;
    if (nextProgressRaw >= 1) completedTrips += 1;
    if (stopped) totalWaitSeconds += dt;
    return {
      ...vehicle,
      progress: nextProgressRaw % 1,
      speedKmh: stopped ? 0 : speed,
      stopped,
      waitSeconds: vehicle.waitSeconds + (stopped ? dt : 0),
    };
  });

  return { time: nextTime, completedTrips, totalWaitSeconds, vehicles };
}