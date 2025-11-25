"use client";

import { useEffect, useRef, useState } from "react";
import LoadingGift from "../../../components/LoadingGift";
import "leaflet/dist/leaflet.css";

type StravaMapProps = {
  polylines: [number, number][][];
  center: [number, number];
};

export default function StravaMap({ polylines, center }: StravaMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [isClient, setIsClient] = useState(false);

  // Ensure we're on the client side
  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (!isClient || !mapContainerRef.current) return;

    let map: any = null;
    
    const initializeMap = async () => {
      try {
        // Dynamic import of Leaflet to avoid SSR issues
        const L = (await import("leaflet")).default;
        
        // Fix for default markers in Leaflet with webpack
        delete (L.Icon.Default.prototype as any)._getIconUrl;
        L.Icon.Default.mergeOptions({
          iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
          iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
          shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
        });

        // Clear any existing map
        if (mapRef.current) {
          mapRef.current.remove();
          mapRef.current = null;
        }

        // Clear the container
        if (mapContainerRef.current) {
          mapContainerRef.current.innerHTML = '';
        }

        // Create new map
        if (!mapContainerRef.current) {
          throw new Error('Map container not found');
        }
        
        map = L.map(mapContainerRef.current, {
          center: center,
          zoom: 12,
          zoomControl: true,
          attributionControl: true
        });

        // Add tile layer
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);

        // Add polylines with a subtle glow/shadow and brighter foreground for visibility
        polylines.forEach((polyline, idx) => {
          if (polyline && polyline.length > 1) {
            // shadow / glow (wider, low-opacity)
            L.polyline(polyline, {
              color: '#ffb84d',
              weight: 12,
              opacity: 0.12,
              lineJoin: 'round'
            }).addTo(map);

            // main visible line
            L.polyline(polyline, {
              color: '#ff8c00',
              weight: 5,
              opacity: 0.98,
              lineJoin: 'round'
            }).addTo(map);
          }
        });

        // Fit bounds if we have polylines
        if (polylines.length > 0 && polylines.some(p => p.length > 0)) {
          const allPoints = polylines.flat();
          if (allPoints.length > 0) {
            const bounds = L.latLngBounds(allPoints);
            map.fitBounds(bounds, { padding: [20, 20] });
          }
        }

        mapRef.current = map;
        setMapError(null);
        
      } catch (error: any) {
        console.error('Map initialization error:', error);
        setMapError(error.message || 'Failed to initialize map');
      }
    };

    initializeMap();

    // Cleanup function
    return () => {
      if (mapRef.current) {
        try {
          mapRef.current.remove();
          mapRef.current = null;
        } catch (e) {
          console.warn('Map cleanup warning:', e);
        }
      }
    };
  }, [isClient, polylines, center]);

  if (!isClient) {
    return (
      <div style={{
        height: "100%",
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#f0f0f0",
        color: "#666"
      }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <LoadingGift variant="segments" size="default" />
          <div>Loading map...</div>
        </div>
      </div>
    );
  }

  if (mapError) {
    return (
      <div style={{ 
        height: "100%", 
        width: "100%", 
        display: "flex", 
        alignItems: "center", 
        justifyContent: "center",
        backgroundColor: "#f0f0f0",
        color: "#666"
      }}>
        <div style={{ textAlign: "center" }}>
          <p>Map Error: {mapError}</p>
          <button 
            onClick={() => {
              setMapError(null);
              // Force re-render by clearing the container
              if (mapContainerRef.current) {
                mapContainerRef.current.innerHTML = '';
              }
            }}
            style={{ 
              padding: "8px 16px", 
              marginTop: "8px", 
              backgroundColor: "#007cba", 
              color: "white", 
              border: "none", 
              borderRadius: "4px",
              cursor: "pointer"
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div 
      ref={mapContainerRef}
      style={{ 
        height: "100%", 
        width: "100%",
        position: "relative",
        zIndex: 1
      }}
    />
  );
}