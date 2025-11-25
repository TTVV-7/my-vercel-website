"use client";

import { useEffect, useState } from "react";
import Navbar from "../../../components/Navbar";
import LoadingGift from "../../../components/LoadingGift";
import dynamic from "next/dynamic";
import { useStravaAuth } from "../StravaAuthContext";

const StravaMap = dynamic(() => import("../components/StravaMap"), { ssr: false });

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

async function fetchSegments(token: string, setSegmentPolylines: React.Dispatch<React.SetStateAction<[number, number][][]>>, setApiError: React.Dispatch<React.SetStateAction<string | null>>, activities?: any[]) {
  try {
    let acts = activities;
    if (!Array.isArray(acts)) {
      const res = await fetch("https://www.strava.com/api/v3/athlete/activities?per_page=3", {
        headers: { Authorization: `Bearer ${token}` },
      });
      acts = await res.json();
    }
    console.log("Activities (limited):", acts);

    if (!Array.isArray(acts)) {
      setApiError(
        (acts as any)?.message
          ? `Strava API error: ${(acts as any).message}`
          : "Unexpected activities response (not an array)."
      );
      return;
    }

    const segmentIds = new Set<string>();
    // only scan the last 3 activities to avoid rate limit
    for (const activity of acts.slice(0, 3)) {
      if (!activity?.id) continue;
      try {
        const segRes = await fetch(`https://www.strava.com/api/v3/activities/${activity.id}/streams?keys=segment_efforts`, { headers: { Authorization: `Bearer ${token}` } });
        const segData = await segRes.json();
        if (segData?.segment_efforts) {
          for (const effort of segData.segment_efforts) {
            if (effort?.segment?.id) segmentIds.add(effort.segment.id.toString());
          }
        }
      } catch (err) {
        console.warn("Failed to fetch segments for activity", activity.id, err);
      }
    }
    console.log("Segment IDs:", Array.from(segmentIds));

    const polylines: [number, number][][] = [];
    // limit detail fetch to first 10 segments to avoid overload
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
  const [weeklySegments, setWeeklySegments] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const mapCenter: [number, number] = [49.2827, -123.1207];
  const { currentUser } = useStravaAuth();

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
      // Try sessionStorage cache first (5 minute TTL)
      const uid = (currentUser as any)?.id || (currentUser as any)?.athlete_id || (currentUser as any)?.athleteId || 'anon';
      const cacheKey = `strava_activities_${uid}`;
      let activities: any[] | null = null;
      try {
        const raw = sessionStorage.getItem(cacheKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.ts && (Date.now() - parsed.ts) < (5 * 60 * 1000) && Array.isArray(parsed.data)) {
            activities = parsed.data;
          }
        }
      } catch (e) {
        // ignore cache errors
      }

      if (!activities) {
        try {
          const res = await fetch("https://www.strava.com/api/v3/athlete/activities?per_page=3", { headers: { Authorization: `Bearer ${currentUser.accessToken}` } });
          const fetched = await res.json();
          if (Array.isArray(fetched)) {
            activities = fetched;
            try { sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: activities })); } catch (_) {}
          } else {
            // pass through to child functions to handle error
            activities = fetched;
          }
        } catch (e) {
          // network error - allow fetchSegments to surface error
          activities = null;
        }
      }

      await Promise.all([
        fetchSegments(currentUser.accessToken, setSegmentPolylines, setApiError, activities as any),
        fetchWeeklyUniqueSegments(currentUser.accessToken, setWeeklySegments, setApiError, activities as any)
      ]);
      setLoading(false);
    };
    loadData();
  }, [currentUser]);

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
          <div style={{
            backgroundColor: "#ff6b35",
            color: "white",
            padding: "12px 20px",
            borderRadius: "12px",
            fontWeight: "bold",
            fontSize: "18px",
            boxShadow: "0 4px 12px rgba(255, 107, 53, 0.3)"
          }}>
            📊 Unique Segments This Week: {loading ? "Loading..." : (apiError ? 0 : weeklySegments.size)}
          </div>
          
          <div style={{
            backgroundColor: "#4CAF50",
            color: "white", 
            padding: "12px 20px",
            borderRadius: "12px",
            fontWeight: "bold",
            fontSize: "18px",
            boxShadow: "0 4px 12px rgba(76, 175, 80, 0.3)"
          }}>
            🗺️ Total Segments Mapped: {apiError ? 0 : segmentPolylines.length}
          </div>
          
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
          <div style={{ marginTop: "12px" }}>
            {/* Use LoadingGift for a nicer loading UX */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div><LoadingGift variant="segments" size="default" /></div>
              <div style={{ color: '#666', fontStyle: 'italic' }}>🔄 Loading your Strava data...</div>
            </div>
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
      <div style={{ flex: 1, width: "100%" }}>
        <StravaMap polylines={segmentPolylines} center={mapCenter} />
      </div>
    </div>
  );
}