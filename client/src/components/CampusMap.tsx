import React, { useEffect, useRef, useState } from "react";
import { Map, NavigationControl, Marker, Popup, type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { GarageTransitBreakdown } from "../types/transit";

interface CampusMapProps {
  destinationCoord: { lat: number; lng: number; name: string };
  optimalGarage: GarageTransitBreakdown | null;
  allGarages: (GarageTransitBreakdown & { coordinates?: { lat: number; lng: number } })[];
  onSelectGarage?: (garageId: string) => void;
}

const CAMPUS_ENTRANCE = { lng: -81.2018, lat: 28.5975, name: "University Blvd Entrance" };

export const CampusMap: React.FC<CampusMapProps> = ({
  destinationCoord,
  optimalGarage,
  allGarages,
  onSelectGarage,
}) => {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapInstance = useRef<Map | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const [isMapReady, setIsMapReady] = useState<boolean>(false);

  // 1. Initialize MapLibre Canvas
  useEffect(() => {
    if (!mapContainer.current) return;

    const map = new Map({
      container: mapContainer.current,
      style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
      center: [-81.2010, 28.6025],
      zoom: 15.2,
      pitch: 45, // Isometric tilt
    });

    map.addControl(new NavigationControl({ visualizePitch: true }), "top-right");

    map.on("load", () => {
      mapInstance.current = map;
      setIsMapReady(true);
      map.resize();
    });

    map.on("error", (e) => {
      console.warn("MapLibre event error:", e);
    });

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map.remove();
      mapInstance.current = null;
      setIsMapReady(false);
    };
  }, []);

  // 2. Observe container resize so map never collapses or stretches
  useEffect(() => {
    if (!mapContainer.current) return;
    const observer = new ResizeObserver(() => {
      mapInstance.current?.resize();
    });
    observer.observe(mapContainer.current);
    return () => observer.disconnect();
  }, []);

  // Helper: Ensure routing layers and sources exist on the style
  const ensureRouteLayers = (map: Map) => {
    if (!map.isStyleLoaded()) return false;

    if (!map.getSource("drive-route")) {
      map.addSource("drive-route", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "drive-route-layer",
        type: "line",
        source: "drive-route",
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#38bdf8", // Sky blue
          "line-width": 4,
          "line-opacity": 0.9,
        },
      });
    }

    if (!map.getSource("walk-route")) {
      map.addSource("walk-route", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "walk-route-layer",
        type: "line",
        source: "walk-route",
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#4ade80", // Emerald green
          "line-width": 3,
          "line-dasharray": [2, 2],
        },
      });
    }

    return true;
  };

  // 3. Synchronize Markers & Routing Polylines
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !isMapReady) return;

    const updateLayersAndMarkers = () => {
      // Clear existing HTML markers
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];

      // 1. Campus Entrance Marker
      const entranceEl = document.createElement("div");
      entranceEl.className =
        "flex items-center gap-1.5 bg-slate-900/90 text-sky-400 font-semibold text-[10px] px-2 py-1 rounded-md shadow-lg border border-sky-500/50 select-none pointer-events-none";
      entranceEl.innerHTML = `🚗 Campus Entrance`;
      const entranceMarker = new Marker({ element: entranceEl })
        .setLngLat([CAMPUS_ENTRANCE.lng, CAMPUS_ENTRANCE.lat])
        .addTo(map);
      markersRef.current.push(entranceMarker);

      // 2. Destination Building Pin
      if (destinationCoord?.lng != null && destinationCoord?.lat != null) {
        const destEl = document.createElement("div");
        destEl.className =
          "flex items-center justify-center bg-yellow-400 text-black font-bold text-xs px-2.5 py-1 rounded-md shadow-lg border border-yellow-200 select-none pointer-events-none";
        destEl.innerHTML = `📍 ${destinationCoord.name}`;
        const destMarker = new Marker({ element: destEl })
          .setLngLat([destinationCoord.lng, destinationCoord.lat])
          .addTo(map);
        markersRef.current.push(destMarker);
      }

      // 3. Garage Density Markers
      allGarages.forEach((garage) => {
        if (!garage.coordinates || typeof garage.coordinates.lng !== "number") return;

        const isWinner = optimalGarage?.garage_id === garage.garage_id;
        const rate = garage.occupancy_rate ?? 0;
        const color = rate >= 0.9 ? "#ef4444" : rate >= 0.7 ? "#f59e0b" : "#10b981";

        const el = document.createElement("div");
        el.className = `flex flex-col items-center cursor-pointer select-none transition-transform duration-200 hover:scale-110 ${
          isWinner ? "scale-110 z-20" : "scale-90 opacity-80 hover:opacity-100"
        }`;

        el.innerHTML = `
          <div style="background-color: ${color};" class="w-8 h-8 rounded-full flex items-center justify-center font-bold text-[11px] text-white shadow-md border-2 ${
            isWinner ? "border-yellow-300 ring-4 ring-yellow-400/40" : "border-slate-800"
          }">
            ${(rate * 100).toFixed(0)}%
          </div>
          <span class="text-[10px] bg-slate-900/90 text-slate-200 px-1.5 py-0.5 rounded mt-0.5 border ${
            isWinner ? "border-yellow-400 text-yellow-300" : "border-slate-700"
          } whitespace-nowrap">
            ${garage.garage_name} ${isWinner ? "⭐" : ""}
          </span>
        `;

        if (onSelectGarage) {
          el.onclick = () => onSelectGarage(garage.garage_id);
        }

        const popup = new Popup({ offset: 20, closeButton: false }).setHTML(`
          <div style="padding: 4px; font-family: sans-serif; font-size: 11px; color: #0f172a;">
            <div style="font-weight: bold; margin-bottom: 2px;">${garage.garage_name}</div>
            <div>Occupancy: <strong>${(rate * 100).toFixed(0)}% full</strong></div>
            ${garage.total_transit_mins ? `<div>Total Transit: <strong>${garage.total_transit_mins} mins</strong></div>` : ""}
            ${garage.walk_distance_meters ? `<div>Walk Distance: <strong>${garage.walk_distance_meters}m</strong></div>` : ""}
          </div>
        `);

        const marker = new Marker({ element: el })
          .setLngLat([garage.coordinates.lng, garage.coordinates.lat])
          .setPopup(popup)
          .addTo(map);

        markersRef.current.push(marker);
      });

      // 4. Update Path Trajectories
      if (ensureRouteLayers(map)) {
        const driveSource = map.getSource("drive-route") as GeoJSONSource | undefined;
        const walkSource = map.getSource("walk-route") as GeoJSONSource | undefined;

        if (driveSource && walkSource) {
          if (optimalGarage?.coordinates?.lng != null && destinationCoord?.lng != null) {
            driveSource.setData({
              type: "FeatureCollection",
              features: [
                {
                  type: "Feature",
                  properties: {},
                  geometry: {
                    type: "LineString",
                    coordinates: [
                      [CAMPUS_ENTRANCE.lng, CAMPUS_ENTRANCE.lat],
                      [optimalGarage.coordinates.lng, optimalGarage.coordinates.lat],
                    ],
                  },
                },
              ],
            });

            walkSource.setData({
              type: "FeatureCollection",
              features: [
                {
                  type: "Feature",
                  properties: {},
                  geometry: {
                    type: "LineString",
                    coordinates: [
                      [optimalGarage.coordinates.lng, optimalGarage.coordinates.lat],
                      [destinationCoord.lng, destinationCoord.lat],
                    ],
                  },
                },
              ],
            });
          } else {
            driveSource.setData({ type: "FeatureCollection", features: [] });
            walkSource.setData({ type: "FeatureCollection", features: [] });
          }
        }
      }

      // 5. Smooth camera panning to destination
      if (destinationCoord?.lng != null && destinationCoord?.lat != null) {
        map.easeTo({
          center: [destinationCoord.lng, destinationCoord.lat],
          duration: 800,
        });
      }
    };

    if (map.isStyleLoaded()) {
      updateLayersAndMarkers();
    } else {
      map.once("load", updateLayersAndMarkers);
    }
  }, [isMapReady, destinationCoord, optimalGarage, allGarages, onSelectGarage]);

  return (
    <div className="relative w-full h-full min-h-[480px] rounded-2xl overflow-hidden border border-slate-800 bg-slate-950">
      <div ref={mapContainer} className="w-full h-full min-h-[480px]" />

      {/* Floating Route Legend */}
      <div className="absolute bottom-4 left-4 bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-lg p-3 text-xs flex flex-col gap-2 shadow-lg pointer-events-none">
        <div className="flex items-center gap-2">
          <span className="w-4 h-1 bg-sky-400 rounded-full" />
          <span className="text-slate-300">Driving to Garage</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-4 h-1 border-t-2 border-dashed border-emerald-400" />
          <span className="text-slate-300">Walking to Hall</span>
        </div>
      </div>
    </div>
  );
};