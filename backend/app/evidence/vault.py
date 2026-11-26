"""Tamper-evident evidence vault.

* Content hash: SHA-256 over deterministic canonical JSON (sorted keys, no whitespace, UTF-8) or over the raw blob bytes.
* Ledger: every evidence event is appended to a hash chain (entry_hash = SHA-256(canonical(entry without entry_hash)),
  each entry carries the previous entry's hash). Appends are serialised (process lock + unique (chain, seq)), so the
  chain stays linear under concurrent writes.
* Blobs: Fernet-encrypted at rest, stored under a random file name inside the store directory (no user input ever
  reaches a path), never served statically.
* Verification reports problems and records alerts; it never repairs or overwrites anything.

Threat model (honest): this is tamper-EVIDENT, not immutable. Someone who controls the whole storage (database, files
and the code) can rewrite evidence and recompute every hash. Stronger guarantees need checkpoints anchored outside
this system (e.g. a hash periodically published to an independent party). See docs/EVIDENCE_VAULT.md."""
import hashlib
import json
import re
import secrets
import threading
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.errors import ApiError
from app.evidence.models import EvidenceItem, IntegrityAlert, LedgerEntry
from app.services import clock

GENESIS = "0" * 64
_LOCK = threading.Lock()
_SAFE = re.compile(r"^[a-f0-9]{32}\.bin$")
CLASSIFICATIONS = ("observed", "derived", "synthetic")


def canonical(obj) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str).encode("utf-8")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def chain_for(is_lab: bool) -> str:
    return "lab" if is_lab else "genuine"


def _entry_hash(e: dict) -> str:
    return sha256(canonical({k: e[k] for k in ("chain", "seq", "evidence_id", "incident_ref", "event_type", "ts", "actor",
                                                "content_hash", "prev_hash", "meta")}))


def append(edb, *, chain: str, event_type: str, actor: str, evidence_id=None, incident_ref=None, content_hash=None,
           meta: dict | None = None) -> LedgerEntry:
    """Append one event to `chain` and commit. Serialised so the chain never forks."""
    with _LOCK:
        for _ in range(5):
            last = edb.scalar(select(LedgerEntry).where(LedgerEntry.chain == chain).order_by(LedgerEntry.seq.desc()).limit(1))
            e = {"chain": chain, "seq": (last.seq + 1) if last else 1, "evidence_id": evidence_id, "incident_ref": incident_ref,
                 "event_type": event_type, "ts": clock.now().isoformat(), "actor": actor, "content_hash": content_hash,
                 "prev_hash": last.entry_hash if last else GENESIS, "meta": meta or {}}
            row = LedgerEntry(chain=chain, seq=e["seq"], evidence_id=evidence_id, incident_ref=incident_ref, event_type=event_type,
                              ts=datetime.fromisoformat(e["ts"]), actor=actor, content_hash=content_hash,
                              prev_hash=e["prev_hash"], entry_hash=_entry_hash(e), meta=e["meta"])
            edb.add(row)
            try:
                edb.commit()
                return row
            except IntegrityError:  # another process appended first: retry on the new tail
                edb.rollback()
        raise ApiError(503, "LEDGER_BUSY", "Evidence ledger is busy. Try again.")


def _store(st) -> Path:
    p = Path(st.evidence_store_dir)
    p.mkdir(parents=True, exist_ok=True)
    return p


