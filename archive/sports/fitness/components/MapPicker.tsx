"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

type Props = {
  onLocationSelect: (lat: number, lng: number) => void;
  initialCenter?: [number, number];
  selectedLocation?: { lat: number; lng: number } | null;
};

export default function MapPicker({ onLocationSelect, initialCenter = [49.2827, -123.1207], selectedLocation }: Props) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // Initialize map
    const map = L.map(mapContainerRef.current).setView(initialCenter, 12);
    mapRef.current = map;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 18,
    }).addTo(map);

    // Add click handler
    map.on("click", (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng;
      onLocationSelect(lat, lng);

      // Add or move marker
      if (markerRef.current) {
        markerRef.current.setLatLng([lat, lng]);
      } else {
        markerRef.current = L.marker([lat, lng], {
          icon: L.icon({
            iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
            iconSize: [25, 41],
            iconAnchor: [12, 41],
          }),
        }).addTo(map);
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, [initialCenter, onLocationSelect]);

  // Update marker when selectedLocation changes
  useEffect(() => {
    if (!mapRef.current) return;
    
    if (selectedLocation) {
      const { lat, lng } = selectedLocation;
      
      if (markerRef.current) {
        markerRef.current.setLatLng([lat, lng]);
      } else {
        markerRef.current = L.marker([lat, lng], {
          icon: L.icon({
            iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
            iconSize: [25, 41],
            iconAnchor: [12, 41],
          }),
        }).addTo(mapRef.current);
      }
      
      mapRef.current.setView([lat, lng], 12);
    }
  }, [selectedLocation]);

  return (
    <div ref={mapContainerRef} style={{ width: "100%", height: "100%", minHeight: "300px", borderRadius: "8px" }} />
  );
}
