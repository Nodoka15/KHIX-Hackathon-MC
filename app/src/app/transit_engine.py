import math
from typing import Dict, Any, List

# Coordinates: [Latitude, Longitude]
CAMPUS_ENTRANCE = {"lat": 28.5975, "lng": -81.2018}  # University Blvd Entrance

GARAGES: Dict[str, Dict[str, Any]] = {
    "GARAGE_A": {"name": "Garage A", "lat": 28.5999, "lng": -81.2065, "total_spots": 1623, "percent_full": 0.45},
    "GARAGE_B": {"name": "Garage B", "lat": 28.6041, "lng": -81.2057, "total_spots": 1259, "percent_full": 0.60},
    "GARAGE_C": {"name": "Garage C", "lat": 28.6083, "lng": -81.2009, "total_spots": 1852, "percent_full": 0.88},
    "GARAGE_D": {"name": "Garage D", "lat": 28.6074, "lng": -81.1979, "total_spots": 1241, "percent_full": 0.52},
    "GARAGE_H": {"name": "Garage H", "lat": 28.6052, "lng": -81.1988, "total_spots": 1284, "percent_full": 0.98},
    "GARAGE_LIBRA": {"name": "Garage Libra", "lat": 28.5982, "lng": -81.1994, "total_spots": 1007, "percent_full": 0.75},
}

BUILDINGS: Dict[str, Dict[str, Any]] = {
    "CB2": {"name": "Classroom Building II", "lat": 28.6044, "lng": -81.1998},
    "CB1": {"name": "Classroom Building I", "lat": 28.6037, "lng": -81.2005},
    "HEC": {"name": "L3Harris Engineering Center", "lat": 28.6015, "lng": -81.1987},
    "SU": {"name": "Student Union", "lat": 28.6016, "lng": -81.2005},
    "LIB": {"name": "John C. Hitt Library", "lat": 28.6002, "lng": -81.2015},
}


def haversine_meters(coord1: Dict[str, float], coord2: Dict[str, float]) -> float:
    """Calculates distance between two lat/lng coordinates in meters."""
    R = 6371000.0  # Earth radius in meters
    phi1, phi2 = math.radians(coord1["lat"]), math.radians(coord2["lat"])
    delta_phi = math.radians(coord2["lat"] - coord1["lat"])
    delta_lambda = math.radians(coord2["lng"] - coord1["lng"])

    a = (math.sin(delta_phi / 2.0) ** 2 +
         math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2)
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c


def calculate_search_penalty(percent_full: float) -> float:
    """Estimates minutes spent finding a spot based on occupancy percentage."""
    if percent_full < 0.70:
        return 1.0
    elif percent_full < 0.85:
        return 3.0
    elif percent_full < 0.95:
        return 7.0
    else:
        # 95%+ full implies multiple deck loops and high congestion
        return 14.0


def evaluate_garages_for_destination(
    destination_id: str,
    peak_simulation: bool = False
) -> List[Dict[str, Any]]:
    if destination_id not in BUILDINGS:
        raise ValueError(f"Unknown destination building: {destination_id}")

    target_bldg = BUILDINGS[destination_id]
    results = []

    # Speeds: driving ~11 m/s (~25 mph), walking ~1.3 m/s (~3 mph)
    SPEED_DRIVE_MPS = 11.0
    SPEED_WALK_MPS = 1.3

    for g_id, garage in GARAGES.items():
        occupancy = garage["percent_full"]
        if peak_simulation:
            # Force peak stress on Garages H and C for demo purposes
            if g_id in ["GARAGE_H", "GARAGE_C"]:
                occupancy = 0.98
            elif g_id in ["GARAGE_D", "GARAGE_A"]:
                occupancy = 0.40

        # 1. Drive time from campus entrance to garage
        dist_drive = haversine_meters(CAMPUS_ENTRANCE, {"lat": garage["lat"], "lng": garage["lng"]})
        drive_mins = round((dist_drive / SPEED_DRIVE_MPS) / 60.0, 1)

        # 2. Congestion / parking search penalty
        search_mins = calculate_search_penalty(occupancy)

        # 3. Walk time from garage to destination building
        dist_walk = haversine_meters({"lat": garage["lat"], "lng": garage["lng"]}, {"lat": target_bldg["lat"], "lng": target_bldg["lng"]})
        walk_mins = round((dist_walk / SPEED_WALK_MPS) / 60.0, 1)

        total_mins = round(drive_mins + search_mins + walk_mins, 1)

        results.append({
            "garage_id": g_id,
            "garage_name": garage["name"],
            "occupancy_rate": occupancy,
            "drive_mins": drive_mins,
            "search_mins": search_mins,
            "walk_mins": walk_mins,
            "total_transit_mins": total_mins,
            "walk_distance_meters": round(dist_walk, 1),
            "coordinates": {"lat": garage["lat"], "lng": garage["lng"]}
        })

    # Sort ascending by lowest total transit time
    results.sort(key=lambda item: item["total_transit_mins"])
    return results