def add_item(edb, st, *, kind: str, classification: str, source: str, provenance: str, actor: str, is_lab: bool,
             incident_ref: str | None = None, session_id: str | None = None, content: dict | None = None,
             blob: bytes | None = None, mime: str | None = None, meta: dict | None = None) -> EvidenceItem:
    if classification not in CLASSIFICATIONS:
        raise ValueError("classification")
    if (content is None) == (blob is None):
        raise ValueError("exactly one of content or blob")
    if content is not None:  # store exactly the canonical form that is hashed (datetimes become ISO strings)
        content = json.loads(canonical(content))
    if meta is not None:
        meta = json.loads(canonical(meta))
    now = clock.now()
    item = EvidenceItem(id="EV-" + secrets.token_hex(6).upper(), incident_ref=incident_ref, session_id=session_id, kind=kind,
                        classification=classification, source=source[:80], provenance=provenance[:300], content=content,
                        mime=mime, collected_at=now, collected_by=actor, is_lab=is_lab, meta=meta or {},
                        retention_until=now + timedelta(days=st.settings.evidence_retention_days),
                        content_sha256=sha256(canonical(content)) if content is not None else sha256(blob))
    if blob is not None:
        name = secrets.token_hex(16) + ".bin"
        (_store(st) / name).write_bytes(st.box.encrypt_bytes(blob))
        item.blob_path, item.size_bytes = name, len(blob)
    edb.add(item)
    edb.commit()
    append(edb, chain=chain_for(is_lab), event_type="collected", actor=actor, evidence_id=item.id, incident_ref=incident_ref,
           content_hash=item.content_sha256, meta={"kind": kind, "classification": classification, "source": source[:80]})
    return item


def read_blob(st, item: EvidenceItem) -> bytes:
    if not item.blob_path or not _SAFE.match(item.blob_path):
        raise ApiError(404, "NOT_FOUND", "No file for this evidence.")
    path = _store(st) / item.blob_path
    if not path.exists():
        raise ApiError(410, "EVIDENCE_MISSING", "The evidence file is missing. Run an integrity verification.")
    return st.box.decrypt_bytes(path.read_bytes())


def record_access(edb, item: EvidenceItem, actor: str, event_type: str = "accessed", meta: dict | None = None) -> None:
    append(edb, chain=chain_for(item.is_lab), event_type=event_type, actor=actor, evidence_id=item.id,
           incident_ref=item.incident_ref, content_hash=item.content_sha256, meta=meta)


def items_for(edb, incident_ref: str, include_deleted: bool = False) -> list[EvidenceItem]:
    q = select(EvidenceItem).where(EvidenceItem.incident_ref == incident_ref)
    if not include_deleted:
        q = q.where(EvidenceItem.deleted_at.is_(None))
    return list(edb.scalars(q.order_by(EvidenceItem.collected_at, EvidenceItem.id)).all())


def custody(edb, incident_ref: str) -> list[dict]:
    rows = edb.scalars(select(LedgerEntry).where(LedgerEntry.incident_ref == incident_ref).order_by(LedgerEntry.chain, LedgerEntry.seq)).all()
    return [{"seq": r.seq, "chain": r.chain, "ts": r.ts, "event_type": r.event_type, "actor": r.actor, "evidence_id": r.evidence_id,
             "content_hash": r.content_hash, "prev_hash": r.prev_hash, "entry_hash": r.entry_hash, "meta": r.meta} for r in rows]


def manifest(edb, incident_ref: str) -> dict:
    items = items_for(edb, incident_ref)
    entries = [{"evidence_id": i.id, "kind": i.kind, "classification": i.classification, "sha256": i.content_sha256} for i in items]
    return {"incident_ref": incident_ref, "items": entries, "manifest_sha256": sha256(canonical(entries))}


def _verify_chain(edb, chain: str) -> list[dict]:
    problems, prev, expect = [], GENESIS, 1
    for r in edb.scalars(select(LedgerEntry).where(LedgerEntry.chain == chain).order_by(LedgerEntry.seq)).all():
        e = {"chain": r.chain, "seq": r.seq, "evidence_id": r.evidence_id, "incident_ref": r.incident_ref, "event_type": r.event_type,
             "ts": r.ts.isoformat(),
             "actor": r.actor, "content_hash": r.content_hash, "prev_hash": r.prev_hash, "meta": r.meta}
        if r.seq != expect:
            problems.append({"problem": "chain_gap", "detail": f"{chain} ledger: expected entry {expect}, found {r.seq}", "seq": r.seq})
        if r.prev_hash != prev:
            problems.append({"problem": "broken_link", "detail": f"{chain} ledger entry {r.seq} does not link to entry {r.seq - 1}", "seq": r.seq})
        if _entry_hash(e) != r.entry_hash:
            problems.append({"problem": "ledger_modified", "detail": f"{chain} ledger entry {r.seq} was modified", "seq": r.seq})
        prev, expect = r.entry_hash, r.seq + 1
    return problems


