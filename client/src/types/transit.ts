export interface GarageTransitBreakdown {
  garage_id: string;
  garage_name: string;
  occupancy_rate: number;
  drive_mins: number;
  search_mins: number;
  walk_mins: number;
  total_transit_mins: number;
  walk_distance_meters: number;
  coordinates: {
    lat: number;
    lng: number;
  };
}

export interface RecommendationResponse {
  destination: string;
  destination_name: string;
  optimal_garage: GarageTransitBreakdown;
  all_garages: GarageTransitBreakdown[];
}

export interface ClubEvent {
  id: string;
  name: string;
  raw_location: string;
  resolved_building_id: string | null;
  resolved_room: string | null;
  supported: boolean;
}