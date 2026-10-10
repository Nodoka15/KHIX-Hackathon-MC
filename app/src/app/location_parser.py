import re
from typing import Optional, Tuple

REGEX_PATTERNS = [
    (r"(?i)\b(?:cb\s*2|cb2|classroom\s*building\s*2|classroom\s*building\s*ii)\b", "CB2"),
    (r"(?i)\b(?:cb\s*1|cb1|classroom\s*building\s*1|classroom\s*building\s*i)\b", "CB1"),
    (r"(?i)\b(?:hec|harris|harris\s*engineering)\b", "HEC"),
    (r"(?i)\b(?:su|student\s*union|cape\s*florida|pegasus\s*ballroom)\b", "SU"),
    (r"(?i)\b(?:lib|library|john\s*c\.?\s*hitt)\b", "LIB"),
]

def resolve_location(raw_text: str) -> Tuple[Optional[str], Optional[str]]:
    """
    Parses messy meeting text like 'Classroom Building II Room 105' 
    and returns (building_id, room_number).
    """
    building_id = None
    for pattern, b_id in REGEX_PATTERNS:
        if re.search(pattern, raw_text):
            building_id = b_id
            break

    # Extract room number if present (e.g., 'Room 105', '101A')
    room_match = re.search(r"\b(?:room\s*)?(\d{3,4}[A-Za-z]?)\b", raw_text, re.IGNORECASE)
    room = room_match.group(1) if room_match else None

    return building_id, room