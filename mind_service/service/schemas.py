from pydantic import BaseModel
from typing import List, Optional

class DecideRequest(BaseModel):
    agent_id: str
    prompt: str
    hrm_enabled: bool = True
    max_new_tokens: int = 64

class FeatureValue(BaseModel):
    feature_id: int
    value: float

class DecideResponse(BaseModel):
    text: str
    features: List[FeatureValue]
    hrm_vector: Optional[List[float]] = None