def verify(edb, st, actor: str, incident_ref: str | None = None) -> dict:
    """Recompute every content hash and the ledger chains. Problems are recorded as alerts; nothing is repaired."""
    q = select(EvidenceItem)
    if incident_ref:
        q = q.where(EvidenceItem.incident_ref == incident_ref)
    items = edb.scalars(q).all()
    results, problems = [], []
    for it in items:
        if it.deleted_at is not None:
            results.append({"evidence_id": it.id, "status": "deleted", "detail": "Deleted under the retention procedure"})
            continue
        status, detail = "verified", ""
        try:
            data = canonical(it.content) if it.blob_path is None else read_blob(st, it)
            if sha256(data) != it.content_sha256:
                status, detail = "mismatch", "Content does not match its recorded SHA-256"
        except ApiError as e:
            status, detail = ("missing", "Evidence file is missing") if e.status in (404, 410) else ("mismatch", e.message)
        except Exception:  # undecryptable blob = modified ciphertext
            status, detail = "mismatch", "Evidence file cannot be decrypted (modified)"
        # the 'collected' ledger entry must carry the same content hash
        first = edb.scalar(select(LedgerEntry).where(LedgerEntry.evidence_id == it.id, LedgerEntry.event_type == "collected"))
        if first is None:
            status, detail = "mismatch", "No collection record in the ledger"
        elif first.content_hash != it.content_sha256 and status == "verified":
            status, detail = "mismatch", "Recorded hash differs from the ledger's collection hash"
        results.append({"evidence_id": it.id, "kind": it.kind, "status": status, "detail": detail, "is_lab": it.is_lab})
        if status != "verified":
            problems.append({"problem": status, "detail": f"{it.id}: {detail}", "evidence_id": it.id, "is_lab": it.is_lab,
                             "incident_ref": it.incident_ref})
    chains = {}
    for chain in ("genuine", "lab"):
        cp = _verify_chain(edb, chain)
        chains[chain] = "verified" if not cp else "mismatch"
        problems += [{**p, "is_lab": chain == "lab", "incident_ref": None, "evidence_id": None} for p in cp]
    for p in problems:
        edb.add(IntegrityAlert(ts=clock.now(), incident_ref=p.get("incident_ref"), evidence_id=p.get("evidence_id"),
                               problem=p["problem"], detail=p["detail"][:300], is_lab=p.get("is_lab", False)))
    edb.commit()
    overall = "verified" if not problems else ("missing" if all(p["problem"] == "missing" for p in problems) else "mismatch")
    for chain in {chain_for(i.is_lab) for i in items} or {"genuine"}:
        append(edb, chain=chain, event_type="integrity_verified", actor=actor, incident_ref=incident_ref,
               meta={"result": overall, "items": len(items), "problems": len(problems)})
    return {"status": overall, "checked_at": clock.now(), "items": results, "chains": chains, "problems": problems,
            "manifest": manifest(edb, incident_ref) if incident_ref else None}


def delete_item(edb, st, item: EvidenceItem, actor: str, reason: str) -> None:
    """Authorised deletion: only after retention expiry, or for Scenario Lab fixtures. The ledger keeps the hash."""
    if not item.is_lab and clock.now() < item.retention_until:
        raise ApiError(409, "RETENTION_ACTIVE", f"Retention runs until {item.retention_until.date()}; this evidence cannot be deleted yet.")
    if item.blob_path and _SAFE.match(item.blob_path):
        (_store(st) / item.blob_path).unlink(missing_ok=True)
    item.deleted_at = clock.now()
    edb.commit()
    append(edb, chain=chain_for(item.is_lab), event_type="deleted", actor=actor, evidence_id=item.id, incident_ref=item.incident_ref,
           content_hash=item.content_sha256, meta={"reason": reason[:200]})
