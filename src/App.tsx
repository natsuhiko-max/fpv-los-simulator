import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
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

/**
 * Deck.gl を MapLibre の内部に統合するためのカスタムコントロール
 */
function DeckGLOverlay(props: any) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

function App() {
  const [viewState, setViewState] = useState<any>(INITIAL_VIEW_STATE);
  const [show3D, setShow3D] = useState(true);
  const [is3DExpanded, setIs3DExpanded] = useState(false);
  const [mapType3D, setMapType3D] = useState<MapType>('photo');
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [losResults, setLosResults] = useState<Record<string, { isClear: boolean }>>({});

  const map2DRef = useRef<any>(null);
  const map3DRef = useRef<any>(null);

  const getElevation = useCallback((lng: number, lat: number, map: any): number | null => {
    if (!map || !map.queryTerrainElevation) return null;
    try {
      return map.queryTerrainElevation([lng, lat]);
    } catch (e) {
      return null;
    }
  }, []);

  // 標高取得リトライ
  useEffect(() => {
    const map = map3DRef.current?.getMap();
    if (!map) return;
    const interval = setInterval(() => {
      setWaypoints(prev => {
        let changed = false;
        const next = prev.map(wp => {
          if (wp.isElevating || wp.groundAlt === 0) {
            const ele = getElevation(wp.lng, wp.lat, map);
            if (ele !== null && ele !== 0) {
              changed = true;
              return { ...wp, groundAlt: ele, isElevating: false };
            }
          }
          return wp;
        });
        return changed ? next : prev;
      });
    }, 1500);
    return () => clearInterval(interval);
  }, [getElevation, show3D]);

  const onMove = useCallback((evt: any) => setViewState(evt.viewState), []);

  const onMapClick = useCallback((evt: any) => {
    const { lng, lat } = evt.lngLat;
    const map = map3DRef.current?.getMap();
    const groundAlt = getElevation(lng, lat, map);
    setWaypoints(prev => [...prev, {
      id: crypto.randomUUID(),
      lng, lat, alt: 50,
      groundAlt: groundAlt || 0,
      isElevating: !groundAlt
    }]);
  }, [getElevation]);

  const removeWaypoint = useCallback((id: string) => setWaypoints(p => p.filter(wp => wp.id !== id)), []);

  const onMarkerDragEnd = useCallback((id: string, evt: any) => {
    const { lng, lat } = evt.lngLat;
    const map = map3DRef.current?.getMap();
    const groundAlt = getElevation(lng, lat, map);
    setWaypoints(prev => prev.map(wp => 
      wp.id === id ? { ...wp, lng, lat, groundAlt: groundAlt || 0, isElevating: !groundAlt } : wp
    ));
  }, [getElevation]);

  const updateAltitude = (id: string, alt: number) => {
    setWaypoints(p => p.map(wp => wp.id === id ? { ...wp, alt } : wp));
  };

  // LoS Analysis
  useEffect(() => {
    const map = map3DRef.current?.getMap();
    if (!map || waypoints.length < 2) {
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
        const groundAlt = getElevation(sLng, sLat, map);
        if (groundAlt !== null && groundAlt > lineAlt + 1.5) {
          isClear = false;
          break;
        }
      }
      newResults[wp.id] = { isClear };
    });
    setLosResults(newResults);
  }, [waypoints, viewState, getElevation]);

  // --- 3D Layers (Deck.gl) ---
  const deckLayers = useMemo(() => {
    if (waypoints.length === 0) return [];
    const baseWP = waypoints[0];
    
    // インターリーブ統合モードでは、Z=0 が海抜 0m (AMSL) になります。
    // そのため、描画には groundAlt + alt を使用します。
    
    return [
      new PathLayer({
        id: 'path-3d',
        data: [{ path: waypoints.map(wp => [wp.lng, wp.lat, wp.groundAlt + wp.alt]) }],
        getPath: (d: any) => d.path,
        getColor: [255, 255, 255, 220],
        getWidth: 4,
        widthMinPixels: 2,
        parameters: { depthTest: true }
      }),
      new PathLayer({
        id: 'los-3d',
        data: waypoints.slice(1).map(wp => ({
          path: [[baseWP.lng, baseWP.lat, baseWP.groundAlt + baseWP.alt], [wp.lng, wp.lat, wp.groundAlt + wp.alt]],
          isClear: losResults[wp.id]?.isClear ?? true
        })),
        getPath: (d: any) => d.path,
        getColor: (d: any) => d.isClear ? [59, 130, 246, 200] : [239, 68, 68, 255],
        getWidth: (d: any) => d.isClear ? 1.5 : 5,
        widthMinPixels: 1,
        parameters: { depthTest: true }
      }),
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
        getFillColor: (d: any, {index}: any) => index === 0 ? [34, 197, 94] : [234, 179, 8],
        getRadius: 8,
        radiusMinPixels: 5,
        stroked: true,
        getLineColor: [255, 255, 255]
      })
    ];
  }, [waypoints, losResults]);

  const exportGPX = () => {
    if (waypoints.length === 0) return;
    const gpxHeader = '<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="FPV LoS Simulator" xmlns="http://www.topografix.com/GPX/1/1">';
    const points = waypoints.map((wp, i) => `<trkpt lat="${wp.lat}" lon="${wp.lng}"><ele>${Math.round(wp.groundAlt + wp.alt)}</ele><name>WP${i+1}</name></trkpt>`).join('');
    const blob = new Blob([gpxHeader + '<trk><name>FPV Route</name><trkseg>' + points + '</trkseg></trk></gpx>'], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `fpv-path.gpx`; a.click();
  };

  return (
    <div className="relative h-screen w-screen bg-gray-100 overflow-hidden text-black select-none font-sans">
      <div className="absolute inset-0">
        <Map
          ref={map2DRef}
          {...viewState}
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
          {waypoints.length >= 2 && (
            <Source id="los-lines-2d" type="geojson" data={{ type: 'FeatureCollection', features: waypoints.slice(1).map(wp => ({ type: 'Feature', properties: { isClear: losResults[wp.id]?.isClear ?? true }, geometry: { type: 'LineString', coordinates: [[waypoints[0]?.lng, waypoints[0]?.lat], [wp.lng, wp.lat]] } })) } as any}>
              <Layer id="2d-los-layer" type="line" paint={{ 'line-color': ['case', ['get', 'isClear'], '#3b82f6', '#ef4444'], 'line-width': 2, 'line-opacity': 0.8 }} />
            </Source>
          )}

          {waypoints.map((wp, index) => {
            const isBlocked = index > 0 && losResults[wp.id] && !losResults[wp.id].isClear;
            return (
              <Marker key={wp.id} longitude={wp.lng} latitude={wp.lat} draggable onDragEnd={(evt) => onMarkerDragEnd(wp.id, evt)}>
                <div className="group relative flex flex-col items-center" onContextMenu={(e) => { e.preventDefault(); removeWaypoint(wp.id); }}>
                  <div className="mb-1 bg-black/80 text-white text-[10px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50">
                    WP{index+1}: {wp.alt}m
                  </div>
                  {isBlocked ? <AlertTriangle size={24} className="text-red-600 fill-white drop-shadow animate-bounce" /> : <MapPin size={28} className={`${index === 0 ? 'text-green-500' : 'text-blue-600'} drop-shadow`} fill="currentColor" fillOpacity={0.3} />}
                  <span className="absolute top-[6px] text-[10px] font-bold text-white pointer-events-none">{index + 1}</span>
                </div>
              </Marker>
            );
          })}
        </Map>
      </div>

      <div className="absolute top-20 left-4 z-20 w-72 max-h-[75vh] flex flex-col gap-4 text-black">
        <div className="bg-white/95 backdrop-blur shadow-2xl rounded-2xl border border-gray-200 p-4 overflow-y-auto">
          <h2 className="font-bold text-sm flex items-center gap-2 mb-4 text-blue-800 uppercase tracking-tighter"><Radio size={16} /> FPV Route Planner</h2>
          <div className="space-y-3">
            {waypoints.map((wp, index) => {
              const isBlocked = index > 0 && losResults[wp.id] && !losResults[wp.id].isClear;
              return (
                <div key={wp.id} className={`rounded-xl p-3 border transition-all ${isBlocked ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-100'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-extrabold text-gray-500">{index === 0 ? 'HOME STATION' : `WAYPOINT ${index+1}`}</span>
                    <button onClick={() => removeWaypoint(wp.id)} className="text-gray-400 hover:text-red-500 transition-colors"><Trash2 size={14} /></button>
                  </div>
                  <div className="text-[10px] text-gray-400 mb-2 font-mono flex flex-col leading-tight">
                    {wp.isElevating ? (
                      <span className="flex items-center gap-1 text-blue-500 animate-pulse"><Loader2 size={10} className="animate-spin" /> Fetching AMSL...</span>
                    ) : (
                      <>
                        <span>Elev (GND): {Math.round(wp.groundAlt)}m</span>
                        <span className="text-gray-600 font-bold">Total (AMSL): {Math.round(wp.groundAlt + wp.alt)}m</span>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="range" min="0" max="500" step="5" value={wp.alt} onChange={(e) => updateAltitude(wp.id, parseInt(e.target.value))} className="flex-1 h-1.5 bg-gray-300 rounded-lg appearance-none cursor-pointer accent-blue-600" />
                    <span className="text-xs font-mono font-bold w-10 text-right">{wp.alt}m</span>
                  </div>
                </div>
              );
            })}
          </div>
          {waypoints.length > 0 && <button onClick={exportGPX} className="w-full mt-4 flex items-center justify-center gap-2 bg-blue-600 text-white py-3 rounded-xl text-xs font-bold hover:bg-blue-700 shadow-lg active:scale-95 transition-all">Export GPX Path</button>}
        </div>
      </div>

      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
        <div className="bg-gray-900/90 backdrop-blur-md px-6 py-2 rounded-full border border-gray-700 shadow-2xl flex items-center gap-4 text-white">
          <h1 className="font-bold tracking-widest text-xs uppercase text-blue-400">FPV LoS Simulator</h1>
          <div className="h-3 w-[1px] bg-gray-600" />
          <div className="text-[10px] font-mono text-gray-400 text-blue-300">PURE 2D PLANNER ACTIVE</div>
        </div>
      </div>

      {show3D && (
        <div className={`absolute z-30 transition-all duration-300 shadow-2xl border-4 border-white rounded-2xl overflow-hidden bg-gray-900 ${is3DExpanded ? 'top-20 right-6 left-80 bottom-24' : 'bottom-6 right-6 w-[550px] h-[380px]'}`}>
          <div className="absolute top-0 left-0 right-0 h-12 bg-gradient-to-b from-black/80 to-transparent z-40 flex items-center justify-between px-4 pointer-events-none">
            <span className="text-white text-[10px] font-bold uppercase tracking-widest flex items-center gap-2">
              <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.8)]" /> 3D Interleaved View
            </span>
            <div className="flex gap-2 pointer-events-auto">
              <button onClick={() => setMapType3D(t => t === 'std' ? 'photo' : 'std')} className="p-2 hover:bg-white/20 rounded-lg text-white transition-colors" title="Map Style"><ImageIcon size={16} /></button>
              <button onClick={() => setIs3DExpanded(!is3DExpanded)} className="p-2 hover:bg-white/20 rounded-lg text-white transition-colors" title="Expand">{is3DExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
              <button onClick={() => setShow3D(false)} className="p-2 hover:bg-red-500/40 rounded-lg text-white font-bold text-sm">✕</button>
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
          <div className="absolute bottom-3 left-4 z-40 bg-black/50 backdrop-blur px-2 py-1 rounded border border-white/10 text-[9px] text-white pointer-events-none font-mono">
            SYNCED 3D ENGINE
          </div>
        </div>
      )}

      {!show3D && (
        <button onClick={() => setShow3D(true)} className="absolute bottom-6 right-6 z-30 flex items-center gap-3 bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 rounded-full shadow-2xl transition-all">
          <Eye size={20} /> <span className="font-bold uppercase tracking-wider">Open 3D Analysis</span>
        </button>
      )}
    </div>
  );
}

export default App;
