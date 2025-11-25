"use client";

import { useEffect, useState, useCallback } from "react";
import dynamic from 'next/dynamic';
import Link from "next/link";
import Navbar from "../../../components/Navbar";
import { useStravaAuth } from "../StravaAuthContext";
import { useRouter } from "next/navigation";
import LoadingGift from "../../../components/LoadingGift";

export default function StravaActivityPage() {
  const { currentUser, authenticatedFetch } = useStravaAuth();
  const router = useRouter();
  const [activities, setActivities] = useState<any[]>([]);
  const [lastRideSegments, setLastRideSegments] = useState<any[] | null>(null);
  const [segmentsLoading, setSegmentsLoading] = useState(false);
  const [segmentSourceActivity, setSegmentSourceActivity] = useState<any | null>(null);
  const [segmentDebug, setSegmentDebug] = useState<{attemptedIds: number[]; lastDetailSample?: any; message?: string; polylineStats?: {unique: number; decoded: number}} >({ attemptedIds: [] });
  const [segmentPolylines, setSegmentPolylines] = useState<[number, number][][]>([]);
  const [segmentCenter, setSegmentCenter] = useState<[number, number] | null>(null);
  const [segmentCounts, setSegmentCounts] = useState<Record<number, number>>({});
  const [segmentCountFallbackRunning, setSegmentCountFallbackRunning] = useState(false);
  const [segmentElevDerived, setSegmentElevDerived] = useState<Record<number, number>>({});
  const [computingCounts, setComputingCounts] = useState(false);
  const [segmentLeaderboards, setSegmentLeaderboards] = useState<Record<number, any>>({});
  const [sortBy, setSortBy] = useState<'name'|'distance'|'time'|'count'|'grade'|'elev'|'kom'>('time');
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('desc');

  const StravaMap = dynamic(() => import('../components/StravaMap'), { ssr: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const rideTypes = [
    'Ride','VirtualRide','EBikeRide','GravelRide','MountainBikeRide','RoadRide','Cyclocross','TrailRide'
  ];
  const isRideType = (t: string) => rideTypes.includes(t);

  const fetchSegmentsForRecentRides = useCallback(async (activitiesList: any[], token: string) => {
    const rideCandidates = activitiesList.filter(a => a?.type && isRideType(a.type));
    const attempted: number[] = [];
    let foundSegments: any[] = [];
    let source: any | null = null;
    let lastDetail: any | undefined = undefined;
    // only examine the last 3 ride-type activities to reduce API calls
    for (const act of rideCandidates.slice(0, 3)) {
      if (!act?.id) continue;
      attempted.push(act.id);
      try {
        const detailRes = await fetch(`https://www.strava.com/api/v3/activities/${act.id}?include_all_efforts=true`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const detailJson = await detailRes.json();
        lastDetail = detailJson;
        if (detailRes.ok && Array.isArray(detailJson.segment_efforts) && detailJson.segment_efforts.length > 0) {
          foundSegments = detailJson.segment_efforts;
          source = act;
          break;
        }
      } catch (err) {
        lastDetail = { error: String(err) };
      }
    }
    if (foundSegments.length === 0) {
      setSegmentDebug({ attemptedIds: attempted, lastDetailSample: lastDetail, message: 'No segment efforts returned for tested recent rides.' });
      setLastRideSegments([]);
      setSegmentSourceActivity(null);
      setSegmentPolylines([]);
    } else {
      foundSegments.sort((a,b) => (b.moving_time||0) - (a.moving_time||0));
      setLastRideSegments(foundSegments);
      setSegmentSourceActivity(source);
      setSegmentDebug({ attemptedIds: attempted, lastDetailSample: { id: source?.id, segment_efforts: foundSegments.length }, message: 'Segments loaded.' });

      // Fetch polylines for each unique segment id
      const uniqueSegmentIds = Array.from(new Set(foundSegments.map(s => s.segment?.id).filter(Boolean)));
      const polyResults: [number, number][][] = [];
      function decodePolyline(encoded: string): [number, number][] {
        let points: [number, number][] = []; let index = 0, lat = 0, lng = 0;
        while (index < encoded.length) { let b, shift = 0, result = 0; do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20); let dlat = ((result & 1) ? ~(result >> 1) : (result >> 1)); lat += dlat; shift = 0; result = 0; do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20); let dlng = ((result & 1) ? ~(result >> 1) : (result >> 1)); lng += dlng; points.push([lat / 1e5, lng / 1e5]); }
        return points;
      }
      for (const segId of uniqueSegmentIds.slice(0, 30)) { // cap to avoid overload
        try {
          const segDetailRes = await fetch(`https://www.strava.com/api/v3/segments/${segId}`, { headers: { Authorization: `Bearer ${token}` } });
          const segDetail = await segDetailRes.json();
          const poly = segDetail?.map?.polyline || segDetail?.map?.summary_polyline; // try summary polyline fallback
            if (segDetailRes.ok && poly) {
              const decoded = decodePolyline(poly);
              if (decoded.length > 1) polyResults.push(decoded);
            }
        } catch (e) {
          // ignore individual failures
        }
      }
      setSegmentPolylines(polyResults);
      if (polyResults.length) {
        const pts = polyResults.flat();
        const avgLat = pts.reduce((a,p)=>a+p[0],0)/pts.length;
        const avgLng = pts.reduce((a,p)=>a+p[1],0)/pts.length;
        setSegmentCenter([avgLat, avgLng]);
      } else {
        setSegmentCenter(null);
      }
      setSegmentDebug(prev => ({...prev, polylineStats: { unique: uniqueSegmentIds.length, decoded: polyResults.length }}));
      // Fetch leaderboards for the segments
      fetchSegmentLeaderboards(foundSegments);
    }
  }, []);

  // Compute counts of how many times each segment appeared across recent ride-type activities (up to 20) for context counts
  const computeSegmentCounts = useCallback(async (activitiesList: any[], token: string) => {
    if (!activitiesList?.length) return;
    setComputingCounts(true);
    try {
      const rideCandidates = activitiesList.filter(a => a?.type && isRideType(a.type)).slice(0, 3);
      const counts: Record<number, number> = {};
      for (const act of rideCandidates) {
        if (!act?.id) continue;
        try {
          const detailRes = await fetch(`https://www.strava.com/api/v3/activities/${act.id}?include_all_efforts=true`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (!detailRes.ok) continue;
            const detail = await detailRes.json();
            if (Array.isArray(detail.segment_efforts)) {
              for (const eff of detail.segment_efforts) {
                const sid = eff?.segment?.id;
                if (!sid) continue;
                counts[sid] = (counts[sid] || 0) + 1;
              }
            }
        } catch (_e) {
          // ignore
        }
      }
      setSegmentCounts(counts);
    } finally {
      setComputingCounts(false);
    }
  }, []);

  // Fallback: if a segment shows in current ride but count is zero, attempt to fetch its efforts list for the athlete (lifetime attempts) via segment efforts endpoint (paginated)
  const fallbackFetchCountsForDisplayed = useCallback(async (token: string, segments: any[]) => {
    if (!segments?.length) return;
    setSegmentCountFallbackRunning(true);
    const updated: Record<number, number> = {};
    try {
      for (const eff of segments) {
        const sid = eff?.segment?.id;
        if (!sid || (segmentCounts[sid] && segmentCounts[sid] > 0) || updated[sid]) continue; // skip if already counted
        // Strava API does not have direct 'lifetime count' simple number; we can approximate by paging through efforts for that segment & athlete
        // NOTE: This can be expensive; we cap to first 3 pages (600 efforts) for safety
        let page = 1; let total = 0; const perPage = 200; let keep = true; let attempts = 0;
        while (keep && page <= 3) {
          attempts++;
          try {
            const url = `https://www.strava.com/api/v3/segments/${sid}/all_efforts?per_page=${perPage}&page=${page}`;
            const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
            if (!res.ok) break;
            const arr = await res.json();
            if (Array.isArray(arr)) {
              total += arr.length;
              if (arr.length < perPage) keep = false; // last page
            } else {
              keep = false;
            }
          } catch {
            keep = false;
          }
          page++;
        }
        if (total > 0) updated[sid] = total; else updated[sid] = 1; // at least current attempt
      }
    } finally {
      if (Object.keys(updated).length) {
        setSegmentCounts(prev => ({ ...prev, ...updated }));
      }
      setSegmentCountFallbackRunning(false);
    }
  }, [segmentCounts]);

  // Fetch leaderboards for segments to get KOM data
  const fetchSegmentLeaderboards = useCallback(async (segments: any[]) => {
    if (!segments?.length) return;
    const uniqueSegmentIds = Array.from(new Set(segments.map(s => s.segment?.id).filter(Boolean)));
    const leaderboards: Record<number, any> = {};
    for (const segId of uniqueSegmentIds.slice(0, 10)) { // limit to 10 to avoid rate limits
      try {
        const res = await authenticatedFetch(`/api/fitness/segments/${segId}/leaderboard`);
        if (res.ok) {
          const data = await res.json();
          leaderboards[segId] = data;
        }
      } catch (e) {
        // ignore errors
      }
    }
    setSegmentLeaderboards(leaderboards);
  }, [authenticatedFetch]);

  useEffect(() => {
    if (!currentUser) {
      setTimeout(() => router.replace('/strava'), 500);
      return;
    }
    async function load() {
      setLoading(true);
      setError(null);
      try {
        if (!currentUser) return; // TS safety
        const cacheKey = `strava_activities_${(currentUser as any)?.id || (currentUser as any)?.athlete_id || (currentUser as any)?.athleteId || 'anon'}`;
        let data: any[] | null = null;
        try {
          const raw = sessionStorage.getItem(cacheKey);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed?.ts && (Date.now() - parsed.ts) < (5 * 60 * 1000) && Array.isArray(parsed.data)) {
              data = parsed.data;
            }
          }
        } catch (_) {}

        if (!data) {
          const res = await fetch(`https://www.strava.com/api/v3/athlete/activities?per_page=3`, {
            headers: { Authorization: `Bearer ${currentUser.accessToken}` }
          });
          const fetched = await res.json();
          if (Array.isArray(fetched)) {
            data = fetched;
            try { sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data })); } catch (_) {}
          } else {
            data = fetched;
          }
        }

        if (Array.isArray(data)) {
          setActivities(data);
          setSegmentsLoading(true);
          await fetchSegmentsForRecentRides(data, currentUser.accessToken);
          // Kick off counts in background (non-blocking)
          computeSegmentCounts(data, currentUser.accessToken);
          setSegmentsLoading(false);
        } else {
          setError((data as any)?.message || 'Unexpected response');
          setActivities([]);
        }
      } catch (e: any) {
        setError(e?.message || 'Failed to fetch activities');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [currentUser, router, fetchSegmentsForRecentRides, computeSegmentCounts]);

  // If user retries scan we may want to recompute counts too
  const handleRetryScan = async () => {
    if (!currentUser) return;
    setSegmentsLoading(true);
    setSegmentDebug({ attemptedIds: [] });
    await fetchSegmentsForRecentRides(activities, currentUser.accessToken);
    computeSegmentCounts(activities, currentUser.accessToken);
    // Kick off fallback in background after initial counts
    setTimeout(()=> fallbackFetchCountsForDisplayed(currentUser.accessToken, lastRideSegments || []), 500);
    setSegmentsLoading(false);
  };

  const formatDuration = (s: number) => {
    if (!Number.isFinite(s)) return '-';
    const hrs = Math.floor(s/3600);
    const mins = Math.floor((s%3600)/60);
    const secs = Math.floor(s%60);
    const mm = hrs > 0 ? String(mins).padStart(2,'0') : String(mins);
    const ss = String(secs).padStart(2,'0');
    return hrs > 0 ? `${hrs}:${mm}:${ss}` : `${mm}:${ss}`;
  };

  // Prepare sorted segments list with counts
  let displayedSegments = lastRideSegments ? [...lastRideSegments] : [];
  if (displayedSegments.length) {
    displayedSegments.sort((a:any,b:any) => {
      const segA = a.segment || {};
      const segB = b.segment || {};
      const countA = segmentCounts[segA.id] || 0;
      const countB = segmentCounts[segB.id] || 0;
      let valA: number | string = 0; let valB: number | string = 0;
      switch (sortBy) {
        case 'name': valA = (segA.name||a.name||'').toLowerCase(); valB = (segB.name||b.name||'').toLowerCase(); break;
        case 'distance': valA = segA.distance || 0; valB = segB.distance || 0; break;
        case 'grade': valA = segA.average_grade ?? 0; valB = segB.average_grade ?? 0; break;
        case 'time': valA = a.moving_time || 0; valB = b.moving_time || 0; break;
        case 'count': valA = countA; valB = countB; break;
        case 'elev': valA = segA.elev_difference || 0; valB = segB.elev_difference || 0; break;
        case 'kom': valA = segmentLeaderboards[segA.id]?.kom_time || Infinity; valB = segmentLeaderboards[segB.id]?.kom_time || Infinity; break;
      }
      if (typeof valA === 'string' && typeof valB === 'string') {
        const cmp = valA.localeCompare(valB);
        return sortDir === 'asc' ? cmp : -cmp;
      }
      const cmp = (valA as number) - (valB as number);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }

  const toggleSort = (field: typeof sortBy) => {
    if (sortBy === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field); setSortDir(field === 'name' ? 'asc' : 'desc');
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Navbar />
      <div className="max-w-5xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">📄 Recent Activities</h1>
        {!currentUser && (
          <div className="p-4 rounded bg-yellow-900/40 border border-yellow-500 text-sm mb-6">
            No user selected. Redirecting to Strava access page...
          </div>
        )}
        {currentUser && (
          <div className="text-sm text-gray-400 mb-4">Using token for <span className="text-emerald-400 font-medium">{currentUser.name}</span></div>
        )}
        {loading && (
          <div className="flex items-center gap-3">
            <LoadingGift variant="activities" size="default" />
            <div className="text-sm text-gray-400">Loading activities...</div>
          </div>
        )}
        {error && !loading && (
          <div className="p-4 rounded bg-red-900/40 border border-red-600 text-sm mb-4">{error}</div>
        )}
        <ul className="divide-y divide-gray-800 rounded overflow-hidden border border-gray-800">
          {activities.length > 0 ? activities.map(activity => (
            <li key={activity.id} className="p-4 hover:bg-gray-800/40 transition">
              <div className="font-medium text-emerald-300">{activity.name || 'Untitled Activity'}</div>
              <div className="text-xs text-gray-400 mt-1 flex flex-wrap gap-3">
                {activity.start_date && <span>{new Date(activity.start_date).toLocaleString()}</span>}
                {activity.type && <span>Type: {activity.type}</span>}
                {activity.distance && <span>Dist: {(activity.distance / 1000).toFixed(2)} km</span>}
                {activity.moving_time && <span>Time: {(activity.moving_time/60).toFixed(0)} min</span>}
                {activity.average_speed && <span>Avg Spd: {(activity.average_speed * 3.6).toFixed(1)} km/h</span>}
              </div>
            </li>
          )) : (!loading && !error && currentUser) ? (
            <li className="p-4 text-sm text-gray-400">No activities found.</li>
          ) : null}
        </ul>

        {/* Last Ride Segments */}
        {lastRideSegments && (
          <div className="mt-10">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
              <h2 className="text-xl font-semibold flex items-center gap-2">🚩 Segments From Recent Ride</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleRetryScan}
                  className="text-xs px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 transition"
                >Retry Scan</button>
                <button
                  onClick={() => currentUser && computeSegmentCounts(activities, currentUser.accessToken)}
                  className="text-xs px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 transition"
                  disabled={computingCounts}
                >{computingCounts ? 'Counting…' : 'Recount Segments'}</button>
              </div>
            </div>
            {segmentSourceActivity && (
              <div className="text-xs text-gray-400 mb-2">Source activity: <span className="text-emerald-300">{segmentSourceActivity.name || 'Untitled'} (ID {segmentSourceActivity.id})</span></div>
            )}
            {segmentsLoading && <div className="text-xs text-gray-400 mb-2"><div className="flex items-center gap-2"><LoadingGift variant="segments" size="small" /><span>Loading segments...</span></div></div>}
            {lastRideSegments.length === 0 && !segmentsLoading && (
              <div className="text-xs text-gray-500">No segments found on your most recent ride.</div>
            )}
            {lastRideSegments.length > 0 && (
              <div className="overflow-x-auto">
                {/* Sorting controls */}
                <div className="flex flex-wrap gap-2 mb-2 text-[11px]">
                  {[
                    ['name','Name'],['distance','Dist'],['grade','Grade'],['time','Your Time'],['kom','KOM Time'],['count','Count'],['elev','Elev'],
                  ].map(([field,label]) => (
                    <button
                      key={field}
                      onClick={() => toggleSort(field as any)}
                      className={`px-2 py-1 rounded border border-gray-700 hover:bg-gray-800 transition ${sortBy===field ? 'bg-gray-800 text-emerald-300' : 'text-gray-300'}`}
                    >{label}{sortBy===field && (sortDir==='asc' ? ' ↑' : ' ↓')}</button>
                  ))}
                  <div className="ml-auto text-gray-500">{Object.keys(segmentCounts).length} segs counted</div>
                </div>
                <table className="w-full text-left text-sm border border-gray-800 rounded-md overflow-hidden">
                  <thead className="bg-gray-800/60 text-gray-300 text-xs uppercase tracking-wide">
                    <tr>
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Distance</th>
                      <th className="px-3 py-2">Avg Grade</th>
                      <th className="px-3 py-2">Your Time</th>
                      <th className="px-3 py-2">KOM Time</th>
                      <th className="px-3 py-2">KOM Athlete</th>
                      <th className="px-3 py-2">Count</th>
                      <th className="px-3 py-2">PR Rank</th>
                      <th className="px-3 py-2">Elevation Gain</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {displayedSegments.map((effort: any) => {
                      const segId = effort.segment?.id;
                      const leaderboard = segId ? segmentLeaderboards[segId] : null;
                      const komEntry = leaderboard?.entries?.[0];
                      return (
                        <tr key={effort.id} className="hover:bg-gray-800/40 transition">
                          <td className="px-3 py-2 max-w-[220px] truncate" title={effort.name}>{effort.name || effort.segment?.name || 'Segment'}</td>
                          <td className="px-3 py-2 text-gray-300">{effort.segment?.distance ? (effort.segment.distance / 1000).toFixed(2) + ' km' : '-'}</td>
                          <td className="px-3 py-2 text-gray-300">{effort.segment?.average_grade != null ? effort.segment.average_grade.toFixed(1) + '%' : '-'}</td>
                          <td className="px-3 py-2 text-gray-300">{effort.moving_time ? formatDuration(effort.moving_time) : '-'}</td>
                          <td className="px-3 py-2 text-gray-300">{komEntry ? formatDuration(komEntry.elapsed_time) : '-'}</td>
                          <td className="px-3 py-2 text-gray-300 max-w-[120px] truncate" title={komEntry?.athlete_name}>{komEntry?.athlete_name || '-'}</td>
                          <td className="px-3 py-2 text-gray-300">{segmentCounts[segId] || 0}{segmentCountFallbackRunning && (segmentCounts[segId]||0)===0 && ' …'}</td>
                          <td className="px-3 py-2 text-gray-300">{effort.pr_rank || '-'}</td>
                          <td className="px-3 py-2 text-gray-300">
                            {(() => {
                              const seg = effort.segment || {};
                              // Strava sometimes provides elevation gain as elev_difference; fallback to total_elevation_gain or compute from start/end alt if available
                              if (seg.elev_difference) return Math.round(seg.elev_difference) + ' m';
                              const gain = seg.total_elevation_gain || seg.climb_total_elevation_gain;
                              if (gain) return Math.round(gain) + ' m';
                              // derive from altitude_high - altitude_low
                              if (seg.elevation_high != null && seg.elevation_low != null) {
                                const derived = Math.max(0, seg.elevation_high - seg.elevation_low);
                                if (derived > 0) return Math.round(derived) + ' m';
                              }
                              return '-';
                            })()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-2 text-[10px] text-gray-500">Data scans up to 3 recent ride-type activities until segment efforts are found.</div>
            {segmentPolylines.length > 0 && (
              <div className="mt-6 border border-gray-800 rounded-md overflow-hidden">
                <div className="px-3 py-2 bg-gray-800/60 text-xs uppercase tracking-wide text-gray-300 flex items-center justify-between">
                  <span>Segment Map ({segmentPolylines.length} polylines)</span>
                  <span className="text-[10px] text-gray-400">pan/zoom to explore</span>
                </div>
                <div style={{height:'320px', width:'100%', background:'#111'}}>
                  {segmentCenter && <StravaMap polylines={segmentPolylines} center={segmentCenter} />}
                  {!segmentCenter && <div className="h-full flex items-center justify-center text-xs text-gray-500">No geometry available.</div>}
                </div>
              </div>
            )}
            {segmentDebug?.attemptedIds.length > 0 && (
              <details className="mt-3 text-[11px] text-gray-400 whitespace-pre-wrap break-all bg-gray-900/40 p-3 rounded border border-gray-800">
                <summary className="cursor-pointer text-emerald-300">Debug Segment Fetch</summary>
                Tried IDs: {segmentDebug.attemptedIds.join(', ')}
                {segmentDebug.message && `\nStatus: ${segmentDebug.message}`}
                {segmentDebug.lastDetailSample && `\nLast Detail Sample: ${JSON.stringify(segmentDebug.lastDetailSample).slice(0,600)}...`}
                {segmentDebug.polylineStats && `\nPolyline Stats: unique=${segmentDebug.polylineStats.unique} decoded=${segmentDebug.polylineStats.decoded}`}
              </details>
            )}
          </div>
        )}
        <div className="mt-6 text-xs text-gray-500">
          Need a different account? <Link href="/strava" className="text-emerald-400 hover:underline">Switch user</Link>
        </div>
      </div>
    </div>
  );
}