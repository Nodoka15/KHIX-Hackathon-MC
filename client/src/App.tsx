import { useEffect, useState, useMemo } from "react";
import { CheckCircle2, Navigation, Wifi, WifiOff } from "lucide-react";
import { CampusMap } from "./components/CampusMap";
import type { ClubEvent, RecommendationResponse, GarageTransitBreakdown } from "./types/transit";

const API_BASE = "http://127.0.0.1:8000";

const CAMPUS_ENTRANCE = { lat: 28.5975, lng: -81.2018 };

const BUILDING_COORDS: Record<string, { lat: number; lng: number; name: string }> = {
  CB2: { lat: 28.6044, lng: -81.1998, name: "Classroom Building II" },
  CB1: { lat: 28.6037, lng: -81.2005, name: "Classroom Building I" },
  HEC: { lat: 28.6015, lng: -81.1987, name: "L3Harris Engineering Center" },
  SU:  { lat: 28.6016, lng: -81.2005, name: "Student Union" },
  LIB: { lat: 28.6002, lng: -81.2015, name: "John C. Hitt Library" },
};

const BASE_GARAGES = [
  { garage_id: "GARAGE_A", garage_name: "Garage A", lat: 28.5999, lng: -81.2065, base_full: 0.45 },
  { garage_id: "GARAGE_B", garage_name: "Garage B", lat: 28.6041, lng: -81.2057, base_full: 0.60 },
  { garage_id: "GARAGE_C", garage_name: "Garage C", lat: 28.6083, lng: -81.2009, base_full: 0.88 },
  { garage_id: "GARAGE_D", garage_name: "Garage D", lat: 28.6074, lng: -81.1979, base_full: 0.52 },
  { garage_id: "GARAGE_H", garage_name: "Garage H", lat: 28.6052, lng: -81.1988, base_full: 0.98 },
  { garage_id: "GARAGE_LIBRA", garage_name: "Garage Libra", lat: 28.5982, lng: -81.1994, base_full: 0.75 },
];

const DEFAULT_EVENTS: ClubEvent[] = [
  { id: "ev_1", name: "Knight Hacks Weekly GBM", raw_location: "Classroom Building II 105", resolved_building_id: "CB2", resolved_room: "105", supported: true },
  { id: "ev_2", name: "IEEE Tech Talk", raw_location: "HEC 101", resolved_building_id: "HEC", resolved_room: "101", supported: true },
  { id: "ev_3", name: "ACM Competitive Programming", raw_location: "Student Union Cape Florida 316", resolved_building_id: "SU", resolved_room: "Cape Florida 316", supported: true },
];

