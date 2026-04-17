import React, { useState, useCallback, useMemo } from 'react';
import { Map, NavigationControl, Marker } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import { Layers, Image as ImageIcon, Maximize2, Minimize2, Eye, Trash2, MapPin } from 'lucide-react';
import 'maplibre-gl/dist/maplibre-gl.css';

// 国土地理院タイルの設定
const GSI_STD_URL = 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png';
const GSI_PHOTO_URL = 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg';
const GSI_DEM_URL = 'https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png';

const INITIAL_VIEW_STATE = {
  longitude: 138.727,
  latitude: 35.360,
  zoom: 14,
  pitch: 0,
  bearing: 0
};

type MapType = 'std' | 'photo';

interface Waypoint {
  id: string;
  lng: number;
  lat: number;
  alt: number; // AGL (Above Ground Level)
}

function App() {
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);
  const [show3D, setShow3D] = useState(true);
  const [is3DExpanded, setIs3DExpanded] = useState(false);
  const [mapType3D, setMapType3D] = useState<MapType>('photo');
  
  // ウェイポイントの状態
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onMove = useCallback((evt: any) => {
    setViewState(evt.viewState);
  }, []);

  // ウェイポイントの追加
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onMapClick = useCallback((evt: any) => {
    const { lng, lat } = evt.lngLat;
    const newPoint: Waypoint = {
      id: crypto.randomUUID(),
      lng,
      lat,
      alt: 50 // デフォルト高度 50m
    };
    setWaypoints(prev => [...prev, newPoint]);
  }, []);

  // ウェイポイントの削除
  const removeWaypoint = useCallback((id: string) => {
    setWaypoints(prev => prev.filter(wp => wp.id !== id));
  }, []);

  // ウェイポイントの移動（ドラッグ終了時）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onMarkerDragEnd = useCallback((id: string, evt: any) => {
    const { lng, lat } = evt.lngLat;
    setWaypoints(prev => prev.map(wp => 
      wp.id === id ? { ...wp, lng, lat } : wp
    ));
  }, []);

  // 高度の変更
  const updateAltitude = (id: string, alt: number) => {
    setWaypoints(prev => prev.map(wp => 
      wp.id === id ? { ...wp, alt } : wp
    ));
  };

  // 共通のマーカー描画ロジック
  const renderMarkers = (is3D: boolean) => {
    return waypoints.map((wp, index) => (
      <Marker
        key={wp.id}
        longitude={wp.lng}
        latitude={wp.lat}
        draggable
        onDragEnd={(evt) => onMarkerDragEnd(wp.id, evt)}
      >
        <div 
          className="group relative flex flex-col items-center"
          onContextMenu={(e) => {
            e.preventDefault();
            removeWaypoint(wp.id);
          }}
        >
          {/* 高度ラベル */}
          <div className="mb-1 bg-black/80 text-white text-[10px] px-1.5 py-0.5 rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity">
            WP{index + 1}: {wp.alt}m
          </div>
          {/* ピンアイコン */}
          <MapPin 
            size={is3D ? 32 : 28} 
            className={`${is3D ? 'text-yellow-400' : 'text-red-600'} drop-shadow-md cursor-grab active:cursor-grabbing`} 
            fill="currentColor" 
            fillOpacity={0.4}
          />
          {/* 番号 */}
          <span className="absolute top-[6px] text-[10px] font-bold text-white pointer-events-none">
            {index + 1}
          </span>
        </div>
      </Marker>
    ));
  };

  return (
    <div className="relative h-screen w-screen bg-gray-100 overflow-hidden text-black select-none">
      {/* --- Main 2D Map (Full Screen) --- */}
      <div className="absolute inset-0 z-0">
        <Map
          {...viewState}
          onMove={onMove}
          onClick={onMapClick}
          mapLib={maplibregl}
          mapStyle={{
            version: 8,
            sources: {
              'gsi-std': {
                type: 'raster',
                tiles: [GSI_STD_URL],
                tileSize: 256,
                attribution: '国土地理院'
              }
            },
            layers: [{ id: 'gsi-std-layer', type: 'raster', source: 'gsi-std' }]
          }}
          pitch={0}
          bearing={0}
        >
          <NavigationControl position="top-left" />
          {renderMarkers(false)}
        </Map>
      </div>

      {/* --- Waypoint List UI --- */}
      <div className="absolute top-20 left-4 z-20 w-64 max-h-[70vh] overflow-y-auto">
        <div className="bg-white/95 backdrop-blur shadow-2xl rounded-2xl border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-sm flex items-center gap-2">
              <MapPin size={16} className="text-red-600" />
              Waypoints ({waypoints.length})
            </h2>
          </div>
          <div className="space-y-3">
            {waypoints.map((wp, index) => (
              <div key={wp.id} className="bg-gray-50 rounded-xl p-3 border border-gray-100 hover:border-blue-200 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-gray-500 uppercase">WP {index + 1}</span>
                  <button 
                    onClick={() => removeWaypoint(wp.id)}
                    className="text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <label className="text-[10px] text-gray-400 block mb-1 uppercase font-bold">Altitude (AGL)</label>
                    <div className="flex items-center gap-2">
                      <input 
                        type="range" 
                        min="0" 
                        max="500" 
                        step="10"
                        value={wp.alt}
                        onChange={(e) => updateAltitude(wp.id, parseInt(e.target.value))}
                        className="flex-1 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                      />
                      <span className="text-xs font-mono font-bold w-8">{wp.alt}m</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {waypoints.length === 0 && (
              <p className="text-[10px] text-gray-400 text-center py-4">マップをクリックして地点を追加</p>
            )}
          </div>
        </div>
      </div>

      {/* --- Header UI --- */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
        <div className="bg-gray-900/90 backdrop-blur-md px-6 py-2 rounded-full border border-gray-700 shadow-2xl flex items-center gap-4">
          <h1 className="text-white font-bold tracking-wider text-sm uppercase">FPV Path Planner</h1>
          <div className="h-4 w-[1px] bg-gray-600" />
          <div className="flex gap-4 text-xs font-mono text-gray-400">
            <span>Z: {viewState.zoom.toFixed(1)}</span>
            <span>LAT: {viewState.latitude.toFixed(5)}</span>
            <span>LON: {viewState.longitude.toFixed(5)}</span>
          </div>
        </div>
      </div>

      {/* --- Floating 3D View --- */}
      {show3D && (
        <div 
          className={`absolute z-20 transition-all duration-300 ease-in-out shadow-2xl border-4 border-white rounded-2xl overflow-hidden bg-gray-900
            ${is3DExpanded ? 'top-20 right-6 left-72 bottom-24' : 'bottom-6 right-6 w-96 h-72'}`}
        >
          <div className="absolute top-0 left-0 right-0 h-10 bg-gradient-to-b from-black/60 to-transparent z-10 flex items-center justify-between px-3 pointer-events-none">
            <span className="text-white text-[10px] font-bold uppercase tracking-widest flex items-center gap-1">
              <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              3D View
            </span>
            <div className="flex gap-2 pointer-events-auto">
              <button onClick={() => setMapType3D(t => t === 'std' ? 'photo' : 'std')} className="p-1.5 hover:bg-white/20 rounded-md text-white"><ImageIcon size={16} /></button>
              <button onClick={() => setIs3DExpanded(!is3DExpanded)} className="p-1.5 hover:bg-white/20 rounded-md text-white">{is3DExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
              <button onClick={() => setShow3D(false)} className="p-1.5 hover:bg-red-500/40 rounded-md text-white font-bold text-sm">✕</button>
            </div>
          </div>

          <Map
            {...viewState}
            onMove={onMove}
            mapLib={maplibregl}
            mapStyle={{
              version: 8,
              sources: {
                'base-tiles': { type: 'raster', tiles: [mapType3D === 'photo' ? GSI_PHOTO_URL : GSI_STD_URL], tileSize: 256, attribution: '国土地理院' },
                'terrainSource': {
                  type: 'raster-dem',
                  tiles: [GSI_DEM_URL],
                  tileSize: 256,
                  encoding: 'custom',
                  minzoom: 9,
                  maxzoom: 14,
                  baseShift: -100000,
                  redFactor: 655.36,
                  greenFactor: 2.56,
                  blueFactor: 0.01
                }
              },
              layers: [{ id: 'base-layer', type: 'raster', source: 'base-tiles' }],
              terrain: { source: 'terrainSource', exaggeration: 1.2 }
            }}
            maxPitch={85}
          >
            {renderMarkers(true)}
          </Map>
        </div>
      )}

      {!show3D && (
        <button onClick={() => setShow3D(true)} className="absolute bottom-6 right-6 z-30 flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-full shadow-2xl transition-all">
          <Eye size={20} /> <span className="font-bold">3Dビューを表示</span>
        </button>
      )}
    </div>
  );
}

export default App;
