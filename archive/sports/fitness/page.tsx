"use client";

import { useState } from 'react';
import Navbar from "../../../components/Navbar";
import dynamic from 'next/dynamic';
import { useStravaAuth } from './StravaAuthContext';

const StravaMap = dynamic(() => import('./components/StravaMap'), { ssr: false });

type Segment = {
  id: number|string;
  name: string;
  distance: number;
  avg_grade?: number;
  elev_difference?: number;
  polyline?: string;
  effort_count?: number|null;
  kom_time?: number|null;
};

function decodePolyline(encoded: string): [number, number][] {
  // Minimal Google polyline decode implementation
  let points: [number, number][] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let result = 0, shift = 0, b: number;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    const deltaLat = (result & 1) ? ~(result >> 1) : (result >> 1);
    lat += deltaLat;
    result = 0; shift = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    const deltaLng = (result & 1) ? ~(result >> 1) : (result >> 1);
    lng += deltaLng;
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

export default function FitnessSegmentsBare() {
  const { currentUser, authenticatedFetch } = useStravaAuth();
  const [address, setAddress] = useState('');
  const [radius, setRadius] = useState(5);
  const [activityType, setActivityType] = useState<'riding'|'running'>('riding');
  const [useMock, setUseMock] = useState(false);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string|null>(null);
  const [selected, setSelected] = useState<Segment|null>(null);

  const handleFetch = async () => {
    setLoading(true);
    setError(null);
    setSegments([]);
    try {
      const body = {
        address: address || undefined,
        radius,
        activityType,
        mock: useMock,
        fetchEffortCounts: !!currentUser && !useMock,
        token: currentUser?.accessToken
      };
      const res = await authenticatedFetch('/api/fitness/segments/nearby', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to fetch segments');
        return;
      }
      setSegments(data.segments || []);
    } catch (e:any) {
      setError(e.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const mapPolylines: [number, number][][] = segments
    .map(s => (s.polyline ? decodePolyline(s.polyline) : []))
    .filter(p => p.length > 0);
  const highlighted: [number, number][][] = selected && selected.polyline ? [decodePolyline(selected.polyline)] : [];
  const center: [number, number] = mapPolylines.length > 0 ? mapPolylines[0][0] : [49.2827, -123.1207]; // Default: Vancouver

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold mb-4">Segments Explorer (Bare)</h1>
        <div className="grid md:grid-cols-3 gap-4 mb-6">
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-wide">Address (optional)</label>
            <input value={address} onChange={e=>setAddress(e.target.value)} placeholder="e.g. Vancouver, BC" className="w-full p-2 rounded bg-gray-800 text-sm" />
            <label className="text-xs uppercase tracking-wide">Radius (km)</label>
            <select value={radius} onChange={e=>setRadius(Number(e.target.value))} className="w-full p-2 rounded bg-gray-800 text-sm">
              {[1,3,5,10,15].map(r=> <option key={r} value={r}>{r} km</option>)}
            </select>
            <label className="text-xs uppercase tracking-wide">Activity</label>
            <div className="flex gap-2">
              <button onClick={()=>setActivityType('riding')} className={`px-3 py-1 rounded text-sm ${activityType==='riding'?'bg-emerald-600':'bg-gray-700'}`}>Cycling</button>
              <button onClick={()=>setActivityType('running')} className={`px-3 py-1 rounded text-sm ${activityType==='running'?'bg-emerald-600':'bg-gray-700'}`}>Running</button>
            </div>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={useMock} onChange={e=>setUseMock(e.target.checked)} /> Mock data</label>
            <button disabled={loading} onClick={handleFetch} className={`w-full mt-2 p-2 rounded font-semibold ${loading?'bg-gray-600':'bg-emerald-600'}`}>{loading?'Loading...':'Fetch Segments'}</button>
            {error && <div className="text-red-400 text-xs mt-2">⚠️ {error}</div>}
            {!currentUser && <div className="text-amber-400 text-xs mt-2">Connect Strava for live data.</div>}
            <div className="text-xs text-gray-400 mt-4">Algorithm phase next: we will compute rankings / scoring once base list stabilized.</div>
          </div>
          <div className="md:col-span-2 h-[500px] rounded overflow-hidden border border-gray-800 bg-gray-900">
            <StravaMap polylines={mapPolylines} center={center} highlightedPolylines={highlighted} />
          </div>
        </div>
        <div className="space-y-2">
          {segments.map(s => (
            <button
              key={s.id}
              onClick={()=> setSelected(s)}
              className={`w-full text-left p-3 rounded border text-sm transition ${selected?.id===s.id? 'border-emerald-500 bg-emerald-900/20':'border-gray-800 bg-gray-900/40 hover:bg-gray-900/60'}`}
            >
              <div className="flex justify-between">
                <span className="font-medium text-emerald-300">{s.name}</span>
                <span className="text-xs text-gray-400">{(s.distance/1000).toFixed(2)} km</span>
              </div>
              <div className="text-xs text-gray-400 mt-1 flex gap-4">
                <span>Grade: {s.avg_grade?.toFixed(1) ?? '—'}%</span>
                <span>Efforts: {s.effort_count ?? '—'}</span>
                <span>KOM: {s.kom_time != null ? `${Math.floor((s.kom_time)/60)}:${(s.kom_time%60).toString().padStart(2,'0')}` : '—'}</span>
              </div>
            </button>
          ))}
          {segments.length === 0 && !loading && <div className="text-xs text-gray-500">No segments loaded yet.</div>}
        </div>
      </div>
    </div>
  );
}
