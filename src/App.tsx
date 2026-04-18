import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Map, NavigationControl, Marker, Source, Layer, useControl } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import { Layers, Image as ImageIcon, Maximize2, Minimize2, Eye, Trash2, MapPin, Radio, AlertTriangle, Download, Loader2 } from 'lucide-react';
import 'maplibre-gl/dist/maplibre-gl.css';

// 国土地理院タイルの設定
const GSI_STD_URL = 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png';
const GSI_PHOTO_URL = 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg';
const GSI_DEM_URL = 'https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png';

const TERRAIN_CONFIG = {
  type: 'raster-dem' as const,
  tiles: [GSI_DEM_URL],
  tileSize: 256,
  encoding: 'custom' as const,
  minzoom: 9,
  maxzoom: 14,
  baseShift: 0,
  redFactor: 655.36,
  greenFactor: 2.56,
  blueFactor: 0.01
};

const INITIAL_VIEW_STATE = {
  longitude: 138.877, 
  latitude: 35.424,
  zoom: 13,
  pitch: 45,
  bearing: 0
};

type MapType = 'std' | 'photo';

interface Waypoint {
  id: string;
  lng: number;
  lat: number;
  alt: number; 
  groundAlt: number; 
  isElevating: boolean;
}

// 2点間の距離を計算（メートル）
function getDistance(lon1: number, lat1: number, lon2: number, lat2: number) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function DeckGLOverlay(props: any) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

