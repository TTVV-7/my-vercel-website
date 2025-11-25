"use client";

import { useEffect, useState } from "react";
import Navbar from "../../../components/Navbar";
import LoadingGift from "../../../components/LoadingGift";
import dynamic from "next/dynamic";
import { useStravaAuth } from "../StravaAuthContext";

const StravaMap = dynamic(() => import("../components/StravaMap"), { ssr: false });
const MapPicker = dynamic(() => import("../components/MapPicker"), { ssr: false });

// Access token now supplied by context (user-selected). No hard-coded token.

// Helper function to get start of current week (Monday)
function getStartOfWeek(): Date {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
  const monday = new Date(now.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

// Helper function to check if date is within current week
function isWithinCurrentWeek(dateString: string): boolean {
  const activityDate = new Date(dateString);
  const startOfWeek = getStartOfWeek();
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 7);
  
  return activityDate >= startOfWeek && activityDate < endOfWeek;
}

function decodePolyline(encoded: string): [number, number][] {
  let points: [number, number][] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    let dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += dlat;
    shift = 0; result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    let dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lng += dlng;
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

async function fetchSegments(
  token: string,
  setSegmentPolylines: React.Dispatch<React.SetStateAction<[number, number][][]>>,
  setApiError: React.Dispatch<React.SetStateAction<string | null>>,
  activities?: any[],
  setUserSegmentBestTimes?: React.Dispatch<React.SetStateAction<Record<string, number>>>
) {
  try {
    let acts = activities;
    if (!Array.isArray(acts)) {
      const res = await fetch("https://www.strava.com/api/v3/athlete/activities?per_page=3", {
        headers: { Authorization: `Bearer ${token}` },
      });
      acts = await res.json();
    }

    if (!Array.isArray(acts)) {
      setApiError(
        (acts as any)?.message
          ? `Strava API error: ${(acts as any).message}`
          : "Unexpected activities response (not an array)."
      );
      return;
    }

    const segmentIds = new Set<string>();
    const bestTimes: Record<string, number> = {};
    for (const activity of acts.slice(0, 3)) {
      if (!activity?.id) continue;
      try {
        const segRes = await fetch(`https://www.strava.com/api/v3/activities/${activity.id}/streams?keys=segment_efforts`, { headers: { Authorization: `Bearer ${token}` } });
        const segData = await segRes.json();
        if (segData?.segment_efforts) {
          for (const effort of segData.segment_efforts) {
            if (effort?.segment?.id) segmentIds.add(effort.segment.id.toString());
            // record user's elapsed_time for each segment effort (take best / min)
            try {
              if (effort?.segment?.id && typeof effort.elapsed_time === 'number') {
                const sid = effort.segment.id.toString();
                const prev = bestTimes[sid];
                if (!prev || effort.elapsed_time < prev) bestTimes[sid] = effort.elapsed_time;
              }
            } catch (e) {}
          }
        }
      } catch (err) {
        console.warn("Failed to fetch segments for activity", activity.id, err);
      }
    }

    const polylines: [number, number][][] = [];
    for (const segmentId of Array.from(segmentIds).slice(0, 10)) {
      try {
        const segDetailRes = await fetch(`https://www.strava.com/api/v3/segments/${segmentId}`, { headers: { Authorization: `Bearer ${token}` } });
        const segDetail = await segDetailRes.json();
        if (segDetail?.map?.polyline) {
          const decoded = decodePolyline(segDetail.map.polyline);
            if (decoded.length > 1) polylines.push(decoded);
        }
      } catch (err) {
        console.warn("Failed segment detail", segmentId, err);
      }
    }
    setSegmentPolylines(polylines);
    if (setUserSegmentBestTimes) setUserSegmentBestTimes(bestTimes);
  } catch (error: any) {
    console.error("Error fetching segments root:", error);
    setApiError(error?.message || "Unknown error fetching segments");
  }
}

// New function to fetch weekly unique segments
async function fetchWeeklyUniqueSegments(
  token: string,
  setWeeklySegments: React.Dispatch<React.SetStateAction<Set<string>>>,
  setApiError: React.Dispatch<React.SetStateAction<string | null>>,
  activities?: any[]
) {
  try {
    let acts = activities;
    if (!Array.isArray(acts)) {
      const res = await fetch("https://www.strava.com/api/v3/athlete/activities?per_page=3", {
        headers: { Authorization: `Bearer ${token}` },
      });
      acts = await res.json();
    }

    if (!Array.isArray(acts)) {
      setApiError(
        (acts as any)?.message
          ? `Strava API error: ${(acts as any).message}`
          : "Unexpected weekly activities response (not an array)."
      );
      return;
    }

    const weeklyActivities = acts.filter((activity: any) =>
      activity?.start_date && isWithinCurrentWeek(activity.start_date)
    );

    const weeklySegmentIds = new Set<string>();
    for (const activity of weeklyActivities.slice(0, 3)) {
      if (!activity?.id) continue;
      try {
        const segRes = await fetch(`https://www.strava.com/api/v3/activities/${activity.id}/streams?keys=segment_efforts`, { headers: { Authorization: `Bearer ${token}` } });
        const segData = await segRes.json();
        if (segData?.segment_efforts) {
          for (const effort of segData.segment_efforts) {
            if (effort?.segment?.id) weeklySegmentIds.add(effort.segment.id.toString());
          }
        }
      } catch (err) {
        console.warn("Failed weekly segment fetch", activity.id, err);
      }
    }
    setWeeklySegments(weeklySegmentIds);
  } catch (error: any) {
    console.error("Error fetching weekly segments:", error);
    setApiError(error?.message || "Unknown error fetching weekly segments");
  }
}

export default function StravaStatsPage() {
  const [segmentPolylines, setSegmentPolylines] = useState<[number, number][][]>([]);
  const [userSegmentBestTimes, setUserSegmentBestTimes] = useState<Record<string, number>>({});
  const [weeklySegments, setWeeklySegments] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const mapCenter: [number, number] = [49.2827, -123.1207];
  const { currentUser, authenticatedFetch } = useStravaAuth();

  // KOM Finder state
  // Show KOM panel by default (right-side box)
  const [showKomModal, setShowKomModal] = useState(true);
  const [komAddress, setKomAddress] = useState("");
  const [komRadius, setKomRadius] = useState(5);
  const [komMaxLeaderboard, setKomMaxLeaderboard] = useState(10);
  const [komLoading, setKomLoading] = useState(false);
  const [komResults, setKomResults] = useState<any[]>([]);
  const [komError, setKomError] = useState<string | null>(null);
  const [selectedSegment, setSelectedSegment] = useState<any | null>(null);
  const [leaderboardData, setLeaderboardData] = useState<any | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<any | null>(null);
  const [segmentTestResults, setSegmentTestResults] = useState<Record<string, any>>({});
  const [showMapPicker, setShowMapPicker] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [loadingStatus, setLoadingStatus] = useState<string>("");
  const [useMock, setUseMock] = useState(false);
  const [activityType, setActivityType] = useState<'riding' | 'running'>('riding');

  const [highlightedPolylines, setHighlightedPolylines] = useState<[number, number][][]>([]);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setApiError(null);
      if (!currentUser) {
        setSegmentPolylines([]);
        setWeeklySegments(new Set());
        setApiError('No user selected. Go to Strava page to choose a token.');
        setLoading(false);
        return;
      }
      // cache activities short-term to avoid repeated API calls
      const cacheKey = `strava_activities_${(currentUser as any)?.id || (currentUser as any)?.athlete_id || (currentUser as any)?.athleteId || 'anon'}`;
      let activities: any[] | null = null;
      try {
        const raw = sessionStorage.getItem(cacheKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.ts && (Date.now() - parsed.ts) < (5 * 60 * 1000) && Array.isArray(parsed.data)) {
            activities = parsed.data;
          }
        }
      } catch (e) {}

      if (!activities) {
        try {
          const res = await fetch("https://www.strava.com/api/v3/athlete/activities?per_page=3", { headers: { Authorization: `Bearer ${currentUser.accessToken}` } });
          const fetched = await res.json();
          if (Array.isArray(fetched)) {
            activities = fetched;
            try { sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: activities })); } catch (_) {}
          } else {
            activities = fetched;
          }
        } catch (e) {
          activities = null;
        }
      }

      await Promise.all([
        fetchSegments(currentUser.accessToken, setSegmentPolylines, setApiError, activities as any, setUserSegmentBestTimes),
        fetchWeeklyUniqueSegments(currentUser.accessToken, setWeeklySegments, setApiError, activities as any)
      ]);
      setLoading(false);
    };
    loadData();
  }, [currentUser]);

  // KOM Finder handlers
  const handleKomSearch = async () => {
    if (!currentUser) {
      setKomError("No Strava user selected");
      return;
    }
    
    console.log("Starting KOM search...");
    setKomLoading(true);
    setKomError(null);
    setKomResults([]);
    setLoadingStatus("");
    
    try {
      // Prepare location
      let lat = selectedLocation?.lat;
      let lng = selectedLocation?.lng;
      
      if (!lat || !lng) {
        if (!komAddress.trim()) {
          setKomError("Please enter an address or select a location on the map");
          setKomLoading(false);
          return;
        }
        console.log("Geocoding address:", komAddress);
        setLoadingStatus("🌍 Geocoding address...");
      } else {
        console.log("Using selected location:", lat, lng);
        setLoadingStatus("📍 Using selected location...");
      }

      const requestBody = {
        address: komAddress.trim() || undefined,
        lat,
        lng,
        radius: komRadius,
        maxResults: 30,
        activityType: activityType,
        mock: useMock,
        fetchEffortCounts: !!currentUser && !useMock,
      };
      
      console.log("Sending request to /api/fitness/segments/nearby (safe):", { ...requestBody });

      const res = await authenticatedFetch("/api/fitness/segments/nearby", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      
      setLoadingStatus("🔍 Searching for nearby segments...");
      const data = await res.json();
      
      console.log("API Response:", { status: res.status, ok: res.ok, data });
      
      if (!res.ok) {
        console.error("API Error:", data);
        setKomError(data.error || `Failed to fetch nearby segments (${res.status})`);
        setLoadingStatus("");
        return;
      }
      
      setLoadingStatus("📊 Filtering beatable segments...");
      
      console.log("Total segments found:", data.segments?.length || 0);
      
      // Filter results: if effort_count exists, filter by max leaderboard size; otherwise show all
      const allSegments = data.segments || [];
      const filtered = allSegments.filter(
        (s: any) => !s.effort_count || s.effort_count <= komMaxLeaderboard
      );
      
      console.log("Filtered beatable segments:", filtered.length);
      
      setLoadingStatus("");
        // compute user comparisons and decode polylines for highlighting
        const highlights: [number, number][][] = [];
        const enriched = filtered.map((s: any) => {
          const seg = { ...s };
          // decode polyline if present
          try {
            if (seg.polyline && typeof seg.polyline === 'string') {
              const decoded = decodePolyline(seg.polyline);
              if (decoded.length > 1) highlights.push(decoded);
              seg._decoded_polyline = decoded;
            }
          } catch (e) {}

          // attach user's best time if available (from recent activities)
          try {
            const uidBest = userSegmentBestTimes?.[seg.id?.toString()];
            if (typeof uidBest === 'number') {
              seg.user_best_time = uidBest;
            }
            if (seg.kom_time && seg.user_best_time) {
              seg.seconds_behind_kom = seg.user_best_time - seg.kom_time;
              seg.pct_behind = (seg.seconds_behind_kom / Math.max(1, seg.kom_time)) * 100;
            }
          } catch (e) {}

          return seg;
        });

        setKomResults(enriched);
        setHighlightedPolylines(highlights);
      
      if (filtered.length === 0 && allSegments.length > 0) {
        setKomError("No beatable segments found. Try increasing the max leaderboard size.");
      } else if (allSegments.length === 0) {
        setKomError("No segments found in this area. Try increasing the radius or choosing a different location.");
      }
    } catch (err: any) {
      console.error("KOM search error:", err);
      setKomError(err.message || "Unknown error");
      setLoadingStatus("");
    } finally {
      setKomLoading(false);
      console.log("KOM search complete");
    }
  };

  const handleInspectSegment = async (segment: any) => {
    if (!currentUser) return;
    setSelectedSegment(segment);
    setLeaderboardData(null);
    try {
      const res = await authenticatedFetch(
        `/api/fitness/segments/${segment.id}/leaderboard${useMock ? '?mock=true' : ''}`
      );
      const data = await res.json();
      if (!res.ok) {
        setLeaderboardData({ error: data.error || "Failed to fetch leaderboard" });
        return;
      }
      setLeaderboardData(data);
    } catch (err: any) {
      setLeaderboardData({ error: err.message || "Unknown error" });
    }
  };

  const handleTestSegment = async (segment: any) => {
    if (!currentUser) return;
    setTestLoading(true);
    // clear previous for this segment
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
    <div style={{ height: "100vh", width: "100vw", display: "flex", flexDirection: "column" }}>
      <Navbar />
      
      {/* Header with Stats */}
      <div style={{ padding: "20px", backgroundColor: "#f8f9fa", borderBottom: "1px solid #dee2e6" }}>
        <h1 style={{ margin: "0 0 16px 0", fontSize: "28px", fontWeight: "bold" }}>
          🏃‍♂️ Strava Stats Dashboard
        </h1>
        
        {/* Weekly Segments Counter */}
        <div style={{ 
          display: "flex", 
          alignItems: "center", 
          gap: "20px", 
          flexWrap: "wrap" 
        }}>
          {/* Left header cleaned: KOM Finder is primary action */}

          {/* KOM Finder Button */}
          <button
            onClick={() => setShowKomModal(true)}
            style={{
              backgroundColor: "#FF6F00",
              color: "white",
              padding: "12px 20px",
              borderRadius: "12px",
              fontWeight: "bold",
              fontSize: "16px",
              border: "none",
              cursor: "pointer",
              boxShadow: "0 4px 12px rgba(255, 111, 0, 0.4)",
              transition: "all 0.2s"
            }}
            onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.05)"}
            onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"}
          >
            🏆 Find Beatable KOMs/QOMs
          </button>
          
          {weeklySegments.size > 0 && (
            <div style={{
              backgroundColor: "#2196F3",
              color: "white",
              padding: "8px 16px", 
              borderRadius: "8px",
              fontSize: "14px",
              boxShadow: "0 2px 8px rgba(33, 150, 243, 0.3)"
            }}>
              Week of {getStartOfWeek().toLocaleDateString()}
            </div>
          )}
        </div>
        
        {loading && (
          <div style={{ 
            marginTop: "12px", 
            color: "#666",
            fontStyle: "italic" 
          }}>
            🔄 Loading your Strava data...
          </div>
        )}
        {apiError && !loading && (
          <div style={{
            marginTop: "12px",
            color: "#b91c1c",
            background: "#fee2e2",
            padding: "10px 14px",
            borderRadius: "8px",
            fontSize: "14px",
            maxWidth: "640px"
          }}>
            ⚠️ {apiError}<br />
            <span style={{ fontSize: '12px', opacity: 0.8 }}>
              (Tip: Verify your access token, scopes, and rate limits. If token is expired, generate a new one.)
            </span>
          </div>
        )}
      </div>

      {/* Map Container */}
      <div style={{ flex: 1, width: "100%", position: 'relative' }}>
        <StravaMap polylines={segmentPolylines} center={mapCenter} highlightedPolylines={highlightedPolylines} />
      </div>

      {/* KOM Finder Modal */}
      {showKomModal && (
        <div style={{
          position: 'fixed',
          top: 80,
          right: 20,
          width: 380,
          bottom: 20,
          zIndex: 1100,
          display: 'flex',
          flexDirection: 'column'
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: 12,
            padding: 16,
            width: '100%',
            height: '100%',
            overflowY: 'auto',
            boxShadow: '0 10px 30px rgba(0,0,0,0.25)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>🏆 KOM Finder</h3>
              <button onClick={() => setShowKomModal(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
              <h2 style={{ margin: 0, fontSize: "24px", fontWeight: "bold" }}>🏆 Find Beatable KOMs/QOMs</h2>
              <button
                onClick={() => {
                  setShowKomModal(false);
                  setKomResults([]);
                  setKomError(null);
                  setSelectedSegment(null);
                  setLeaderboardData(null);
                }}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: "28px",
                  cursor: "pointer",
                  color: "#666"
                }}
              >
                ×
              </button>
            </div>

            {/* Search Form */}
            <div style={{ marginBottom: "24px" }}>
              <div style={{ display: "flex", gap: "12px", marginBottom: "16px" }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", marginBottom: "8px", fontWeight: "600" }}>
                    📍 Address
                  </label>
                  <input
                    type="text"
                    value={komAddress}
                    onChange={(e) => setKomAddress(e.target.value)}
                    placeholder="e.g., Vancouver, BC"
                    style={{
                      width: "100%",
                      padding: "12px",
                      borderRadius: "8px",
                      border: "2px solid #ddd",
                      fontSize: "16px"
                    }}
                  />
                </div>
                <button
                  onClick={() => setShowMapPicker(!showMapPicker)}
                  style={{
                    padding: "12px 20px",
                    backgroundColor: showMapPicker ? "#FF6F00" : "#2196F3",
                    color: "white",
                    border: "none",
                    borderRadius: "8px",
                    cursor: "pointer",
                    fontWeight: "600",
                    marginTop: "32px",
                    whiteSpace: "nowrap"
                  }}
                >
                  {showMapPicker ? "📍 Hide Map" : "🗺️ Pick Location"}
                </button>
              </div>

              {/* Map Picker */}
              {showMapPicker && (
                <div style={{ marginBottom: "16px", border: "2px solid #2196F3", borderRadius: "8px", overflow: "hidden", height: "300px" }}>
                  <MapPicker
                    onLocationSelect={(lat, lng) => {
                      setSelectedLocation({ lat, lng });
                      setKomAddress("");
                    }}
                    selectedLocation={selectedLocation}
                  />
                </div>
              )}

              {selectedLocation && (
                <div style={{
                  padding: "10px",
                  backgroundColor: "#e3f2fd",
                  borderRadius: "6px",
                  marginBottom: "16px",
                  fontSize: "14px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center"
                }}>
                  <span>📍 Selected: {selectedLocation.lat.toFixed(4)}, {selectedLocation.lng.toFixed(4)}</span>
                  <button
                    onClick={() => setSelectedLocation(null)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#666",
                      cursor: "pointer",
                      fontSize: "18px"
                    }}
                  >
                    ×
                  </button>
                </div>
              )}

              {/* Activity Type Selector */}
              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", marginBottom: "8px", fontWeight: "600" }}>
                  🚴 Activity Type
                </label>
                <div style={{ display: "flex", gap: "12px" }}>
                  <button
                    onClick={() => setActivityType('riding')}
                    style={{
                      flex: 1,
                      padding: "12px",
                      borderRadius: "8px",
                      border: activityType === 'riding' ? "2px solid #FF6F00" : "2px solid #ddd",
                      backgroundColor: activityType === 'riding' ? "#FFF3E0" : "white",
                      cursor: "pointer",
                      fontWeight: activityType === 'riding' ? "bold" : "normal",
                      fontSize: "16px"
                    }}
                  >
                    🚴 Cycling
                  </button>
                  <button
                    onClick={() => setActivityType('running')}
                    style={{
                      flex: 1,
                      padding: "12px",
                      borderRadius: "8px",
                      border: activityType === 'running' ? "2px solid #FF6F00" : "2px solid #ddd",
                      backgroundColor: activityType === 'running' ? "#FFF3E0" : "white",
                      cursor: "pointer",
                      fontWeight: activityType === 'running' ? "bold" : "normal",
                      fontSize: "16px"
                    }}
                  >
                    🏃 Running
                  </button>
                </div>
              </div>

              <div style={{ display: "flex", gap: "16px", marginBottom: "16px", alignItems: "flex-end" }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", marginBottom: "8px", fontWeight: "600" }}>
                    📏 Radius (km)
                  </label>
                  <select
                    value={komRadius}
                    onChange={(e) => setKomRadius(Number(e.target.value))}
                    style={{
                      width: "100%",
                      padding: "12px",
                      borderRadius: "8px",
                      border: "2px solid #ddd",
                      fontSize: "16px"
                    }}
                  >
                    <option value={1}>1 km</option>
                    <option value={3}>3 km</option>
                    <option value={5}>5 km</option>
                    <option value={10}>10 km</option>
                    <option value={15}>15 km</option>
                  </select>
                </div>

                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", marginBottom: "8px", fontWeight: "600" }}>
                    👥 Max Leaderboard Size
                  </label>
                  <input
                    type="number"
                    value={komMaxLeaderboard}
                    onChange={(e) => setKomMaxLeaderboard(Number(e.target.value))}
                    min={1}
                    max={50}
                    style={{
                      width: "100%",
                      padding: "12px",
                      borderRadius: "8px",
                      border: "2px solid #ddd",
                      fontSize: "16px"
                    }}
                  />
                </div>

                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" checked={useMock} onChange={(e) => setUseMock(e.target.checked)} />
                  <span style={{ fontSize: 14 }}>Use demo data</span>
                </label>
              </div>

              <button
                onClick={handleKomSearch}
                disabled={komLoading || (!komAddress.trim() && !selectedLocation)}
                style={{
                  width: "100%",
                  padding: "14px",
                  backgroundColor: komLoading || (!komAddress.trim() && !selectedLocation) ? "#ccc" : "#4CAF50",
                  color: "white",
                  border: "none",
                  borderRadius: "8px",
                  fontSize: "18px",
                  fontWeight: "bold",
                  cursor: komLoading || (!komAddress.trim() && !selectedLocation) ? "not-allowed" : "pointer",
                  transition: "all 0.2s",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "10px"
                }}
              >
                {komLoading ? (
                  <>
                    <LoadingGift size="24px" variant="segments" />
                    <span>Searching...</span>
                  </>
                ) : (
                  "🔍 Search"
                )}
              </button>

              {/* Loading Status Terminal */}
              {komLoading && loadingStatus && (
                <div style={{
                  marginTop: "12px",
                  padding: "12px",
                  backgroundColor: "#1e1e1e",
                  color: "#00ff00",
                  borderRadius: "8px",
                  fontFamily: "monospace",
                  fontSize: "13px",
                  border: "1px solid #333"
                }}>
                  <div style={{ marginBottom: "4px", color: "#888" }}>$ kom-finder --search</div>
                  <div>{loadingStatus}</div>
                </div>
              )}
            </div>

            {/* Error Display */}
            {komError && (
              <div style={{
                padding: "12px",
                backgroundColor: "#fee2e2",
                color: "#b91c1c",
                borderRadius: "8px",
                marginBottom: "16px"
              }}>
                ⚠️ {komError}
              </div>
            )}

            {/* Results */}
            {komResults.length > 0 && (
              <div>
                <h3 style={{ marginBottom: "12px", fontSize: "18px", fontWeight: "bold" }}>
                  Found {komResults.length} beatable segment(s)
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {komResults.map((seg) => (
                    <div
                      key={seg.id}
                      style={{
                        padding: "16px",
                        backgroundColor: "#f8f9fa",
                        borderRadius: "8px",
                        border: "2px solid #ddd"
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                        <div style={{ flex: 1 }}>
                          <h4 style={{ margin: "0 0 8px 0", fontSize: "16px", fontWeight: "bold" }}>
                            {seg.name}
                          </h4>
                          <div style={{ fontSize: "14px", color: "#666" }}>
                            📏 {(seg.distance / 1000).toFixed(2)} km | 
                            📈 {seg.avg_grade?.toFixed(1)}% grade |
                            👥 {seg.effort_count != null ? seg.effort_count : "?"} efforts
                          </div>
                          {seg.leaderboard_forbidden && (
                            <div style={{ marginTop: 6, color: '#b45309', fontSize: 13 }}>
                              ⚠️ Leaderboard restricted — cannot fetch effort counts with current token.
                            </div>
                          )}
                          {seg.leaderboard_error && !seg.leaderboard_forbidden && (
                            <div style={{ marginTop: 6, color: '#b91c1c', fontSize: 13 }}>
                              ⚠️ Error fetching leaderboard: {String(seg.leaderboard_error).slice(0, 120)}
                            </div>
                          )}
                          {seg.user_best_time && (
                            <div style={{ marginTop: 8, fontSize: 13, color: '#064e3b' }}>
                              🧍 Your best: {Math.floor(seg.user_best_time/60)}:{(seg.user_best_time%60).toString().padStart(2,'0')}
                              {typeof seg.seconds_behind_kom === 'number' && seg.kom_time && (
                                <span> — {Math.abs(Math.round(seg.seconds_behind_kom))}s {seg.seconds_behind_kom > 0 ? 'behind' : 'ahead'} KOM ({seg.pct_behind ? Math.abs(seg.pct_behind).toFixed(1) : '0'}%)</span>
                              )}
                            </div>
                          )}
                        </div>
                      {segmentTestResults[seg.id] && (
                        <div style={{ marginTop: 8 }}>
                          <div style={{ fontWeight: 700, marginBottom: 6 }}>Test Result:</div>
                          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, background: '#111827', color: '#e5e7eb', padding: 8, borderRadius: 6 }}>{JSON.stringify(segmentTestResults[seg.id], null, 2)}</pre>
                          {segmentTestResults[seg.id]?.note && (
                            <div style={{ marginTop: 6, color: '#fca5a5' }}>
                              {segmentTestResults[seg.id].note}
                            </div>
                          )}
                        </div>
                      )}
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            onClick={() => handleInspectSegment(seg)}
                            style={{
                              padding: "8px 16px",
                              backgroundColor: "#2196F3",
                              color: "white",
                              border: "none",
                              borderRadius: "6px",
                              cursor: "pointer",
                              fontSize: "14px",
                              fontWeight: "600"
                            }}
                          >
                            🔍 Inspect
                          </button>
                          <button
                            onClick={() => handleTestSegment(seg)}
                            style={{
                              padding: "8px 12px",
                              backgroundColor: "#6b7280",
                              color: "white",
                              border: "none",
                              borderRadius: "6px",
                              cursor: "pointer",
                              fontSize: "13px",
                              fontWeight: "600"
                            }}
                            title="Test leaderboard access for this segment"
                          >
                            {testLoading ? 'Testing...' : 'Test Access'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Leaderboard Details Modal */}
            {selectedSegment && (
              <div style={{
                marginTop: "24px",
                padding: "20px",
                backgroundColor: "#fff3cd",
                borderRadius: "8px",
                border: "2px solid #ffc107"
              }}>
                <h3 style={{ margin: "0 0 12px 0", fontSize: "18px", fontWeight: "bold" }}>
                  📋 Leaderboard: {selectedSegment.name}
                </h3>
                {!leaderboardData && <p>Loading leaderboard...</p>}
                {leaderboardData?.error && (
                  leaderboardData.error === 'forbidden' ? (
                    <div style={{ padding: '12px', backgroundColor: '#fff4e6', borderRadius: 8, color: '#b45309' }}>
                      <strong>⚠️ Access Denied</strong>
                      <div style={{ marginTop: 8 }}>
                        This leaderboard is restricted. The Strava token used by the app may lack the required scopes (for example <code>activity:read_all</code>) or the segment's privacy settings prevent API access.
                      </div>
                      <div style={{ marginTop: 8 }}>
                        <a href="/strava" style={{ color: '#0366d6', textDecoration: 'underline' }}>Reconnect / Re-authorize Strava</a> to grant full access, then try again.
                      </div>
                    </div>
                  ) : (
                    <p style={{ color: "#b91c1c" }}>⚠️ {leaderboardData.error}</p>
                  )
                )}
                {leaderboardData && !leaderboardData.error && (
                  <div>
                    <p style={{ marginBottom: "12px", fontSize: "14px" }}>
                      <strong>Total Efforts:</strong> {leaderboardData.effort_count || 0} | 
                      <strong> KOM Time:</strong> {leaderboardData.kom_time ? `${Math.floor(leaderboardData.kom_time / 60)}:${(leaderboardData.kom_time % 60).toString().padStart(2, '0')}` : "N/A"}
                    </p>
                    {leaderboardData.entries?.length > 0 && (
                      <table style={{ width: "100%", fontSize: "14px", borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ backgroundColor: "#f1f1f1", textAlign: "left" }}>
                            <th style={{ padding: "8px" }}>Rank</th>
                            <th style={{ padding: "8px" }}>Athlete</th>
                            <th style={{ padding: "8px" }}>Time</th>
                          </tr>
                        </thead>
                        <tbody>
                          {leaderboardData.entries.map((entry: any, idx: number) => (
                            <tr key={idx} style={{ borderBottom: "1px solid #ddd" }}>
                              <td style={{ padding: "8px" }}>{entry.rank}</td>
                              <td style={{ padding: "8px" }}>{entry.athlete_name}</td>
                              <td style={{ padding: "8px" }}>
                                {Math.floor(entry.elapsed_time / 60)}:{(entry.elapsed_time % 60).toString().padStart(2, '0')}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
                <button
                  onClick={() => {
                    setSelectedSegment(null);
                    setLeaderboardData(null);
                  }}
                  style={{
                    marginTop: "12px",
                    padding: "8px 16px",
                    backgroundColor: "#666",
                    color: "white",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer"
                  }}
                >
                  Close Leaderboard
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}