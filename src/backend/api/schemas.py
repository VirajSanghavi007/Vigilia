from enum import Enum

from pydantic import BaseModel, Field

from . import ingest_store


# ── Validation Enums (Issue #5) ─────────────────────────────────────────────
class PatternType(str, Enum):
    FAN_OUT = "FAN_OUT"
    FAN_IN = "FAN_IN"
    CYCLE = "CYCLE"
    SCATTER_GATHER = "SCATTER_GATHER"
    GATHER_SCATTER = "GATHER_SCATTER"
    BIPARTITE = "BIPARTITE"
    RANDOM = "RANDOM"


class SeverityLevel(str, Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class AlertSource(str, Enum):
    LABELLED = "labelled"
    UNLABELLED = "unlabelled"


class DecisionType(str, Enum):
    CONFIRM = "confirm"
    REVIEW = "review"
    DISMISS = "dismiss"


class LoginRequest(BaseModel):
    company_id: str
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class TransactionIn(BaseModel):
    """One transaction. Field names match the IBM/tx.csv schema; snake_case
    aliases are accepted too so producers can POST either style."""
    timestamp: str | None = Field(default=None, alias="Timestamp")
    from_bank: str = Field(alias="From Bank")
    from_account: str = Field(alias="From Account")
    to_bank: str = Field(alias="To Bank")
    to_account: str = Field(alias="To Account")
    amount_paid: float = Field(alias="Amount Paid")
    amount_received: float | None = Field(default=None, alias="Amount Received")
    payment_currency: str = Field(default="US Dollar", alias="Payment Currency")
    receiving_currency: str = Field(default="US Dollar", alias="Receiving Currency")
    payment_format: str = Field(default="ACH", alias="Payment Format")

    model_config = {"populate_by_name": True}

    def to_row(self) -> dict:
        return {
            "Timestamp": self.timestamp or ingest_store.now_iso(),
            "From Bank": self.from_bank,
            "From Account": self.from_account,
            "To Bank": self.to_bank,
            "To Account": self.to_account,
            "Amount Received": self.amount_received if self.amount_received is not None else self.amount_paid,
            "Receiving Currency": self.receiving_currency,
            "Amount Paid": self.amount_paid,
            "Payment Currency": self.payment_currency,
            "Payment Format": self.payment_format,
        }


class DecisionBody(BaseModel):
    decision: DecisionType
    reason: str = Field(default="", max_length=500)
    analyst: str = ""


class WhitelistAddBody(BaseModel):
    account_id: str = Field(..., min_length=1)
    reason: str = Field(default="", max_length=500)
