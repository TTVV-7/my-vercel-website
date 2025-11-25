"use client";

import { useEffect, useState } from "react";
import Navbar from "../../../components/Navbar";
import LoadingGift from "../../../components/LoadingGift";
import dynamic from "next/dynamic";
import { useStravaAuth } from "../StravaAuthContext";

const MapPicker = dynamic(() => import("../components/MapPicker"), { ssr: false });

export default function KomFinderPage() {
  const { currentUser, authenticatedFetch } = useStravaAuth();
  const [komAddress, setKomAddress] = useState("");
  const [komRadius, setKomRadius] = useState(5);
  const [komMaxLeaderboard, setKomMaxLeaderboard] = useState(10);
  const [komLoading, setKomLoading] = useState(false);
  const [komResults, setKomResults] = useState<any[]>([]);
  const [komError, setKomError] = useState<string | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [loadingStatus, setLoadingStatus] = useState<string>("");
  const [useMock, setUseMock] = useState(false);
  const [activityType, setActivityType] = useState<'riding' | 'running'>('riding');
  const [selectedSegment, setSelectedSegment] = useState<any | null>(null);
  const [leaderboardData, setLeaderboardData] = useState<any | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [segmentTestResults, setSegmentTestResults] = useState<Record<string, any>>({});

  const handleKomSearch = async () => {
    if (!currentUser) {
      setKomError("No Strava user selected");
      return;
    }
    setKomLoading(true);
    setKomError(null);
    setKomResults([]);
    setLoadingStatus("");

    try {
      let lat = selectedLocation?.lat;
      let lng = selectedLocation?.lng;
      if (!lat || !lng) {
        if (!komAddress.trim()) {
          setKomError("Please enter an address or select a location on the map");
          setKomLoading(false);
          return;
        }
      }

      const requestBody = {
        address: komAddress.trim() || undefined,
        lat,
        lng,
        radius: komRadius,
        maxResults: 30,
        activityType,
        mock: useMock,
        fetchEffortCounts: !!currentUser && !useMock,
      };

      setLoadingStatus("🌍 Geocoding / searching...");
      const res = await authenticatedFetch('/api/fitness/segments/nearby', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      const data = await res.json();
      if (!res.ok) {
        setKomError(data.error || `Failed to fetch nearby segments (${res.status})`);
        setLoadingStatus("");
        setKomLoading(false);
        return;
      }

      const allSegments = data.segments || [];
      const filtered = allSegments.filter((s: any) => !s.effort_count || s.effort_count <= komMaxLeaderboard);
      setKomResults(filtered);
      if (filtered.length === 0 && allSegments.length > 0) {
        setKomError("No beatable segments found. Try increasing the max leaderboard size.");
      } else if (allSegments.length === 0) {
        setKomError("No segments found in this area. Try increasing the radius or choosing a different location.");
      }
    } catch (err: any) {
      console.error('KOM search error:', err);
      setKomError(err.message || 'Unknown error');
    } finally {
      setKomLoading(false);
      setLoadingStatus("");
    }
  };

  const handleInspectSegment = async (segment: any) => {
    if (!currentUser) return;
    setSelectedSegment(segment);
    setLeaderboardData(null);
    try {
      const res = await authenticatedFetch(`/api/fitness/segments/${segment.id}/leaderboard${useMock ? '?mock=true' : ''}`);
      const data = await res.json();
      if (!res.ok) {
        setLeaderboardData({ error: data.error || 'Failed to fetch leaderboard' });
        return;
      }
      setLeaderboardData(data);
    } catch (err: any) {
      setLeaderboardData({ error: err.message || 'Unknown error' });
    }
  };

  const handleTestSegment = async (segment: any) => {
    if (!currentUser) return;
    setTestLoading(true);
    setSegmentTestResults(prev => ({ ...prev, [segment.id]: null }));
    try {
      const res = await authenticatedFetch(`/api/fitness/segments/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segmentId: segment.id })
      });
      const data = await res.json();
      setSegmentTestResults(prev => ({ ...prev, [segment.id]: { status: res.status, ok: res.ok, data } }));
    } catch (err: any) {
      setSegmentTestResults(prev => ({ ...prev, [segment.id]: { error: err.message || 'Unknown error' } }));
    } finally {
      setTestLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Navbar />
      <div className="max-w-5xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-6">🏆 Find Beatable KOMs / QOMs</h1>

        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="text-sm font-semibold">📍 Address</label>
              <input value={komAddress} onChange={(e) => setKomAddress(e.target.value)} className="w-full mt-2 p-3 rounded-lg bg-gray-800 text-sm" placeholder="Enter address or leave blank to pick on map" />
            </div>
            <div>
              <label className="text-sm font-semibold">📏 Radius (km)</label>
              <select value={komRadius} onChange={(e) => setKomRadius(Number(e.target.value))} className="w-full mt-2 p-3 rounded-lg bg-gray-800 text-sm">
                <option value={1}>1 km</option>
                <option value={3}>3 km</option>
                <option value={5}>5 km</option>
                <option value={10}>10 km</option>
                <option value={15}>15 km</option>
              </select>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div>
              <label className="text-sm font-semibold">🚴 Activity Type</label>
              <div className="mt-2 flex gap-2">
                <button onClick={() => setActivityType('riding')} className={`px-3 py-2 rounded ${activityType === 'riding' ? 'bg-amber-500 text-black' : 'bg-gray-800'}`}>Cycling</button>
                <button onClick={() => setActivityType('running')} className={`px-3 py-2 rounded ${activityType === 'running' ? 'bg-amber-500 text-black' : 'bg-gray-800'}`}>Running</button>
              </div>
            </div>

            <div>
              <label className="text-sm font-semibold">👥 Max Leaderboard</label>
              <input type="number" min={1} max={50} value={komMaxLeaderboard} onChange={(e) => setKomMaxLeaderboard(Number(e.target.value))} className="w-full mt-2 p-3 rounded-lg bg-gray-800 text-sm" />
            </div>

            <div>
              <label className="text-sm font-semibold">Demo Data</label>
              <div className="mt-2">
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={useMock} onChange={(e) => setUseMock(e.target.checked)} /> Use demo data
                </label>
              </div>
            </div>
          </div>

          <div className="mt-4">
            <label className="text-sm font-semibold">Map Picker (optional)</label>
            <div className="mt-2 border rounded-lg overflow-hidden" style={{ height: 300 }}>
              <MapPicker onLocationSelect={(lat, lng) => { setSelectedLocation({ lat, lng }); setKomAddress(''); }} selectedLocation={selectedLocation} />
            </div>
          </div>

          <div className="mt-4 flex gap-3">
            <button onClick={handleKomSearch} className={`px-6 py-3 rounded-lg font-semibold ${komLoading ? 'bg-gray-600' : 'bg-emerald-600'}`}>
              {komLoading ? (<span className="flex items-center gap-2"><LoadingGift size="18px" variant="segments" /> Searching...</span>) : '🔍 Search'}
            </button>
            <div className="text-sm text-gray-400 self-center">{loadingStatus}</div>
          </div>
        </div>

        {komError && <div className="mb-4 p-3 bg-red-900/30 rounded text-sm text-red-300">⚠️ {komError}</div>}

        {komResults.length > 0 && (
          <div className="space-y-4">
            {komResults.map((seg) => (
              <div key={seg.id} className="p-4 bg-gray-900/40 border border-gray-800 rounded-lg">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-semibold text-lg">{seg.name}</div>
                    <div className="text-sm text-gray-400">{(seg.distance / 1000).toFixed(2)} km • {seg.avg_grade?.toFixed(1)}% • {seg.effort_count != null ? seg.effort_count : '?' } efforts</div>
                    {seg.leaderboard_forbidden && <div className="text-amber-300 text-sm mt-2">⚠️ Leaderboard restricted — cannot fetch effort counts with current token.</div>}
                    {seg.leaderboard_error && !seg.leaderboard_forbidden && <div className="text-red-400 text-sm mt-2">⚠️ Error fetching leaderboard: {String(seg.leaderboard_error).slice(0, 120)}</div>}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => handleInspectSegment(seg)} className="px-3 py-2 bg-sky-600 rounded">Inspect</button>
                    <button onClick={() => handleTestSegment(seg)} className="px-3 py-2 bg-gray-700 rounded">Test Access</button>
                  </div>
                </div>

                {segmentTestResults[seg.id] && (
                  <pre className="mt-3 p-3 bg-black/60 rounded text-xs overflow-x-auto">{JSON.stringify(segmentTestResults[seg.id], null, 2)}</pre>
                )}
              </div>
            ))}
          </div>
        )}

        {selectedSegment && (
          <div className="mt-6 p-4 bg-yellow-900/20 border border-yellow-500/30 rounded-lg">
            <h3 className="font-semibold">Leaderboard: {selectedSegment.name}</h3>
            {!leaderboardData && <p>Loading leaderboard...</p>}
            {leaderboardData?.error && <div className="text-red-400">⚠️ {leaderboardData.error}</div>}
            {leaderboardData && !leaderboardData.error && (
              <div className="mt-2">
                <div className="text-sm">Total efforts: {leaderboardData.effort_count || 0} • KOM time: {leaderboardData.kom_time ? `${Math.floor(leaderboardData.kom_time/60)}:${(leaderboardData.kom_time%60).toString().padStart(2,'0')}` : 'N/A'}</div>
                {leaderboardData.entries?.length > 0 && (
                  <table className="w-full mt-3 text-sm">
                    <thead className="text-left text-gray-300"><tr><th>Rank</th><th>Athlete</th><th>Time</th></tr></thead>
                    <tbody>
                      {leaderboardData.entries.map((e: any, i: number) => (
                        <tr key={i} className="border-t border-gray-800"><td className="py-2">{e.rank}</td><td>{e.athlete_name}</td><td>{Math.floor(e.elapsed_time/60)}:{(e.elapsed_time%60).toString().padStart(2,'0')}</td></tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
