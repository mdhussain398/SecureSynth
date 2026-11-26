"""Explainable fraud correlation graph built from existing investigation records (never hardcoded).

Direct edges (what was recorded): incident→session, session→customer, session→IP, session→registered device,
session→transaction attempt, attempt→payee reference, contained session→synthetic payee (Ghost Banking).

Derived correlations between two incidents, by documented rule:
  R1 shared IP address ............ weak; moderate if both incidents fall within 24 h of each other. Loopback/private
                                     addresses never exceed weak (one machine or one office network).
  R2 shared device cookie ......... moderate across DIFFERENT customers (one browser used for several accounts);
                                     weak for the same customer (expected).
  R3 shared payee reference ....... moderate across different customers (possible mule account).
  Corroboration: two or more independent indicators between the same pair of incidents → strong.
A correlation is an investigative lead, never proof of coordination or identity. Nothing here blocks a user,
blacklists a payee or files a report."""
from collections import defaultdict
from datetime import timedelta

from sqlalchemy import select

from app import models
from app.evidence import netinfo
from app.services import clock

LEVEL = {"weak": 1, "moderate": 2, "strong": 3}
LIMIT_INCIDENTS, LIMIT_NODES = 60, 300
CAVEAT = ("Correlations are leads for an analyst, not proof: shared networks, NAT, VPNs, family members and shared "
          "computers produce innocent overlaps.")


def _mask_name(u: models.User, reveal: bool) -> str:
    if reveal:
        return f"{u.display_name} ({u.username})"
    n = u.username
    return f"{n[0]}{'*' * max(len(n) - 2, 1)}{n[-1]} · C{u.id:04d}"


def _mask_ip(ip: str, reveal: bool) -> str:
    if reveal:
        return ip
    if ":" in ip:
        return ip.split(":")[0] + ":…"
    p = ip.split(".")
    return ".".join(p[:3] + ["x"]) if len(p) == 4 else ip


