from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional
from pydantic import BaseModel

from .transit_engine import evaluate_garages_for_destination, BUILDINGS, GARAGES
from .location_parser import resolve_location

app = FastAPI(title="UCF Smart Parking & Transit API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class Coordinates(BaseModel):
    lat: float
    lng: float

class TransitBreakdown(BaseModel):
    garage_id: str
    garage_name: str
    occupancy_rate: float
    drive_mins: float
    search_mins: float
    walk_mins: float
    total_transit_mins: float
    walk_distance_meters: float
    coordinates: Coordinates

class RecommendationResponse(BaseModel):
    destination: str
    destination_name: str
    optimal_garage: TransitBreakdown
    all_garages: List[TransitBreakdown]

# Mocked KnightConnect feed for testing
SAMPLE_EVENTS = [
    {"id": "ev_1", "name": "Knight Hacks Weekly GBM", "raw_location": "Classroom Building II 105"},
    {"id": "ev_2", "name": "IEEE Tech Talk", "raw_location": "HEC 101"},
    {"id": "ev_3", "name": "ACM Competitive Programming", "raw_location": "Student Union Cape Florida 316"},
]

@app.get("/api/events")
def get_parsed_events():
    """Returns club events with their parsed building IDs."""
    parsed_events = []
    for event in SAMPLE_EVENTS:
        b_id, room = resolve_location(event["raw_location"])
        parsed_events.append({
            **event,
            "resolved_building_id": b_id,
            "resolved_room": room,
            "supported": b_id in BUILDINGS
        })
    return parsed_events

@app.get("/api/recommend", response_model=RecommendationResponse)
def get_recommendation(
    destination: str = Query(..., description="Target building key, e.g. 'CB2', 'HEC'"),
    peak_sim: bool = Query(False, description="Toggle simulated peak rush hour occupancy")
):
    dest_key = destination.upper()
    if dest_key not in BUILDINGS:
        raise HTTPException(status_code=404, detail=f"Building '{dest_key}' not found. Available: {list(BUILDINGS.keys())}")

    ranked = evaluate_garages_for_destination(dest_key, peak_simulation=peak_sim)
    return {
        "destination": dest_key,
        "destination_name": BUILDINGS[dest_key]["name"],
        "optimal_garage": ranked[0],
        "all_garages": ranked
    }