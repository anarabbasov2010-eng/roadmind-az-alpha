import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap, type MapMouseEvent } from 'maplibre-gl';
import {
  Activity, AlertTriangle, ArrowLeft, ArrowRight, Building2, CarFront, Check,
  ChevronDown, CircleHelp, Clock3, Compass, Download, Eraser, Eye, Gauge,
  GitCompareArrows, Layers3, LocateFixed, Map as MapIcon, Minus, Pause, Play,
  Plus, RadioTower, RefreshCw, RotateCcw, Save, Search, Settings2, TrafficCone,
  Waypoints, X, ZoomIn, ZoomOut
} from 'lucide-react';
import {
  advanceTraffic, createTrafficState, DEMO_ROUTE, distanceToRouteMeters, isSignalRed,
  pointAtProgress, progressForCoordinate, type Position, type ScenarioSignal,
  type TrafficState
} from './traffic';

type ToolMode = 'select' | 'signal' | 'road' | 'erase';
type RoadDraft = { id: string; name: string; coordinates: Position[]; lanes: number };
type OSMRoad = { id: number; name: string; highway: string; coordinates: Position[]; lanes?: string; maxspeed?: string; oneway?: string };
type OSMSignal = { id: number; name: string; coordinates: Position[]; direction?: string };
type GeoFeature = {
  type: 'Feature';
  id?: string | number;
  geometry: { type: 'Point'; coordinates: Position } | { type: 'LineString'; coordinates: Position[] };
  properties: Record<string, string | number | boolean | null>;
};
type FeatureCollection = { type: 'FeatureCollection'; features: GeoFeature[] };
type ScenarioSnapshot = { schemaVersion: 2; name: string; savedAt: string; speedLimit: number; signals: ScenarioSignal[]; roads: RoadDraft[] };
type TrafficMetrics = { averageSpeed: number; stopped: number; queueMeters: number; delaySeconds: number; throughput: number };

const STORAGE_KEY = 'roadmind-az-scenario-v2';
const BAKU: Position = [49.8672, 40.3893];
const AZERBAIJAN: Position = [47.58, 40.42];
const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] };
const RED = '#e66d64';
const GREEN = '#5fc2a9';

function initialSignals(): ScenarioSignal[] {
  const point = pointAtProgress(DEMO_ROUTE, 0.275);
  return [{
    id: 'signal-demo-01', name: 'Демонстрационный светофор',
    coordinates: point, progress: 0.275, cycleSeconds: 80, greenShare: 0.58,
    offsetSeconds: 8, manualState: null, connectedToDemoRoute: true
  }];
}

function safeScenario(): Partial<ScenarioSnapshot> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return parsed && parsed.schemaVersion === 2 ? parsed : {};
  } catch { return {}; }
}

function emptyCollection(): FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

function signalCollection(signals: ScenarioSignal[], time: number): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: signals.map((signal) => ({
      type: 'Feature', id: signal.id,
      geometry: { type: 'Point', coordinates: signal.coordinates },
      properties: {
        id: signal.id, name: signal.name,
        state: isSignalRed(signal, time) ? 'red' : 'green',
        connected: signal.connectedToDemoRoute,
        manual: signal.manualState !== null
      }
    }))
  };
}

function roadCollection(roads: RoadDraft[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: roads.map((road) => ({
      type: 'Feature', id: road.id, geometry: { type: 'LineString', coordinates: road.coordinates },
      properties: { id: road.id, name: road.name, lanes: road.lanes }
    }))
  };
}

function carIcon(color: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 48; canvas.height = 28;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.fillStyle = '#101716';
  ctx.beginPath(); ctx.roundRect(5, 2, 38, 24, 7); ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.roundRect(8, 1, 32, 25, 6); ctx.fill();
  ctx.fillStyle = '#e1efea';
  ctx.beginPath(); ctx.roundRect(13, 5, 22, 6, 2); ctx.fill();
  ctx.fillStyle = '#9bbdb5';
  ctx.beginPath(); ctx.roundRect(13, 16, 22, 5, 2); ctx.fill();
  ctx.fillStyle = '#13201e';
  ctx.fillRect(4, 6, 5, 5); ctx.fillRect(39, 6, 5, 5); ctx.fillRect(4, 18, 5, 5); ctx.fillRect(39, 18, 5, 5);
  return canvas;
}

function carsCollection(state: TrafficState): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: state.vehicles.map((vehicle) => {
      const point = pointAtProgress(DEMO_ROUTE, vehicle.progress);
      const next = pointAtProgress(DEMO_ROUTE, (vehicle.progress + 0.001) % 1);
      const bearing = Math.atan2(next[0] - point[0], next[1] - point[1]) * 180 / Math.PI;
      return {
        type: 'Feature', id: vehicle.id, geometry: { type: 'Point', coordinates: point },
        properties: { id: vehicle.id, bearing, stopped: vehicle.stopped, icon: vehicle.id % 5 === 0 ? 'rm-car-amber' : 'rm-car' }
      };
    })
  };
}

function importedRoadCollection(roads: OSMRoad[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: roads.map((road) => ({
      type: 'Feature', id: road.id, geometry: { type: 'LineString', coordinates: road.coordinates },
      properties: { id: road.id, name: road.name, highway: road.highway, roadClass: road.highway, lanes: road.lanes || '', maxspeed: road.maxspeed || '', oneway: road.oneway || '' }
    }))
  };
}

function importedSignalCollection(signals: OSMSignal[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: signals.map((signal) => ({
      type: 'Feature', id: signal.id, geometry: { type: 'Point', coordinates: signal.coordinates },
      properties: { id: signal.id, name: signal.name, direction: signal.direction || '' }
    }))
  };
}

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
}
function formatTime(date: Date | null): string {
  if (!date) return 'нет данных';
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}
function metricsFor(state: TrafficState): TrafficMetrics {
  const count = Math.max(1, state.vehicles.length);
  const stopped = state.vehicles.filter((vehicle) => vehicle.stopped).length;
  const averageSpeed = state.vehicles.reduce((total, vehicle) => total + vehicle.speedKmh, 0) / count;
  const hours = Math.max(1 / 3600, state.time / 3600);
  return {
    averageSpeed: Math.round(averageSpeed),
    stopped,
    queueMeters: Math.round(stopped * 6.5),
    delaySeconds: Math.round(state.totalWaitSeconds / count),
    throughput: Math.round(state.completedTrips / hours)
  };
}

