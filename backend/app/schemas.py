"""Pydantic mirror of frontend/src/api/types.ts (contract v1.0.0). Keep in sync."""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Decision = Literal["ALLOW", "STEP_UP", "BLOCK"]
Operation = Literal["login", "beneficiary_add", "transfer"]


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=40)
    password: str = Field(min_length=1, max_length=200)


class LoginResponse(BaseModel):
    stage: Literal["totp_required"] = "totp_required"


class TotpRequest(BaseModel):
    code: str = Field(pattern=r"^\d{6}$")


class SimContext(BaseModel):
    city: str
    device_recognised: bool


class SessionInfo(BaseModel):
    username: str
    display_name: str
    role: Literal["customer", "admin"]
    mode: str
    expires_at: datetime
    simulated_context: SimContext


class ChallengeRef(BaseModel):
    id: str
    operation: Operation
    number_match: int
    expires_at: datetime


class TotpResponse(BaseModel):
    decision: Decision
    session: SessionInfo
    challenge: ChallengeRef | None = None
    customer_message: str


class ChallengeStatusResponse(BaseModel):
    id: str
    operation: Operation
    status: str


class AccountSummary(BaseModel):
    account_ref: str
    balance_paise: int
    currency: Literal["INR"] = "INR"
    simulated: Literal[True] = True


class Transaction(BaseModel):
    id: int
    created_at: datetime
    amount_paise: int
    direction: Literal["debit", "credit"]
    counterparty: str
    status: str
    description: str


class Beneficiary(BaseModel):
    id: int
    name: str
    account_ref: str
    created_at: datetime
    trust: str


class OverviewResponse(BaseModel):
    account: AccountSummary
    recent: list[Transaction]
    session: SessionInfo


class AddBeneficiaryRequest(BaseModel):
    name: str = Field(min_length=2, max_length=80, pattern=r"^[A-Za-z][A-Za-z .'-]*$")
    account_ref: str = Field(pattern=r"^SYN-\d{4}$")


class TransferRequest(BaseModel):
    beneficiary_id: int = Field(gt=0)
    amount_paise: int = Field(gt=0, le=10_000_000_00)
    note: str | None = Field(default=None, max_length=120)
    idempotency_key: str = Field(min_length=8, max_length=64)


class SensitiveActionResponse(BaseModel):
    result: Literal["completed", "pending_verification", "restricted"]
    decision: Decision
    customer_message: str
    transaction: Transaction | None = None
    beneficiary: Beneficiary | None = None
    challenge: ChallengeRef | None = None


class AppConfig(BaseModel):
    ghost_banking_enabled: bool
    demo_mode: bool
    model_version: str