def build(db, st, *, hours: int = 720, include_lab: bool = True, min_strength: str = "weak", severity: str | None = None,
          reveal: bool = False, focus: str | None = None, since=None, until=None) -> dict:
    since = since or clock.now() - timedelta(hours=max(1, min(hours, 24 * 365)))
    q = select(models.SecurityIncident).where(models.SecurityIncident.created_at >= since)
    if until is not None:
        q = q.where(models.SecurityIncident.created_at <= until)
    if not include_lab:
        q = q.where(models.SecurityIncident.is_lab.is_(False))
    if severity:
        q = q.where(models.SecurityIncident.severity == severity)
    incidents = db.scalars(q.order_by(models.SecurityIncident.created_at.desc()).limit(LIMIT_INCIDENTS)).all()
    nodes: dict[str, dict] = {}
    edges: dict[tuple, dict] = {}
    ind = {"ip": defaultdict(set), "device": defaultdict(set), "payee": defaultdict(set)}  # value -> {incident refs}
    inc_by_ref = {i.ref: i for i in incidents}

    def node(nid, ntype, label, **kw):
        n = nodes.setdefault(nid, {"id": nid, "type": ntype, "label": label, "incidents": set(), "first_seen": None,
                                   "last_seen": None, "synthetic": False, **kw})
        return n

    def seen(n, ts, ref, synthetic):
        if ts is not None:
            t = ts.isoformat() if hasattr(ts, "isoformat") else str(ts)
            n["first_seen"] = min(filter(None, [n["first_seen"], t])) if n["first_seen"] else t
            n["last_seen"] = max(filter(None, [n["last_seen"], t])) if n["last_seen"] else t
        if ref:
            n["incidents"].add(ref)
        n["synthetic"] = n["synthetic"] or synthetic

    def edge(a, b, rel, provenance, synthetic, explanation):
        key = (min(a, b), max(a, b), rel)
        if key not in edges:  # de-duplicated: one edge per relationship
            edges[key] = {"source": a, "target": b, "relation": rel, "kind": "direct", "strength": None,
                          "provenance": provenance, "synthetic": synthetic, "explanation": explanation}

    for inc in incidents:
        lab = bool(inc.is_lab)
        u = db.get(models.User, inc.user_id)
        inid = f"incident:{inc.ref}"
        seen(node(inid, "incident", inc.ref, severity=inc.severity, status=inc.status, risk_score=inc.risk_score,
                  incident_id=inc.id, ghost=bool(inc.ghost)), inc.created_at, inc.ref, lab)
        cid = f"customer:{u.id}"
        seen(node(cid, "customer", _mask_name(u, reveal)), inc.created_at, inc.ref, lab)
        for sid in inc.session_ids or []:
            s = db.get(models.Session, sid)
            if s is None:
                continue
            snid = f"session:{sid}"
            seen(node(snid, "session", sid, mode=s.mode), s.created_at, inc.ref, lab)
            seen(nodes[snid], s.last_seen, None, lab)
            edge(inid, snid, "contains_session", "incident record", lab, "This session was restricted under the incident")
            edge(snid, cid, "belongs_to", "session record", lab, "Session authenticated as this customer")
            ip = (s.context or {}).get("sim_ip") or s.ip
            if ip and ip != "testclient":
                inid_ip = f"ip:{ip}"
                cls = netinfo.classify(ip)
                seen(node(inid_ip, "ip", _mask_ip(ip, reveal), scope=cls["scope"], version=cls["version"]), s.created_at, inc.ref,
                     lab or bool((s.context or {}).get("sim_ip")))
                edge(snid, inid_ip, "observed_from", "Scenario Lab simulated" if (s.context or {}).get("sim_ip") else "server-observed peer address",
                     lab, "The server saw the session's requests come from this address")
                ind["ip"][ip].add(inc.ref)
            if s.device_id:
                d = db.get(models.Device, s.device_id)
                if d is not None:
                    did = f"device:{d.token_hash[:12]}"
                    seen(node(did, "device", f"dev-{d.id}" + ("" if reveal else ""), trust=d.trust), d.first_seen, inc.ref, lab)
                    edge(snid, did, "used_device", "device registry (server-issued browser cookie)", lab,
                         "The session presented this registered browser cookie")
                    ind["device"][d.token_hash].add((inc.ref, u.id))
            for t in db.scalars(select(models.Transaction).where(models.Transaction.session_id == sid,
                                                                 models.Transaction.status.in_(("restricted", "pending_verification", "attempted")))).all():
                tid = f"txn:{t.id}"
                seen(node(tid, "transaction", f"₹{t.amount_paise / 100:,.0f} {t.status}", amount_paise=t.amount_paise, status=t.status),
                     t.created_at, inc.ref, lab)
                edge(snid, tid, "attempted", "protected ledger (never executed)", lab, "This session attempted the transfer")
                ben = db.get(models.Beneficiary, t.beneficiary_id) if t.beneficiary_id else None
                if ben is not None:
                    bid = f"payee:{ben.account_ref}"
                    seen(node(bid, "beneficiary", ben.account_ref if reveal else ben.account_ref[:5] + "**" + ben.account_ref[-2:]), t.created_at, inc.ref, lab)
                    edge(tid, bid, "to_payee", "protected ledger", lab, "Transfer attempt was addressed to this payee reference")
                    ind["payee"][ben.account_ref].add((inc.ref, u.id))
            if inc.ghost and st.GhostSessionLocal is not None:
                from app.ghost import service as ghost
                with st.GhostSessionLocal() as gdb:
                    g = ghost.monitor(gdb, sid)
                for b in (g or {}).get("beneficiaries", []):
                    if b.get("origin") != "session":
                        continue
                    bid = f"payee:{b['account_ref']}"
                    seen(node(bid, "beneficiary", b["account_ref"] if reveal else b["account_ref"][:5] + "**" + b["account_ref"][-2:]),
                         b["created_at"], inc.ref, True)
                    edge(snid, bid, "added_payee_in_ghost", "Ghost Banking (synthetic ledger)", True,
                         "The contained session added this payee reference in Ghost Banking")
                    ind["payee"][b["account_ref"]].add((inc.ref, u.id))

    # derived incident-to-incident correlations
    pairs: dict[tuple, list] = defaultdict(list)
    for ip, refs in ind["ip"].items():
        refs = sorted(refs)
        for i, a in enumerate(refs):
            for b in refs[i + 1:]:
                gap = abs((inc_by_ref[a].created_at - inc_by_ref[b].created_at).total_seconds())
                scope = netinfo.classify(ip)["scope"]
                lvl = "weak" if scope in ("loopback", "private") or gap > 86400 else "moderate"
                pairs[(a, b)].append({"rule": "R1", "indicator": "shared IP address", "value": _mask_ip(ip, reveal), "level": lvl,
                                      "note": f"{scope} address; incidents {gap / 3600:.1f} h apart"})
    for key, kind, rule, label in ((None, "device", "R2", "shared registered device cookie"), (None, "payee", "R3", "shared payee reference")):
        for value, members in ind[kind].items():
            members = sorted(members)
            for i, (a, ua) in enumerate(members):
                for b, ub in members[i + 1:]:
                    if a == b:
                        continue
                    lvl = "moderate" if ua != ub else "weak"
                    if kind == "payee" and ua == ub:
                        continue  # one customer paying the same payee twice is not a correlation
                    pairs[(min(a, b), max(a, b))].append({"rule": rule, "indicator": label, "level": lvl,
                                                          "value": value[:12] if kind == "device" else (value if reveal else value[:5] + "**"),
                                                          "note": "different customers" if ua != ub else "same customer"})
    for (a, b), inds in pairs.items():
        rules = {i["rule"] for i in inds}
        level = "strong" if len(rules) >= 2 else max((i["level"] for i in inds), key=LEVEL.get)
        if LEVEL[level] < LEVEL.get(min_strength, 1):
            continue
        synthetic = inc_by_ref[a].is_lab or inc_by_ref[b].is_lab
        edges[(f"incident:{a}", f"incident:{b}", "correlated")] = {
            "source": f"incident:{a}", "target": f"incident:{b}", "relation": "correlated", "kind": "derived", "strength": level,
            "indicators": inds, "provenance": "derived by correlation rules " + ", ".join(sorted(rules)), "synthetic": synthetic,
            "explanation": f"{len(inds)} shared indicator(s): " + "; ".join(f"{i['indicator']} ({i['note']})" for i in inds) +
                           (". Corroborated by independent indicators." if level == "strong" else "."),
            "limitations": CAVEAT}

    out_nodes = list(nodes.values())
    out_edges = list(edges.values())
    if focus and focus in nodes:  # bounded expansion: the focus node and everything within two hops
        adj = defaultdict(set)
        for e in out_edges:
            adj[e["source"]].add(e["target"])
            adj[e["target"]].add(e["source"])
        keep, frontier = {focus}, {focus}
        for _ in range(2):
            frontier = {m for n in frontier for m in adj[n]} - keep
            keep |= frontier
        out_nodes = [n for n in out_nodes if n["id"] in keep]
        out_edges = [e for e in out_edges if e["source"] in keep and e["target"] in keep]
    truncated = len(out_nodes) > LIMIT_NODES
    out_nodes = out_nodes[:LIMIT_NODES]
    ids = {n["id"] for n in out_nodes}
    out_edges = [e for e in out_edges if e["source"] in ids and e["target"] in ids]
    for n in out_nodes:
        n["incidents"] = sorted(n["incidents"])
        n["degree"] = sum(1 for e in out_edges if n["id"] in (e["source"], e["target"]))
    return {"nodes": out_nodes, "edges": out_edges, "truncated": truncated, "masked": not reveal, "caveat": CAVEAT,
            "rules": {"R1": "Shared IP address: weak; moderate within 24 h; never above weak for loopback/private addresses",
                      "R2": "Shared registered device cookie: moderate across different customers, weak for the same customer",
                      "R3": "Shared payee reference across different customers: moderate (possible mule account)",
                      "corroboration": "Two or more independent indicators between the same incidents: strong"},
            "limits": {"incidents": LIMIT_INCIDENTS, "nodes": LIMIT_NODES}, "generated_at": clock.now()}