function addMapLayers(map: MapLibreMap, signals: ScenarioSignal[]) {
  const labelLayer = map.getStyle().layers?.find((layer) =>
    layer.type === 'symbol' && Boolean(layer.layout && 'text-field' in layer.layout)
  )?.id;

  if (!map.getSource('rm-buildings')) {
    map.addSource('rm-buildings', { type: 'vector', url: 'https://tiles.openfreemap.org/planet' });
  }
  if (!map.getLayer('rm-3d-buildings')) {
    map.addLayer({
      id: 'rm-3d-buildings', type: 'fill-extrusion', source: 'rm-buildings', 'source-layer': 'building', minzoom: 14,
      filter: ['!=', ['get', 'hide_3d'], true],
      paint: {
        'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 12], 0, '#334340', 45, '#5a6c66', 160, '#82918a'],
        'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.5, ['coalesce', ['get', 'render_height'], ['get', 'height'], 12]],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
        'fill-extrusion-opacity': 0.85
      }
    }, labelLayer);
  }

  map.addSource('rm-demo-route', { type: 'geojson', data: {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: DEMO_ROUTE }, properties: { label: 'Схематический тестовый маршрут' } }]
  } as never });
  map.addLayer({ id: 'rm-demo-casing', type: 'line', source: 'rm-demo-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#13211f', 'line-width': 9, 'line-opacity': 0.72 } });
  map.addLayer({ id: 'rm-demo-line', type: 'line', source: 'rm-demo-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': GREEN, 'line-width': 2.6, 'line-opacity': 0.94, 'line-dasharray': [2, 1.5] } });

  map.addSource('rm-osm-roads', { type: 'geojson', data: emptyCollection() as never });
  map.addLayer({
    id: 'rm-osm-roads-line', type: 'line', source: 'rm-osm-roads',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['match', ['get', 'roadClass'], 'motorway', '#d4ac76', 'trunk', '#d4ac76', 'primary', '#e2bd86', 'secondary', '#9cbbb2', 'tertiary', '#7d9a91', '#61766f'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.7, 14, 2, 18, 4.2],
      'line-opacity': 0.88
    }
  });

  map.addSource('rm-osm-signals', { type: 'geojson', data: emptyCollection() as never });
  map.addLayer({ id: 'rm-osm-signal-halo', type: 'circle', source: 'rm-osm-signals', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 4, 17, 9], 'circle-color': '#e2b879', 'circle-opacity': 0.17, 'circle-blur': 0.25 } });
  map.addLayer({ id: 'rm-osm-signal-points', type: 'circle', source: 'rm-osm-signals', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2.5, 17, 5.5], 'circle-color': '#e2b879', 'circle-stroke-color': '#252d29', 'circle-stroke-width': 1.5 } });

  map.addSource('rm-user-roads', { type: 'geojson', data: emptyCollection() as never });
  map.addLayer({ id: 'rm-user-road-line', type: 'line', source: 'rm-user-roads', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#f0c17e', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2.5, 18, 5.5], 'line-opacity': 0.98 } });

  map.addSource('rm-user-signals', { type: 'geojson', data: signalCollection(signals, 0) as never });
  map.addLayer({ id: 'rm-user-signal-halo', type: 'circle', source: 'rm-user-signals', paint: { 'circle-radius': 15, 'circle-color': ['match', ['get', 'state'], 'red', RED, GREEN], 'circle-opacity': 0.16, 'circle-blur': 0.4 } });
  map.addLayer({ id: 'rm-user-signal-points', type: 'circle', source: 'rm-user-signals', paint: { 'circle-radius': 6.2, 'circle-color': ['match', ['get', 'state'], 'red', RED, GREEN], 'circle-stroke-color': '#f0f2ea', 'circle-stroke-width': 1.8 } });
  map.addLayer({ id: 'rm-user-signal-label', type: 'symbol', source: 'rm-user-signals', layout: { 'text-field': 'S', 'text-font': ['Open Sans Bold'], 'text-size': 9, 'text-offset': [0, 0.05], 'text-allow-overlap': true }, paint: { 'text-color': '#15201d' } });

  map.addSource('rm-vehicles', { type: 'geojson', data: carsCollection(createTrafficState()) as never });
  map.addImage('rm-car', carIcon('#63bdae'), { pixelRatio: 2 });
  map.addImage('rm-car-amber', carIcon('#dbb47a'), { pixelRatio: 2 });
  map.addLayer({
    id: 'rm-vehicles-layer', type: 'symbol', source: 'rm-vehicles',
    layout: { 'icon-image': ['get', 'icon'], 'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.35, 15, 0.65, 19, 0.95], 'icon-rotate': ['get', 'bearing'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true },
    paint: { 'icon-opacity': ['case', ['get', 'stopped'], 0.74, 1] }
  });

  map.addSource('rm-saved-roads', { type: 'geojson', data: roadCollection([]) as never });
}

export default function App() {
  const stored = useMemo(safeScenario, []);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const modeRef = useRef<ToolMode>('select');
  const pendingRoadRef = useRef<Position | null>(null);
  const lastRequestAtRef = useRef(0);
  const lastSyncCenterRef = useRef<Position | null>(null);
  const lastAutoTimerRef = useRef<number | null>(null);
  const syncOsmRef = useRef<((automatic?: boolean) => void) | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const signalsRef = useRef<ScenarioSignal[]>(stored.signals || initialSignals());
  const roadsRef = useRef<RoadDraft[]>(stored.roads || []);
  const trafficRef = useRef<TrafficState>(createTrafficState());

  const [mode, setMode] = useState<ToolMode>('select');
  const [signals, setSignals] = useState<ScenarioSignal[]>(stored.signals || initialSignals());
  const [roads, setRoads] = useState<RoadDraft[]>(stored.roads || []);
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>((stored.signals || initialSignals())[0]?.id || null);
  const [selectedRoadId, setSelectedRoadId] = useState<string | null>(null);
  const [is3D, setIs3D] = useState(true);
  const [isRunning, setIsRunning] = useState(true);
  const [speedMultiplier, setSpeedMultiplier] = useState(1);
  const [speedLimit, setSpeedLimit] = useState(40);
  const [traffic, setTraffic] = useState<TrafficState>(() => createTrafficState());
  const [osmRoads, setOsmRoads] = useState<OSMRoad[]>([]);
  const [osmSignals, setOsmSignals] = useState<OSMSignal[]>([]);
  const [osmBusy, setOsmBusy] = useState(false);
  const [osmUpdatedAt, setOsmUpdatedAt] = useState<Date | null>(null);
  const [osmStatus, setOsmStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [mapStatus, setMapStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [mapZoom, setMapZoom] = useState(12.8);
  const [scenarioName, setScenarioName] = useState(stored.name || 'Баку · центральный узел');
  const [showOsmRoads, setShowOsmRoads] = useState(true);
  const [showOsmSignals, setShowOsmSignals] = useState(true);
  const [showDemo, setShowDemo] = useState(true);
  const [showCars, setShowCars] = useState(true);
  const [showUserSignals, setShowUserSignals] = useState(true);
  const [showBuildings, setShowBuildings] = useState(true);
  const [toast, setToast] = useState('');
  const [comparison, setComparison] = useState<{ baseline: TrafficMetrics; current: TrafficMetrics } | null>(null);
  const [isComparing, setIsComparing] = useState(false);
  const [showDataNotice, setShowDataNotice] = useState(true);
  const [history, setHistory] = useState<number[]>([]);

  const selectedSignal = signals.find((signal) => signal.id === selectedSignalId) || null;
  const selectedRoad = roads.find((road) => road.id === selectedRoadId) || null;
  const metrics = useMemo(() => metricsFor(traffic), [traffic]);
  const speedDelta = comparison ? comparison.current.averageSpeed - comparison.baseline.averageSpeed : null;
  const queueDelta = comparison ? comparison.baseline.queueMeters - comparison.current.queueMeters : null;

  const flashToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(''), 3200);
  }, []);

  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { signalsRef.current = signals; }, [signals]);
  useEffect(() => { roadsRef.current = roads; }, [roads]);
  useEffect(() => { trafficRef.current = traffic; }, [traffic]);

  const syncOsm = useCallback(async (automatic = false) => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    if (map.getZoom() < 11.5) {
      if (!automatic) flashToast('Приблизьте карту до уровня района, чтобы загружать дорожные данные.');
      return;
    }
    const now = Date.now();
    const minimumWait = automatic ? 120000 : 45000;
    if (now - lastRequestAtRef.current < minimumWait) {
      if (!automatic) flashToast('Обновление ограничено, чтобы не перегружать общий сервер OpenStreetMap.');
      return;
    }
    const center = map.getCenter();
    if (automatic && lastSyncCenterRef.current) {
      const moved = Math.hypot(center.lng - lastSyncCenterRef.current[0], center.lat - lastSyncCenterRef.current[1]);
      if (moved < 0.008) return;
    }
    lastRequestAtRef.current = now;
    lastSyncCenterRef.current = [center.lng, center.lat];
    setOsmBusy(true);
    setOsmStatus('loading');
    try {
      const halfLat = 0.022;
      const halfLon = 0.027;
      const south = (center.lat - halfLat).toFixed(5);
      const west = (center.lng - halfLon).toFixed(5);
      const north = (center.lat + halfLat).toFixed(5);
      const east = (center.lng + halfLon).toFixed(5);
      const query = '[out:json][timeout:25];(' +
        'way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"](' + south + ',' + west + ',' + north + ',' + east + ');' +
        'node["highway"="traffic_signals"](' + south + ',' + west + ',' + north + ',' + east + ');' +
        ');out geom;';
      const endpoints = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
      let payload: { elements?: Array<{ type: string; id: number; tags?: Record<string, string>; geometry?: Array<{ lon: number; lat: number }>; lat?: number; lon?: number }> } | null = null;
      let lastError: Error | null = null;
      for (const endpoint of endpoints) {
        try {
          const response = await fetch(endpoint + '?data=' + encodeURIComponent(query), { signal: AbortSignal.timeout(28000) });
          if (!response.ok) throw new Error('Overpass HTTP ' + response.status);
          payload = await response.json();
          break;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error('Неизвестная ошибка запроса');
          if (/429|too many requests/i.test(lastError.message)) break;
        }
      }
      if (!payload || !Array.isArray(payload.elements)) throw lastError || new Error('Пустой ответ OpenStreetMap');
      const parsedRoads: OSMRoad[] = [];
      const parsedSignals: OSMSignal[] = [];
      for (const element of payload.elements) {
        if (element.type === 'way' && element.geometry && element.geometry.length > 1 && element.tags?.highway) {
          parsedRoads.push({
            id: element.id, name: element.tags.name || element.tags.ref || element.tags.highway,
            highway: element.tags.highway,
            coordinates: element.geometry.map((point) => [point.lon, point.lat] as Position),
            lanes: element.tags.lanes, maxspeed: element.tags.maxspeed, oneway: element.tags.oneway
          });
        }
        if (element.type === 'node' && element.tags?.highway === 'traffic_signals' && Number.isFinite(element.lat) && Number.isFinite(element.lon)) {
          parsedSignals.push({
            id: element.id, name: element.tags.name || 'Светофор из OSM',
            coordinates: [element.lon as number, element.lat as number] as Position,
            direction: element.tags.direction
          });
        }
      }
      const roadsCapped = parsedRoads.slice(0, 2200);
      const signalsCapped = parsedSignals.slice(0, 900);
      setOsmRoads(roadsCapped);
      setOsmSignals(signalsCapped);
      setOsmUpdatedAt(new Date());
      setOsmStatus('ok');
      setShowOsmRoads(true);
      setShowOsmSignals(true);
      const roadSource = map.getSource('rm-osm-roads') as GeoJSONSource | undefined;
      roadSource?.setData(importedRoadCollection(roadsCapped) as never);
      const signalSource = map.getSource('rm-osm-signals') as GeoJSONSource | undefined;
      signalSource?.setData(importedSignalCollection(signalsCapped) as never);
      if (!automatic) flashToast('OpenStreetMap: ' + roadsCapped.length + ' дорог и ' + signalsCapped.length + ' отмеченных светофоров загружено.');
    } catch (error) {
      setOsmStatus('error');
      if (!automatic) flashToast('Не удалось обновить OSM. Проверьте интернет или повторите позже.');
      console.warn('RoadMind OSM import failed:', error);
    } finally {
      setOsmBusy(false);
    }
  }, [flashToast]);
  syncOsmRef.current = syncOsm;

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container || mapRef.current) return;
    const map = new maplibregl.Map({
      container,
      style: 'https://tiles.openfreemap.org/styles/dark',
      center: BAKU,
      zoom: 12.8,
      pitch: 42,
      bearing: 0,
      minZoom: 4.5,
      maxZoom: 21,
      maxPitch: 62,
      zoomSnap: 0,
      fadeDuration: 140,
      refreshExpiredTiles: true,
      renderWorldCopies: false,
      attributionControl: false,
      canvasContextAttributes: { antialias: false, powerPreference: 'high-performance' }
    });
    mapRef.current = map;
    map.scrollZoom.setWheelZoomRate(1 / 650);
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: 'metric' }), 'bottom-left');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    const failTimer = window.setTimeout(() => {
      if (!map.isStyleLoaded()) setMapStatus('error');
    }, 15000);
    map.on('load', () => {
      window.clearTimeout(failTimer);
      try {
        addMapLayers(map, signalsRef.current);
        (map.getSource('rm-user-signals') as GeoJSONSource).setData(signalCollection(signalsRef.current, trafficRef.current.time) as never);
        (map.getSource('rm-user-roads') as GeoJSONSource).setData(roadCollection(roadsRef.current) as never);
        (map.getSource('rm-vehicles') as GeoJSONSource).setData(carsCollection(trafficRef.current) as never);
        setMapStatus('ready');
        window.setTimeout(() => syncOsmRef.current?.(true), 900);
      } catch (error) {
        console.error('Could not initialize RoadMind layers:', error);
        setMapStatus('error');
      }
    });
    map.on('zoomend', () => setMapZoom(map.getZoom()));
    map.on('error', (event) => console.debug('Map service event:', event.error?.message || ''));
    map.on('moveend', () => {
      if (map.getZoom() < 12.5 || osmBusy) return;
      if (lastAutoTimerRef.current !== null) window.clearTimeout(lastAutoTimerRef.current);
      lastAutoTimerRef.current = window.setTimeout(() => syncOsmRef.current?.(true), 650);
    });
    map.on('click', (event: MapMouseEvent) => {
      const activeMode = modeRef.current;
      const point: Position = [event.lngLat.lng, event.lngLat.lat];
      const hitUserSignals = map.queryRenderedFeatures(event.point, { layers: ['rm-user-signal-points'] });
      const hitUserRoads = map.queryRenderedFeatures(event.point, { layers: ['rm-user-road-line'] });
      const hitOsmSignals = map.queryRenderedFeatures(event.point, { layers: ['rm-osm-signal-points'] });
      if (activeMode === 'select' && hitUserSignals.length) {
        setSelectedSignalId(String(hitUserSignals[0].properties?.id || ''));
        setSelectedRoadId(null);
        return;
      }
      if (activeMode === 'select' && hitUserRoads.length) {
        setSelectedRoadId(String(hitUserRoads[0].properties?.id || ''));
        setSelectedSignalId(null);
        return;
      }
      if (activeMode === 'select' && hitOsmSignals.length) {
        flashToast('Светофор отмечен в OSM. Его реальные фазы не предоставляются картографическими данными.');
        return;
      }
      if (activeMode === 'signal') {
        const progress = progressForCoordinate(DEMO_ROUTE, point);
        const connected = distanceToRouteMeters(DEMO_ROUTE, point) <= 55;
        const signal: ScenarioSignal = {
          id: 'scenario-signal-' + Date.now(),
          name: 'Сценарий · светофор ' + String(signalsRef.current.length + 1).padStart(2, '0'),
          coordinates: point, progress, cycleSeconds: 80, greenShare: 0.58,
          offsetSeconds: 0, manualState: null, connectedToDemoRoute: connected
        };
        setSignals((previous) => [...previous, signal]);
        setSelectedSignalId(signal.id);
        setSelectedRoadId(null);
        setMode('select'); modeRef.current = 'select';
        flashToast(connected ? 'Светофор связан с тестовым маршрутом.' : 'Светофор создан. Он появится в сценарии, но пока не влияет на тестовый маршрут.');
        return;
      }
      if (activeMode === 'road') {
        if (!pendingRoadRef.current) {
          pendingRoadRef.current = point;
          flashToast('Начало выбрано. Щёлкните по карте, чтобы указать конец участка.');
          return;
        }
        const first = pendingRoadRef.current;
        pendingRoadRef.current = null;
        if (Math.hypot((point[0] - first[0]) * 80000, (point[1] - first[1]) * 111000) < 8) {
          flashToast('Участок слишком короткий. Выберите точки подальше друг от друга.');
          return;
        }
        const road: RoadDraft = { id: 'scenario-road-' + Date.now(), name: 'Новый участок ' + String(roadsRef.current.length + 1), coordinates: [first, point], lanes: 2 };
        setRoads((previous) => [...previous, road]);
        setSelectedRoadId(road.id);
        setSelectedSignalId(null);
        setMode('select'); modeRef.current = 'select';
        flashToast('Линия сохранена как черновик. Перед симуляцией её нужно связать с узлами дорожной сети.');
        return;
      }
      if (activeMode === 'erase') {
        if (hitUserSignals.length) {
          const id = String(hitUserSignals[0].properties?.id || '');
          setSignals((previous) => previous.filter((signal) => signal.id !== id));
          setSelectedSignalId(null);
          flashToast('Светофор сценария удалён.');
        } else if (hitUserRoads.length) {
          const id = String(hitUserRoads[0].properties?.id || '');
          setRoads((previous) => previous.filter((road) => road.id !== id));
          setSelectedRoadId(null);
          flashToast('Участок сценария удалён.');
        } else {
          flashToast('OSM-данные доступны только для просмотра. Выберите объект, созданный в сценарии.');
        }
      }
    });
    map.on('mouseenter', 'rm-user-signal-points', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'rm-user-signal-points', () => { map.getCanvas().style.cursor = modeRef.current === 'select' ? '' : 'crosshair'; });

    return () => {
      window.clearTimeout(failTimer);
      if (lastAutoTimerRef.current !== null) window.clearTimeout(lastAutoTimerRef.current);
      map.remove();
      mapRef.current = null;
    };
  }, [flashToast]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    (map.getSource('rm-user-signals') as GeoJSONSource | undefined)?.setData(signalCollection(signals, traffic.time) as never);
  }, [signals, traffic.time]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    (map.getSource('rm-user-roads') as GeoJSONSource | undefined)?.setData(roadCollection(roads) as never);
  }, [roads]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    (map.getSource('rm-vehicles') as GeoJSONSource | undefined)?.setData(carsCollection(traffic) as never);
  }, [traffic]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    const vis = (id: string, shown: boolean) => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', shown ? 'visible' : 'none'); };
    vis('rm-osm-roads-line', showOsmRoads);
    vis('rm-osm-signal-halo', showOsmSignals);
    vis('rm-osm-signal-points', showOsmSignals);
    vis('rm-demo-casing', showDemo);
    vis('rm-demo-line', showDemo);
    vis('rm-vehicles-layer', showCars);
    vis('rm-user-signal-halo', showUserSignals);
    vis('rm-user-signal-points', showUserSignals);
    vis('rm-user-signal-label', showUserSignals);
    vis('rm-3d-buildings', showBuildings && is3D);
  }, [showOsmRoads, showOsmSignals, showDemo, showCars, showUserSignals, showBuildings, is3D, mapStatus]);

  useEffect(() => {
    if (!isRunning || mapStatus !== 'ready') return;
    const timer = window.setInterval(() => {
      const next = advanceTraffic(trafficRef.current, signalsRef.current, speedLimit, 0.1 * speedMultiplier);
      trafficRef.current = next;
      setTraffic(next);
      if (Math.floor(next.time / 8) > Math.floor((next.time - 0.1 * speedMultiplier) / 8)) {
        const value = metricsFor(next).queueMeters;
        setHistory((previous) => [...previous, value].slice(-30));
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [isRunning, mapStatus, speedLimit, speedMultiplier]);

  useEffect(() => {
    try {
      const snapshot: ScenarioSnapshot = { schemaVersion: 2, name: scenarioName, savedAt: new Date().toISOString(), speedLimit, signals, roads };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch { /* local persistence is best effort; explicit export remains available */ }
  }, [scenarioName, speedLimit, signals, roads]);

  useEffect(() => {
    return () => { if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current); };
  }, []);

  const zoomBaku = useCallback(() => {
    mapRef.current?.flyTo({ center: BAKU, zoom: 12.8, pitch: is3D ? 42 : 0, bearing: 0, duration: 900, speed: 1.25, essential: true });
  }, [is3D]);
  const zoomCountry = useCallback(() => {
    mapRef.current?.flyTo({ center: AZERBAIJAN, zoom: 6.15, pitch: 0, bearing: 0, duration: 1000, speed: 1.1, essential: true });
    setIs3D(false);
  }, []);
  const toggle3D = useCallback((enabled: boolean) => {
    setIs3D(enabled);
    mapRef.current?.easeTo({ pitch: enabled ? 42 : 0, bearing: 0, duration: 520, essential: true });
  }, []);

  const changeMode = (next: ToolMode) => {
    pendingRoadRef.current = null;
    modeRef.current = next;
    setMode(next);
    if (next === 'signal') flashToast('Щёлкните по карте, чтобы добавить светофор в текущий сценарий.');
    if (next === 'road') flashToast('Щёлкните по карте в начале и в конце нового участка.');
    if (next === 'erase') flashToast('Можно удалять только собственные элементы сценария.');
  };

  const setSignalCycle = (value: number) => {
    if (!selectedSignal) return;
    setSignals((previous) => previous.map((signal) => signal.id === selectedSignal.id ? { ...signal, cycleSeconds: value } : signal));
  };
  const toggleManualSignal = () => {
    if (!selectedSignal) return;
    if (!selectedSignal.connectedToDemoRoute) {
      flashToast('Светофор не соединён с тестовым маршрутом и не влияет на движение машин.');
      return;
    }
    setSignals((previous) => previous.map((signal) => signal.id === selectedSignal.id
      ? { ...signal, manualState: signal.manualState === 'red' ? 'green' : signal.manualState === 'green' ? null : 'red' }
      : signal));
  };
  const saveScenario = () => {
    try {
      const snapshot: ScenarioSnapshot = { schemaVersion: 2, name: scenarioName, savedAt: new Date().toISOString(), speedLimit, signals, roads };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
      flashToast('Сценарий сохранён локально на этом компьютере.');
    } catch { flashToast('Не удалось сохранить сценарий в локальном хранилище. Используйте экспорт JSON.'); }
  };
  const exportScenario = () => {
    const snapshot: ScenarioSnapshot = { schemaVersion: 2, name: scenarioName, savedAt: new Date().toISOString(), speedLimit, signals, roads };
    const link = document.createElement('a');
    const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }));
    link.href = url; link.download = 'roadmind-az-scenario.json'; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    flashToast('Сценарий экспортирован в JSON.');
  };

  const runComparison = () => {
    if (isComparing) return;
    setIsComparing(true);
    window.setTimeout(() => {
      const baseSignals = initialSignals();
      let base = createTrafficState(18);
      let changed = createTrafficState(18);
      for (let i = 0; i < 1200; i += 1) {
        base = advanceTraffic(base, baseSignals, 40, 0.5);
        changed = advanceTraffic(changed, signalsRef.current, speedLimit, 0.5);
      }
      setComparison({ baseline: metricsFor(base), current: metricsFor(changed) });
      setIsComparing(false);
      flashToast('Сравнение выполнено. Значения относятся только к синтетической модели Alpha.');
    }, 25);
  };
  const resetScenario = () => {
    const reset = initialSignals();
    setSignals(reset); setRoads([]); setSpeedLimit(40);
    setSelectedSignalId(reset[0]?.id || null); setSelectedRoadId(null);
    setComparison(null); setHistory([]);
    const fresh = createTrafficState();
    trafficRef.current = fresh; setTraffic(fresh);
    flashToast('Сценарий возвращён к исходным параметрам.');
  };

  const queueLabel = metrics.stopped === 1 ? 'автомобиль остановлен' : 'автомобилей остановлено';

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <img className="brand-icon" src="./roadmind-icon.svg" alt="" />
          <div className="brand-wordmark"><strong>roadmind<span>az</span></strong><small>DIGITAL TWIN LAB</small></div>
        </div>
        <div className="topbar-divider" />
        <div className="workspace-name"><span className="workspace-dot" /><div><strong>Баку · Alpha workspace</strong><small>Дорожная исследовательская среда</small></div><ChevronDown size={14} /></div>
        <div className="topbar-center"><span className="sim-live"><i />{isRunning ? 'СИМУЛЯЦИЯ АКТИВНА' : 'СИМУЛЯЦИЯ НА ПАУЗЕ'}</span><span className="topbar-separator" /><span className="sim-clock">T+ {formatClock(traffic.time)}</span></div>
        <div className="topbar-actions">
          <button className="icon-button" title="О проекте" onClick={() => flashToast('RoadMind AZ Alpha 0.2 · цифровая лаборатория дорожных сценариев Баку.')}><CircleHelp size={17} /></button>
          <button className="icon-button" title="Данные карты" onClick={() => flashToast('Базовая карта: OpenFreeMap / OpenStreetMap. Светофоры в OSM не содержат текущую фазу сигнала.')}><Settings2 size={17} /></button>
          <button className="save-button" onClick={saveScenario}><Save size={15} />Сохранить</button>
        </div>
      </header>

      <div className="workspace">
        <aside className="left-sidebar">
          <div className="sidebar-section-title">ИНСТРУМЕНТЫ <span>01</span></div>
          <div className="tool-grid">
            <button className={'tool-tile ' + (mode === 'select' ? 'selected' : '')} onClick={() => changeMode('select')}><Compass size={17} /><span>Навигация</span><kbd>V</kbd></button>
            <button className={'tool-tile ' + (mode === 'signal' ? 'selected' : '')} onClick={() => changeMode('signal')}><TrafficCone size={17} /><span>Светофор</span><kbd>S</kbd></button>
            <button className={'tool-tile ' + (mode === 'road' ? 'selected' : '')} onClick={() => changeMode('road')}><Waypoints size={17} /><span>Участок</span></button>
            <button className={'tool-tile ' + (mode === 'erase' ? 'selected danger' : '')} onClick={() => changeMode('erase')}><Eraser size={17} /><span>Удаление</span><kbd>E</kbd></button>
          </div>
          <div className="mode-hint">{mode === 'select' ? 'Перемещайте карту, выбирайте свои объекты.' : mode === 'signal' ? 'Разместите сценарный светофор на карте.' : mode === 'road' ? 'Отметьте начало и конец участка дороги.' : 'Удаляйте элементы, созданные в сценарии.'}</div>

          <div className="sidebar-divider" />
          <div className="sidebar-section-title">СЛОИ КАРТЫ <span>02</span></div>
          <LayerToggle icon={<Building2 size={15} />} label="3D-застройка" detail="Доступные данные OpenFreeMap" checked={showBuildings && is3D} onChange={(value) => { setShowBuildings(value); if (value && !is3D) toggle3D(true); }} />
          <LayerToggle icon={<Waypoints size={15} />} label="OSM · дороги" detail={osmRoads.length ? osmRoads.length + ' геометрий загружено' : 'Загрузка по текущему району'} checked={showOsmRoads} onChange={setShowOsmRoads} />
          <LayerToggle icon={<RadioTower size={15} />} label="OSM · светофоры" detail={osmSignals.length ? osmSignals.length + ' отмечено в OSM' : 'Только размеченные объекты'} checked={showOsmSignals} onChange={setShowOsmSignals} />
          <LayerToggle icon={<Activity size={15} />} label="Тестовый маршрут" detail="Схематический · не дорожная сеть" checked={showDemo} onChange={setShowDemo} />
          <LayerToggle icon={<CarFront size={15} />} label="Виртуальные авто" detail={traffic.vehicles.length + ' синтетических агентов'} checked={showCars} onChange={setShowCars} />
          <LayerToggle icon={<TrafficCone size={15} />} label="Мои светофоры" detail={signals.length + ' объектов сценария'} checked={showUserSignals} onChange={setShowUserSignals} />
          <button className="sync-button" onClick={() => void syncOsm(false)} disabled={osmBusy}><RefreshCw size={14} className={osmBusy ? 'spin' : ''} />{osmBusy ? 'Синхронизация…' : 'Обновить данные района'}</button>
          <div className={'source-stamp ' + (osmStatus === 'error' ? 'warning' : '')}>
            <span className="source-indicator" /><div><strong>{osmStatus === 'error' ? 'OSM временно недоступен' : osmStatus === 'loading' ? 'Загрузка OSM…' : osmUpdatedAt ? 'OSM синхронизирован' : 'Данные OSM не запрошены'}</strong><small>{osmUpdatedAt ? 'Последний запрос · ' + formatTime(osmUpdatedAt) : 'Местные данные не подтверждены'}</small></div>
          </div>
          <p className="sidebar-note">Базовые векторные тайлы онлайн обновляются поставщиком по собственному графику (планетарный набор OpenFreeMap — еженедельно). Синхронизация выше запрашивает текущие OSM-данные только для небольшого района.</p>

          <div className="sidebar-bottom">
            <div className="footer-status"><span className={'status-dot ' + mapStatus} /><span>{mapStatus === 'ready' ? 'Карта подключена' : mapStatus === 'error' ? 'Проблема с картой' : 'Подключение карты…'}</span></div>
            <span>ROAD NETWORK LAB · 0.2.0</span>
          </div>
        </aside>

        <section className="map-workspace" aria-label="Интерактивная карта Баку и Азербайджана">
          <div ref={mapContainerRef} className="map-container" />
          <div className="map-vignette" />
          <div className="map-heading"><div className="map-heading-kicker"><span className="tiny-coordinate-dot" /> DIGITAL TWIN / AZ-BAK</div><h1>Баку <span>·</span> дорожная модель</h1><p>40.3893° N <i /> 49.8672° E <i /> {is3D ? '3D перспектива' : '2D сверху'}</p></div>

          <div className="map-floating-tools">
            <button onClick={zoomBaku} title="Центрировать Баку"><LocateFixed size={16} /></button>
            <button onClick={zoomCountry} title="Показать Азербайджан"><MapIcon size={16} /></button>
            <span />
            <button onClick={() => mapRef.current?.zoomIn({ duration: 260, essential: true })} title="Приблизить"><ZoomIn size={16} /></button>
            <button onClick={() => mapRef.current?.zoomOut({ duration: 260, essential: true })} title="Отдалить"><ZoomOut size={16} /></button>
          </div>
          <div className="map-top-right">
            <button className={!is3D ? 'active' : ''} onClick={() => toggle3D(false)}>2D</button>
            <button className={is3D ? 'active' : ''} onClick={() => toggle3D(true)}>3D</button>
            <span />
            <button title="Вернуть на север" onClick={() => mapRef.current?.easeTo({ bearing: 0, duration: 350 })}><Compass size={15} /></button>
          </div>

          <div className="map-legend"><span><i className="legend-road" />OSM-дороги</span><span><i className="legend-car" />Симуляция</span><span><i className="legend-signal" />Светофор OSM</span></div>
          <div className="map-metric-card">
            <div className="metric-card-header"><span>СИНТЕТИЧЕСКАЯ СИМУЛЯЦИЯ</span><span className={'simulation-state ' + (isRunning ? 'running' : '')}><i />{isRunning ? 'RUNNING' : 'PAUSED'}</span></div>
            <div className="metric-main"><div><strong>{metrics.averageSpeed}</strong><small>км/ч · средняя скорость</small></div><div className="metric-separator" /><div><strong>{metrics.queueMeters}<em> м</em></strong><small>длина очереди · модель</small></div></div>
            <div className="metric-progress"><span style={{ width: Math.min(100, metrics.averageSpeed / Math.max(1, speedLimit) * 100) + '%' }} /></div>
            <div className="metric-foot"><span>{metrics.stopped} {queueLabel}</span><span>{traffic.vehicles.length} агентов</span></div>
          </div>
          <div className="map-bottom-left"><span className="coordinate-pill">EPSG:3857</span><span className="data-dot" />{mapStatus === 'ready' ? 'Basemap online · OpenFreeMap' : 'Basemap status · ' + mapStatus}<span className="data-dot" />Zoom {mapZoom.toFixed(1)}<span className="data-dot" />© OpenStreetMap</div>
          <div className="map-bottom-controls">
            <button title="Сбросить сценарий" onClick={resetScenario}><RotateCcw size={15} /></button><span />
            <button title="Скорость симуляции" onClick={() => setSpeedMultiplier((value) => value >= 4 ? 1 : value + 1)}><Gauge size={15} /><small>{speedMultiplier}×</small></button>
            <button className={'play-button ' + (isRunning ? 'playing' : '')} title={isRunning ? 'Пауза' : 'Запустить'} onClick={() => setIsRunning((value) => !value)}>{isRunning ? <Pause size={16} /> : <Play size={16} />}</button>
          </div>
          {showDataNotice && <div className="data-notice"><span><AlertTriangle size={15} /></span><div><strong>Границы точности Alpha</strong><p>Машины и метрики синтетические. OSM-светофор — отметка на карте, без реальной фазы и программы.</p></div><button onClick={() => setShowDataNotice(false)} aria-label="Закрыть предупреждение"><X size={14} /></button></div>}
          {mapStatus === 'error' && <div className="map-error"><AlertTriangle size={17} /><strong>Не удалось загрузить карту</strong><p>Проверьте подключение к интернету. Онлайн-тайлы карты недоступны.</p><button onClick={() => window.location.reload()}><RefreshCw size={14} />Повторить</button></div>}
        </section>

        <aside className="right-sidebar">
          <div className="inspector-header"><div><span className="section-eyebrow">SCENARIO INSPECTOR</span><h2>Сценарий</h2></div><button className="icon-button" title="Сбросить" onClick={resetScenario}><RotateCcw size={15} /></button></div>
          <div className="scenario-card"><div className="scenario-topline"><span>SCN / BAKU-01</span><span className="draft-badge"><i />DRAFT</span></div><input aria-label="Название сценария" value={scenarioName} onChange={(event) => setScenarioName(event.target.value)} /><div className="scenario-footer"><span><Clock3 size={12} /> Автосохранение локально</span><span>v.02</span></div></div>

          <section className="inspector-section"><div className="section-heading"><span>ПАРАМЕТРЫ МОДЕЛИ</span><button title="Ограничения модели" onClick={() => flashToast('Скорость и светофоры влияют только на синтетическую модель, не на официальную дорожную сеть.')}><CircleHelp size={13} /></button></div>
            <div className="control-row"><span>Лимит скорости модели</span><strong>{speedLimit} <small>км/ч</small></strong></div>
            <input className="range-input" type="range" min="20" max="80" step="5" value={speedLimit} onChange={(event) => setSpeedLimit(Number(event.target.value))} aria-label="Лимит скорости" />
            <div className="range-labels"><span>20 км/ч</span><span>80 км/ч</span></div>
          </section>

          <section className="inspector-section"><div className="section-heading"><span>СВЕТОФОРЫ СЦЕНАРИЯ</span><button className="inline-add" onClick={() => changeMode('signal')}><Plus size={13} />Добавить</button></div>
            <div className="signal-list">{signals.map((signal, index) => {
              const red = isSignalRed(signal, traffic.time);
              return <button key={signal.id} className={'signal-row ' + (signal.id === selectedSignalId ? 'selected' : '')} onClick={() => { setSelectedSignalId(signal.id); setSelectedRoadId(null); mapRef.current?.easeTo({ center: signal.coordinates, zoom: Math.max(15, mapRef.current?.getZoom() || 0), duration: 550, essential: true }); }}>
                <span className={'signal-glyph ' + (red ? 'red' : 'green')}><i /><i /><i /></span>
                <span className="signal-copy"><strong>{signal.name}</strong><small>{signal.connectedToDemoRoute ? 'связан с тестовым маршрутом' : 'только сценарный объект'} · {index === 0 ? 'исходный' : 'изменение'}</small></span>
                <span className={'signal-state-label ' + (red ? 'red' : 'green')}>{red ? 'STOP' : 'GO'}</span>
              </button>;
            })}</div>
            {selectedSignal && <div className="signal-controls">
              {!selectedSignal.connectedToDemoRoute && <p className="inline-warning">Объект не подключён к тестовому маршруту. Геометрическую сеть нужно связать перед использованием в симуляции.</p>}
              <div className="signal-control-heading"><span>Цикл светофора</span><strong>{selectedSignal.cycleSeconds} с</strong></div>
              <input className="range-input" type="range" min="30" max="140" step="5" value={selectedSignal.cycleSeconds} onChange={(event) => setSignalCycle(Number(event.target.value))} aria-label="Цикл светофора" />
              <div className="signal-actions"><button onClick={toggleManualSignal}><RadioTower size={13} />{selectedSignal.manualState === 'red' ? 'Зелёный вручную' : selectedSignal.manualState === 'green' ? 'Вернуть цикл' : 'Красный вручную'}</button><button className="danger-icon" title="Удалить" onClick={() => { setSignals((previous) => previous.filter((item) => item.id !== selectedSignal.id)); setSelectedSignalId(null); }}><Eraser size={13} /></button></div>
            </div>}
          </section>

          {selectedRoad && <div className="selected-road-card"><div><Waypoints size={14} /><strong>{selectedRoad.name}</strong></div><p>Черновая линия геометрии. Её ещё нужно соединить с дорожным графом и правилами движения.</p><button onClick={() => { setRoads((previous) => previous.filter((road) => road.id !== selectedRoad.id)); setSelectedRoadId(null); }}>Удалить участок</button></div>}

          <section className="inspector-section metrics-section"><div className="section-heading"><span>ПОКАЗАТЕЛИ МОДЕЛИ</span><span className="model-badge">DEMO</span></div>
            <div className="metrics-grid">
              <Metric label="Ср. скорость" value={metrics.averageSpeed} unit="км/ч" />
              <Metric label="Очередь" value={metrics.queueMeters} unit="м" />
              <Metric label="Остановлено" value={metrics.stopped} unit="авто" />
              <Metric label="Задержка" value={metrics.delaySeconds} unit="с/авто" />
            </div>
            <div className="chart-heading"><span>ДЛИНА ОЧЕРЕДИ</span><small>ПОСЛЕДНИЕ 4 МИНУТЫ МОДЕЛИ</small></div>
            <svg className="queue-chart" viewBox="0 0 300 50" preserveAspectRatio="none" role="img" aria-label="История оценочной длины очереди">
              <defs><linearGradient id="queue-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#e1b77b" stopOpacity=".25" /><stop offset="100%" stopColor="#e1b77b" stopOpacity="0" /></linearGradient></defs>
              <path d={chartPath(history)} fill="url(#queue-fill)" stroke="none" />
              <path d={chartLine(history)} fill="none" stroke="#d9b176" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </svg>
            <div className="chart-foot"><span><i /> очередь · оценка модели</span><strong>{metrics.queueMeters} м</strong></div>
          </section>
          <div className="inspector-actions"><button className="compare-button" onClick={runComparison} disabled={isComparing}><GitCompareArrows size={14} />{isComparing ? 'Расчёт…' : 'Сравнить сценарии'}</button><button className="export-button" title="Экспортировать JSON" onClick={exportScenario}><Download size={15} /></button></div>
          {comparison && <div className="comparison-result"><div className="comparison-header"><Check size={14} />СРАВНЕНИЕ <button onClick={() => setComparison(null)}><X size={13} /></button></div><p>12 минут синтетической симуляции при одинаковом количестве виртуальных агентов.</p><div><span>Средняя скорость</span><strong>{comparison.baseline.averageSpeed} → {comparison.current.averageSpeed} км/ч <em>{speedDelta !== null && speedDelta > 0 ? '+' : ''}{speedDelta}</em></strong></div><div><span>Длина очереди</span><strong>{comparison.baseline.queueMeters} → {comparison.current.queueMeters} м <em>{queueDelta !== null && queueDelta > 0 ? '−' : '+'}{Math.abs(queueDelta || 0)} м</em></strong></div></div>}
        </aside>
      </div>
      <footer className="statusbar"><div><span className={'status-dot ' + mapStatus} /><strong>{mapStatus === 'ready' ? 'КАРТА РАБОТАЕТ' : mapStatus === 'error' ? 'ОФЛАЙН / НЕТ ТАЙЛОВ' : 'ЗАГРУЗКА КАРТЫ'}</strong><span className="status-divider" /><span>{osmStatus === 'ok' ? 'OSM: ' + formatTime(osmUpdatedAt) : 'OSM: ' + osmStatus}</span></div><div><span><Eye size={12} /> Прототип, не инженерный прогноз</span><span className="status-divider" /><span>RoadMind AZ · 2026</span></div></footer>
      {toast && <div className="toast-message"><span className="toast-icon"><Check size={14} /></span>{toast}</div>}
    </main>
  );
}

function chartLine(history: number[]): string {
  const values = history.length ? history : [20, 26, 22, 31, 25, 29, 19];
  const max = Math.max(1, ...values);
  return values.map((value, index) => (index ? 'L' : 'M') + (index / Math.max(1, values.length - 1) * 300).toFixed(2) + ' ' + (44 - value / max * 34).toFixed(2)).join(' ');
}
function chartPath(history: number[]): string {
  return chartLine(history) + ' L300 50 L0 50 Z';
}
function Metric({ label, value, unit }: { label: string; value: number; unit: string }) {
  return <div className="metric-mini"><small>{label}</small><strong>{value}<em>{unit}</em></strong></div>;
}
function LayerToggle({ icon, label, detail, checked, onChange }: { icon: React.ReactNode; label: string; detail: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <div className="layer-row"><span className="layer-icon">{icon}</span><div className="layer-copy"><strong>{label}</strong><small>{detail}</small></div><button className={'toggle-switch ' + (checked ? 'on' : '')} role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}><span /></button></div>;
}