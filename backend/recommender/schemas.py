from pydantic import BaseModel


class RecommendationItem(BaseModel):
    event_id: int
    score: float
    reason: str

    model_config = {"from_attributes": True}