function App() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [showSidebar, setShowSidebar] = useState(window.innerWidth >= 768);
  const [selectedWaypointId, setSelectedWaypointId] = useState<string | null>(null);
  const [showLos, setShowLos] = useState(true);
  const [viewState, setViewState] = useState<any>(INITIAL_VIEW_STATE);
  const [show3D, setShow3D] = useState(true);
  const [is3DExpanded, setIs3DExpanded] = useState(false);
  const [mapType3D, setMapType3D] = useState<MapType>('photo');
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [losResults, setLosResults] = useState<Record<string, { isClear: boolean }>>({});

  const map2DRef = useRef<any>(null);
  const map3DRef = useRef<any>(null);
  const dataMapRef = useRef<any>(null);

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (!mobile) setShowSidebar(true);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 3Dビューとサイドバーの排他制御（モバイルのみ）
  useEffect(() => {
    if (isMobile) {
      if (show3D) {
        setShowSidebar(false);
      }
    }
  }, [show3D, isMobile]);

  const toggleSidebar = () => {
    if (isMobile && !showSidebar && show3D) {
      setShow3D(false);
    }
    setShowSidebar(!showSidebar);
  };

  const toggle3D = () => {
    if (isMobile && !show3D && showSidebar) {
      setShowSidebar(false);
    }
    setShow3D(!show3D);
  };

  const getElevation = useCallback((lng: number, lat: number, map: any): number | null => {
    if (!map) return null;
    try {
      const ele = map.queryTerrainElevation ? map.queryTerrainElevation([lng, lat]) : null;
      return (ele === 0 || ele === null) ? null : ele;
    } catch (e) {
      return null;
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const activeMap = dataMapRef.current?.getMap() || map3DRef.current?.getMap() || map2DRef.current?.getMap();
      if (!activeMap) return;
      setWaypoints(prev => {
        let changed = false;
        const next = prev.map(wp => {
          if (wp.isElevating || wp.groundAlt === 0) {
            const ele = getElevation(wp.lng, wp.lat, activeMap);
            if (ele !== null) {
              changed = true;
              return { ...wp, groundAlt: ele, isElevating: false };
            }
          }
          return wp;
        });
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [getElevation]);

  const onMove = useCallback((evt: any) => setViewState(evt.viewState), []);

  const onMapClick = useCallback((evt: any) => {
    setSelectedWaypointId(null);
    const { lng, lat } = evt.lngLat;
    const activeMap = dataMapRef.current?.getMap() || map3DRef.current?.getMap() || map2DRef.current?.getMap();
    const groundAlt = getElevation(lng, lat, activeMap);
    setWaypoints(prev => {
      const lastWP = prev[prev.length - 1];
      const initialGroundAlt = groundAlt || (lastWP ? lastWP.groundAlt : 0);
      return [...prev, {
        id: crypto.randomUUID(),
        lng, lat, 
        alt: 5,
        groundAlt: initialGroundAlt,
        isElevating: !groundAlt
      }];
    });
  }, [getElevation]);

  const removeWaypoint = useCallback((id: string) => setWaypoints(p => p.filter(wp => wp.id !== id)), []);

  const onMarkerDragEnd = useCallback((id: string, evt: any) => {
    const { lng, lat } = evt.lngLat;
    const activeMap = dataMapRef.current?.getMap() || map3DRef.current?.getMap() || map2DRef.current?.getMap();
    const groundAlt = getElevation(lng, lat, activeMap);
    setWaypoints(prev => prev.map(wp => 
      wp.id === id ? { ...wp, lng, lat, groundAlt: groundAlt || 0, isElevating: !groundAlt } : wp
    ));
  }, [getElevation]);

  const updateAltitude = (id: string, alt: number) => {
    setWaypoints(p => p.map(wp => wp.id === id ? { ...wp, alt } : wp));
  };

  // LoS Analysis
  useEffect(() => {
    const activeMap = dataMapRef.current?.getMap() || map3DRef.current?.getMap() || map2DRef.current?.getMap();
    if (!activeMap || waypoints.length < 2) {
      setLosResults({});
      return;
    }
    const baseWP = waypoints[0];
    const baseTotalAlt = baseWP.groundAlt + baseWP.alt;
    const newResults: Record<string, { isClear: boolean }> = {};
    waypoints.slice(1).forEach(wp => {
      if (wp.isElevating) return;
      const wpTotalAlt = wp.groundAlt + wp.alt;
      let isClear = true;
      const samples = 40;
      for (let i = 0; i <= samples; i++) {
        const ratio = i / samples;
        const sLng = baseWP.lng + (wp.lng - baseWP.lng) * ratio;
        const sLat = baseWP.lat + (wp.lat - baseWP.lat) * ratio;
        const lineAlt = baseTotalAlt + (wpTotalAlt - baseTotalAlt) * ratio;
        const groundAlt = getElevation(sLng, sLat, activeMap);
        if (groundAlt !== null && groundAlt > lineAlt + 1.5) {
          isClear = false;
          break;
        }
      }
      newResults[wp.id] = { isClear };
    });
    setLosResults(newResults);
  }, [waypoints, viewState, getElevation]);

  const waypointStats = useMemo(() => {
    const stats: any[] = [];
    let cumulativeDist = 0;
    const home = waypoints[0];
    waypoints.forEach((wp, i) => {
      if (i > 0) cumulativeDist += getDistance(waypoints[i-1].lng, waypoints[i-1].lat, wp.lng, wp.lat);
      stats.push({
        id: wp.id,
        distFromHome: home ? getDistance(home.lng, home.lat, wp.lng, wp.lat) : 0,
        totalDist: cumulativeDist,
        altDiff: home ? (wp.groundAlt + wp.alt) - (home.groundAlt + home.alt) : 0,
        groundAlt: wp.groundAlt,
        totalAMSL: wp.groundAlt + wp.alt
      });
    });
    return stats;
  }, [waypoints]);

  const deckLayers = useMemo(() => {
    if (waypoints.length === 0) return [];
    return [
      new PathLayer({
        id: 'path-3d',
        data: [{ path: waypoints.map(wp => [wp.lng, wp.lat, wp.groundAlt + wp.alt]) }],
        getPath: (d: any) => d.path,
        getColor: mapType3D === 'std' ? [0, 0, 0, 180] : [255, 255, 255, 200],
        getWidth: 6,
        widthMinPixels: 4,
        parameters: { depthTest: true }
      }),
      ...(showLos ? [
        new PathLayer({
          id: 'los-3d',
          data: waypoints.slice(1).map(wp => ({
            path: [[waypoints[0].lng, waypoints[0].lat, waypoints[0].groundAlt + waypoints[0].alt], [wp.lng, wp.lat, wp.groundAlt + wp.alt]],
            isClear: losResults[wp.id]?.isClear ?? true
          })),
          getPath: (d: any) => d.path,
          getColor: (d: any) => d.isClear ? [59, 130, 246, 200] : [239, 68, 68, 255],
          getWidth: (d: any) => d.isClear ? 4 : 8,
          widthMinPixels: 2,
          parameters: { depthTest: true }
        })
      ] : []),
      new PathLayer({
        id: 'drop-lines',
        data: waypoints.map(wp => ({ path: [[wp.lng, wp.lat, wp.groundAlt], [wp.lng, wp.lat, wp.groundAlt + wp.alt]] })),
        getPath: (d: any) => d.path,
        getColor: [255, 255, 255, 80],
        getWidth: 1,
      }),
      new ScatterplotLayer({
        id: 'points-3d',
        data: waypoints,
        getPosition: (d: any) => [d.lng, d.lat, d.groundAlt + d.alt],
        getFillColor: (_: any, {index}: any) => index === 0 ? [34, 197, 94] : [37, 99, 235],
        getRadius: 8,
        radiusMinPixels: 6,
        stroked: true,
        getLineColor: [255, 255, 255]
      })
    ];
  }, [waypoints, losResults, mapType3D, showLos]);

  const exportGPX = () => {
    if (waypoints.length === 0) return;
    const gpxHeader = '<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="FPV LoS Simulator" xmlns="http://www.topografix.com/GPX/1/1">';
    const points = waypoints.map((wp, i) => `<trkpt lat="${wp.lat}" lon="${wp.lng}"><ele>${Math.round(wp.groundAlt + wp.alt)}</ele><name>WP${i+1}</name></trkpt>`).join('');
    const blob = new Blob([gpxHeader + '<trk><name>FPV Route</name><trkseg>' + points + '</trkseg></trk></gpx>'], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `fpv-path.gpx`; a.click();
  };

  return (
    <div className="relative h-screen w-screen bg-gray-100 overflow-hidden text-black select-none font-sans text-sm md:text-xs">
      {/* Background Data Map (Invisible) */}
      <div className="absolute inset-0 -z-50 opacity-0 pointer-events-none">
        <Map
          ref={dataMapRef}
          {...viewState}
          mapLib={maplibregl}
          mapStyle={{
            version: 8,
            sources: { 'terrainSource': TERRAIN_CONFIG },
            layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#000' } }],
            terrain: { source: 'terrainSource', exaggeration: 1.0 }
          }}
        />
      </div>

      <div className="absolute inset-0">
        <Map
          ref={map2DRef}
          longitude={viewState.longitude}
          latitude={viewState.latitude}
          zoom={viewState.zoom}
          pitch={0} bearing={0}
          onMove={onMove} onClick={onMapClick}
          dragRotate={false} touchPitch={false}
          mapLib={maplibregl}
          mapStyle={{
            version: 8,
            sources: { 'gsi-std': { type: 'raster', tiles: [GSI_STD_URL], tileSize: 256, attribution: '国土地理院' } },
            layers: [{ id: 'gsi-std-layer', type: 'raster', source: 'gsi-std' }]
          }}
        >
          <NavigationControl position="top-left" showCompass={false} />
          {waypoints.length > 0 && (
            <Source id="flight-path-2d" type="geojson" data={{ type: 'Feature', geometry: { type: 'LineString', coordinates: waypoints.map(wp => [wp.lng, wp.lat]) } } as any}>
              <Layer id="2d-path-layer" type="line" paint={{ 'line-color': '#444', 'line-width': 2.5, 'line-dasharray': [2, 1] }} />
            </Source>
          )}
          {showLos && waypoints.length >= 2 && (
            <Source id="los-lines-2d" type="geojson" data={{ type: 'FeatureCollection', features: waypoints.slice(1).map(wp => ({ type: 'Feature', properties: { isClear: losResults[wp.id]?.isClear ?? true }, geometry: { type: 'LineString', coordinates: [[waypoints[0]?.lng, waypoints[0]?.lat], [wp.lng, wp.lat]] } })) } as any}>
              <Layer id="2d-los-layer" type="line" paint={{ 'line-color': ['case', ['get', 'isClear'], '#3b82f6', '#ef4444'], 'line-width': 2, 'line-opacity': 0.8 }} />
            </Source>
          )}
          {waypoints.map((wp, index) => {
            const isBlocked = index > 0 && losResults[wp.id] && !losResults[wp.id].isClear;
            const stats = waypointStats[index];
            const isSelected = selectedWaypointId === wp.id;
            return (
              <Marker key={wp.id} longitude={wp.lng} latitude={wp.lat} draggable onDragEnd={(evt) => onMarkerDragEnd(wp.id, evt)}>
                <div className="group relative flex flex-col items-center cursor-pointer" onClick={(e) => { e.stopPropagation(); setSelectedWaypointId(isSelected ? null : wp.id); }} onContextMenu={(e) => { e.preventDefault(); removeWaypoint(wp.id); }}>
                  <div className={`absolute bottom-full mb-2 bg-gray-900/95 text-white text-[10px] md:text-[10px] p-2 rounded shadow-2xl ${isSelected ? 'opacity-100 scale-100' : 'opacity-0 scale-95 group-hover:opacity-100 group-hover:scale-100'} transition-all whitespace-nowrap z-50 pointer-events-none border border-white/20`}>
                    <div className="font-bold border-b border-white/20 mb-1 pb-1 flex justify-between gap-4">
                      <span>{index === 0 ? 'WAYPOINT 1 (HOME)' : `WAYPOINT ${index+1}`}</span>
                      {isBlocked && <span className="text-red-400 font-black">BLOCKED</span>}
                    </div>
                    <div className="space-y-0.5 font-mono font-bold text-white">
                      <div className="flex justify-between gap-4"><span>Home Dist:</span><span>{stats.distFromHome.toFixed(0)}m</span></div>
                      <div className="flex justify-between gap-4"><span>Path Dist:</span><span>{stats.totalDist.toFixed(0)}m</span></div>
                      <div className="flex justify-between gap-4"><span>GND Elev:</span><span>{Math.round(stats.groundAlt)}m</span></div>
                      <div className="flex justify-between gap-4"><span>Total AMSL:</span><span>{Math.round(stats.totalAMSL)}m</span></div>
                      <div className="flex justify-between gap-4 text-blue-400"><span>Home Alt Diff:</span><span>{stats.altDiff > 0 ? '+' : ''}{stats.altDiff.toFixed(1)}m</span></div>
                    </div>
                  </div>
                  {isBlocked ? <AlertTriangle size={isMobile ? 32 : 24} className="text-red-600 fill-white drop-shadow animate-bounce" /> : <MapPin size={isMobile ? 36 : 28} className={`${index === 0 ? 'text-green-500' : 'text-blue-600'} drop-shadow`} fill="currentColor" fillOpacity={0.3} />}
                  <span className={`absolute ${isMobile ? 'top-[8px]' : 'top-[6px]'} text-[10px] font-bold text-white pointer-events-none`}>{index + 1}</span>
                </div>
              </Marker>
            );
          })}
        </Map>
      </div>

      <div className={`absolute transition-all duration-300 z-40 ${isMobile ? (showSidebar ? 'bottom-0 left-0 right-0' : 'bottom-10 left-4 right-4') : 'top-20 left-4 w-72'} flex flex-row gap-4 text-black pointer-events-none`}>
        {isMobile && !showSidebar && !show3D && (
          <div className="flex w-full gap-4 px-2 mb-4">
            <button onClick={toggleSidebar} className="flex-1 bg-white/95 backdrop-blur shadow-2xl rounded-full py-4 border border-gray-200 flex items-center justify-center gap-2 font-bold text-blue-800 pointer-events-auto active:scale-95 transition-all">
              <Layers size={18} /> <span className="font-bold uppercase tracking-wider text-[10px]">WAYPOINTS</span>
            </button>
            <button onClick={toggle3D} className="flex-1 bg-blue-600 shadow-2xl rounded-full py-4 border border-blue-500 flex items-center justify-center gap-2 font-bold text-white pointer-events-auto active:scale-95 transition-all">
              <Eye size={18} /> <span className="font-bold uppercase tracking-wider text-[10px]">3D VIEW</span>
            </button>
          </div>
        )}
        <div className={`${isMobile && !showSidebar ? 'hidden' : 'flex'} bg-white/95 backdrop-blur shadow-2xl ${isMobile ? 'rounded-t-2xl border-t w-full' : 'rounded-2xl border w-72'} border-gray-200 p-4 flex-col pointer-events-auto`}>
          <h2 className="font-bold text-sm flex items-center justify-between mb-3 text-blue-800 uppercase tracking-tighter border-b pb-2">
            <span className="flex items-center gap-2"><Radio size={16} /> WAYPOINTS ({waypoints.length})</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setShowLos(!showLos)} className={`flex items-center gap-1 text-[9px] px-2 py-1 rounded-full border transition-all ${showLos ? 'bg-blue-100 border-blue-300 text-blue-700' : 'bg-gray-100 border-gray-300 text-gray-500'}`}>
                <Eye size={12} /> LOS
              </button>
              {isMobile && <button onClick={() => setShowSidebar(false)} className="text-gray-400 p-1.5 hover:bg-red-500/20 rounded-lg font-bold text-xs transition-colors">✕</button>}
            </div>
          </h2>
          <div className={`space-y-3 overflow-y-auto pr-1 ${isMobile ? 'max-h-[30vh]' : 'max-h-[60vh]'}`}>
            {waypoints.length === 0 ? (
              <div className="text-center py-8 text-gray-400 italic text-[10px]">Click map to add waypoints</div>
            ) : waypoints.map((wp, index) => {
              const isBlocked = index > 0 && losResults[wp.id] && !losResults[wp.id].isClear;
              const stats = waypointStats[index];
              return (
                <div key={wp.id} className={`rounded-xl p-3 border transition-all ${isBlocked ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-100 shadow-sm'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-extrabold text-gray-500">{index === 0 ? 'WAYPOINT 1 (HOME)' : `WAYPOINT ${index+1}`}</span>
                    <button onClick={() => removeWaypoint(wp.id)} className="text-gray-400 hover:text-red-500 transition-colors p-1"><Trash2 size={16} /></button>
                  </div>
                  <div className="space-y-1 mb-3">
                    {wp.isElevating ? (
                      <div className="flex items-center gap-1 text-[10px] text-blue-500 animate-pulse"><Loader2 size={10} className="animate-spin" /> Fetching Position Data...</div>
                    ) : (
                      <div className="grid grid-cols-1 gap-0.5 font-mono text-[9px] leading-tight text-gray-800 font-bold">
                        <div className="flex justify-between"><span>Home Dist:</span><span>{stats.distFromHome.toFixed(0)}m</span></div>
                        <div className="flex justify-between"><span>Path Dist:</span><span>{stats.totalDist.toFixed(0)}m</span></div>
                        <div className="flex justify-between"><span>GND Elev:</span><span>{Math.round(stats.groundAlt)}m</span></div>
                        <div className="flex justify-between"><span>Total AMSL:</span><span>{Math.round(stats.totalAMSL)}m</span></div>
                        <div className="flex justify-between text-blue-600"><span>Home Alt Diff:</span><span>{stats.altDiff > 0 ? '+' : ''}{stats.altDiff.toFixed(1)}m</span></div>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="range" min="0" max="500" step="5" value={wp.alt} onChange={(e) => updateAltitude(wp.id, parseInt(e.target.value))} className="flex-1 h-3 bg-gray-300 rounded-lg appearance-none cursor-pointer accent-blue-600" />
                    <span className="text-[10px] font-bold text-blue-600 w-12 text-right">{wp.alt}m AGL</span>
                  </div>
                </div>
              );
            })}
          </div>
          {waypoints.length > 0 && (
            <div className="mt-3 pt-3 border-t">
              <button onClick={exportGPX} className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white py-3 rounded-xl text-xs font-bold shadow-lg active:scale-95 transition-all">
                <Download size={16} /> EXPORT GPX PATH
              </button>
            </div>
          )}
        </div>
      </div>

      <div className={`absolute top-4 left-1/2 -translate-x-1/2 z-20 pointer-events-none transition-opacity ${isMobile && (showSidebar || (show3D && is3DExpanded)) ? 'opacity-0' : 'opacity-100'}`}>
        <div className="bg-gray-900/90 backdrop-blur-md px-4 py-1.5 rounded-full border border-gray-700 shadow-2xl flex items-center gap-3 text-white">
          <h1 className="font-bold tracking-widest text-[9px] uppercase text-blue-400 whitespace-nowrap">FPV LoS Simulator</h1>
          <div className="h-3 w-[1px] bg-gray-600 hidden md:block" />
          <div className="text-[9px] font-mono text-gray-400 hidden md:block">2D VIEW</div>
        </div>
      </div>

      {show3D && (
        <div className={`absolute z-30 transition-all duration-300 shadow-2xl border-4 border-white rounded-2xl overflow-hidden bg-gray-900 ${is3DExpanded ? (isMobile ? 'inset-0 z-50 rounded-none border-0' : 'top-20 right-6 left-80 bottom-24') : (isMobile ? 'bottom-0 right-0 left-0 h-[45vh] rounded-b-none' : 'bottom-6 right-6 w-[550px] h-[380px]')}`}>
          <div className="absolute top-0 left-0 right-0 h-10 bg-gradient-to-b from-black/80 to-transparent z-40 flex items-center justify-between px-4 pointer-events-none">
            <span className="text-white text-[9px] font-bold uppercase tracking-widest flex items-center gap-2">
              <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" /> 3D ANALYSIS
            </span>
            <div className="flex gap-1 pointer-events-auto">
              <button onClick={() => setMapType3D(t => t === 'std' ? 'photo' : 'std')} className="p-1.5 hover:bg-white/20 rounded-lg text-white transition-colors"><ImageIcon size={14} /></button>
              <button onClick={() => setIs3DExpanded(!is3DExpanded)} className="p-1.5 hover:bg-white/20 rounded-lg text-white transition-colors">{is3DExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
              <button onClick={() => setShow3D(false)} className="p-1.5 hover:bg-red-500/40 rounded-lg text-white font-bold text-xs">✕</button>
            </div>
          </div>
          <Map
            ref={map3DRef}
            {...viewState}
            onMove={(evt: any) => setViewState(evt.viewState)}
            mapLib={maplibregl}
            mapStyle={{
              version: 8,
              sources: { 
                'base-tiles': { type: 'raster', tiles: [mapType3D === 'photo' ? GSI_PHOTO_URL : GSI_STD_URL], tileSize: 256, attribution: '国土地理院' }, 
                'terrainSource': TERRAIN_CONFIG 
              },
              layers: [{ id: 'base-layer', type: 'raster', source: 'base-tiles' }],
              terrain: { source: 'terrainSource', exaggeration: 1.0 }
            }}
          >
            <DeckGLOverlay layers={deckLayers} interleaved={true} />
          </Map>
        </div>
      )}

      {!show3D && (
        <button 
          onClick={() => setShow3D(true)} 
          className={`absolute bottom-10 right-6 z-30 flex items-center gap-3 bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 rounded-full shadow-2xl transition-all ${isMobile ? 'hidden' : ''}`}
        >
          <Eye size={20} /> <span className="font-bold uppercase tracking-wider text-xs">3D VIEW</span>
        </button>
      )}
    </div>
  );
}

export default App;