function haversineMeters(c1: { lat: number; lng: number }, c2: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(c2.lat - c1.lat);
  const dLng = toRad(c2.lng - c1.lng);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(c1.lat)) * Math.cos(toRad(c2.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function computeLocalRecommendation(destKey: string, isPeak: boolean): RecommendationResponse {
  const dest = BUILDING_COORDS[destKey] || BUILDING_COORDS["CB2"];
  const garages: GarageTransitBreakdown[] = BASE_GARAGES.map((g) => {
    let occ = g.base_full;
    if (isPeak) {
      if (g.garage_id === "GARAGE_H" || g.garage_id === "GARAGE_C") occ = 0.98;
      else if (g.garage_id === "GARAGE_D" || g.garage_id === "GARAGE_A") occ = 0.40;
    }

    const distDrive = haversineMeters(CAMPUS_ENTRANCE, { lat: g.lat, lng: g.lng });
    const driveMins = Number(((distDrive / 11.0) / 60.0).toFixed(1));

    let searchMins = 1.0;
    if (occ >= 0.95) searchMins = 14.0;
    else if (occ >= 0.85) searchMins = 7.0;
    else if (occ >= 0.70) searchMins = 3.0;

    const distWalk = haversineMeters({ lat: g.lat, lng: g.lng }, { lat: dest.lat, lng: dest.lng });
    const walkMins = Number(((distWalk / 1.3) / 60.0).toFixed(1));

    const totalTransitMins = Number((driveMins + searchMins + walkMins).toFixed(1));

    return {
      garage_id: g.garage_id,
      garage_name: g.garage_name,
      occupancy_rate: occ,
      drive_mins: driveMins,
      search_mins: searchMins,
      walk_mins: walkMins,
      total_transit_mins: totalTransitMins,
      walk_distance_meters: Math.round(distWalk),
      coordinates: { lat: g.lat, lng: g.lng },
    };
  });

  garages.sort((a, b) => a.total_transit_mins - b.total_transit_mins);

  return {
    destination: destKey,
    destination_name: dest.name,
    optimal_garage: garages[0],
    all_garages: garages,
  };
}

export default function App() {
  const [events, setEvents] = useState<ClubEvent[]>(DEFAULT_EVENTS);
  const [selectedBuilding, setSelectedBuilding] = useState<string>("CB2");
  const [isPeak, setIsPeak] = useState<boolean>(false);
  const [recommendation, setRecommendation] = useState<RecommendationResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [backendConnected, setBackendConnected] = useState<boolean>(false);

  // Local calculation fallback if backend is offline
  const fallbackRecommendation = useMemo(() => {
    return computeLocalRecommendation(selectedBuilding, isPeak);
  }, [selectedBuilding, isPeak]);

  const activeRecommendation = recommendation || fallbackRecommendation;

  // 1. Fetch parsed KnightConnect events on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/events`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load events");
        return res.json();
      })
      .then((data: ClubEvent[]) => {
        if (Array.isArray(data) && data.length > 0) {
          setEvents(data);
        }
      })
      .catch((err) => {
        console.warn("Backend events not available, using default campus events:", err);
      });
  }, []);

  // 2. Query dynamic parking & transit calculations when destination or peak toggle updates
  useEffect(() => {
    let ignore = false;
    fetch(`${API_BASE}/api/recommend?destination=${selectedBuilding}&peak_sim=${isPeak}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to retrieve garage recommendations");
        return res.json();
      })
      .then((data: RecommendationResponse) => {
        if (!ignore) {
          setRecommendation(data);
          setBackendConnected(true);
        }
      })
      .catch((err) => {
        if (!ignore) {
          console.warn("Backend API not reachable, running simulation mode:", err);
          setBackendConnected(false);
          setRecommendation(null);
        }
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [selectedBuilding, isPeak]);

  const currentDestination = BUILDING_COORDS[selectedBuilding] || BUILDING_COORDS["CB2"];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-6 flex flex-col items-center">
      {/* Top Navigation Bar */}
      <header className="w-full max-w-7xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Navigation className="w-6 h-6 text-yellow-400" />
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Knight<span className="text-yellow-400">Transit</span>
            </h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            UCF Real-Time Garage Density & Combined Transit Routing
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Backend Connection Indicator */}
          <div
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border ${
              backendConnected
                ? "bg-emerald-950/60 border-emerald-500/40 text-emerald-400"
                : "bg-amber-950/40 border-amber-500/30 text-amber-300"
            }`}
          >
            {backendConnected ? (
              <>
                <Wifi className="w-3.5 h-3.5" />
                <span>Backend Connected</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5" />
                <span>Local Campus Sim</span>
              </>
            )}
          </div>

          {/* Demo Simulation Switch */}
          <div className="flex items-center gap-3 bg-slate-900 border border-slate-800 px-4 py-2 rounded-xl">
            <label
              htmlFor="peak-toggle"
              className="text-xs sm:text-sm font-medium text-slate-300 cursor-pointer select-none"
            >
              Simulate Peak Rush (11:30 AM)
            </label>
            <input
              id="peak-toggle"
              type="checkbox"
              checked={isPeak}
              onChange={(e) => setIsPeak(e.target.checked)}
              className="w-4 h-4 accent-yellow-400 cursor-pointer rounded"
            />
          </div>
        </div>
      </header>

      {/* Destination Quick Selector */}
      <div className="w-full max-w-7xl mb-4 flex items-center gap-2 overflow-x-auto pb-1">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap mr-1">
          Select Hall:
        </span>
        {Object.entries(BUILDING_COORDS).map(([key, bldg]) => {
          const isSelected = selectedBuilding === key;
          return (
            <button
              key={key}
              onClick={() => setSelectedBuilding(key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap border ${
                isSelected
                  ? "bg-yellow-400 text-slate-950 border-yellow-300 font-bold shadow-md shadow-yellow-400/20"
                  : "bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-700"
              }`}
            >
              {key} - {bldg.name}
            </button>
          );
        })}
      </div>

      {/* Main Grid: Control Panel (Left) & Map View (Right) */}
      <main className="w-full max-w-7xl grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column (5 Cols): Events + Recommendation Cards */}
        <section className="lg:col-span-5 flex flex-col gap-4">
          {/* Optimal Recommendation Banner */}
          {activeRecommendation && (
            <div className="bg-emerald-950/30 border border-emerald-500/40 rounded-2xl p-5 shadow-lg relative overflow-hidden">
              <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold uppercase tracking-wider mb-2">
                <CheckCircle2 className="w-4 h-4" /> Optimal Route Recommendation
              </div>

              <div className="flex justify-between items-baseline mb-4">
                <h3 className="text-2xl font-bold text-white tracking-tight">
                  {activeRecommendation.optimal_garage.garage_name}
                </h3>
                <div className="text-2xl font-extrabold text-emerald-400">
                  {activeRecommendation.optimal_garage.total_transit_mins}{" "}
                  <span className="text-xs font-normal text-emerald-300">min total</span>
                </div>
              </div>

              {/* Time Breakdown Cards */}
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800">
                  <span className="text-slate-400 block mb-1">Drive</span>
                  <span className="font-semibold text-white">
                    {activeRecommendation.optimal_garage.drive_mins}m
                  </span>
                </div>
                <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800">
                  <span className="text-slate-400 block mb-1">Search & Park</span>
                  <span className="font-semibold text-white">
                    {activeRecommendation.optimal_garage.search_mins}m
                  </span>
                </div>
                <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800">
                  <span className="text-slate-400 block mb-1">Walk to Hall</span>
                  <span className="font-semibold text-white">
                    {activeRecommendation.optimal_garage.walk_mins}m
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* KnightConnect Club Meetings */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3">
            <h2 className="text-xs font-semibold tracking-wider uppercase text-slate-400">
              Upcoming Club Events (KnightConnect)
            </h2>
            <div className="flex flex-col gap-2 max-h-56 overflow-y-auto pr-1">
              {events.map((evt) => {
                const isSelected = selectedBuilding === evt.resolved_building_id;
                return (
                  <button
                    key={evt.id}
                    onClick={() =>
                      evt.resolved_building_id && setSelectedBuilding(evt.resolved_building_id)
                    }
                    disabled={!evt.supported}
                    className={`text-left p-3 rounded-xl border transition-all ${
                      isSelected
                        ? "bg-yellow-400/10 border-yellow-400 text-slate-100"
                        : "bg-slate-950 border-slate-800/80 text-slate-300 hover:border-slate-700"
                    } ${!evt.supported ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
                  >
                    <div className="font-medium text-sm text-white">{evt.name}</div>
                    <div className="text-xs text-slate-400 mt-0.5">{evt.raw_location}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Garage Comparison Table */}
          {activeRecommendation && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                All Ranked Garages for {activeRecommendation.destination_name}
              </h4>
              <div className="flex flex-col gap-1.5 max-h-60 overflow-y-auto pr-1">
                {activeRecommendation.all_garages.map((g, idx) => (
                  <div
                    key={g.garage_id}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950 border border-slate-800/80 text-xs"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono text-slate-500 w-4">#{idx + 1}</span>
                      <div>
                        <span className="font-medium text-white">{g.garage_name}</span>
                        <span className="text-[11px] text-slate-400 block">
                          {(g.occupancy_rate * 100).toFixed(0)}% full
                        </span>
                      </div>
                    </div>
                    <div className="text-right font-mono">
                      <span className="text-slate-300 font-semibold">{g.total_transit_mins}m total</span>
                      <span className="text-[10px] text-slate-500 block">
                        {g.walk_distance_meters}m walk
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Right Column (7 Cols): The Live Interactive Map */}
        <section className="lg:col-span-7 h-[580px] lg:h-[720px] sticky top-6 relative">
          <CampusMap
            destinationCoord={currentDestination}
            optimalGarage={activeRecommendation?.optimal_garage ?? null}
            allGarages={activeRecommendation?.all_garages ?? []}
          />

          {loading && (
            <div className="absolute top-4 left-4 bg-slate-950/80 backdrop-blur-md border border-slate-700 text-slate-200 text-xs px-3 py-1.5 rounded-lg flex items-center gap-2 shadow-lg">
              <div className="w-2.5 h-2.5 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
              <span>Updating transit route...</span>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}