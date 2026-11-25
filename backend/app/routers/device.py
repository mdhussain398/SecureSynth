"""Simulated trusted device. Authenticates ONLY with X-Device-Key; banking cookies are never consulted (A2)."""
from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel

from app.services import challenges
from app.state import AppState, get_db, get_state

router = APIRouter(prefix="/device", tags=["trusted-device (simulated)"])


class RespondBody(BaseModel):
    challenge_id: str
    selected_number: int
    approve: bool


@router.get("/pending")
def pending(x_device_key: str | None = Header(default=None), db=Depends(get_db)):
    user = challenges.device_user(db, x_device_key)
    return [{"id": c.id, "operation": c.operation, "context_summary": c.context_summary, "created_at": c.created_at,
             "expires_at": c.expires_at, "options": sorted(c.options)} for c in challenges.pending_for(db, user)]


@router.post("/respond")
def respond(body: RespondBody, x_device_key: str | None = Header(default=None), db=Depends(get_db),
            st: AppState = Depends(get_state)):
    user = challenges.device_user(db, x_device_key)
    return {"status": challenges.respond(db, st, user, body.challenge_id, body.selected_number, body.approve)}
