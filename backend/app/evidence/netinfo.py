"""Server-observed network and browser facts. No third-party lookups, no fingerprinting, no MAC addresses.

IP: the TCP peer address is authoritative. X-Forwarded-For is honoured ONLY when that peer is a configured trusted
reverse proxy (Settings.trusted_proxies, empty by default); then the right-most address that is not itself a trusted
proxy is used. Client-supplied headers from anyone else are ignored, so they cannot spoof the address.
An IP address identifies a network endpoint, not a person (NAT, shared Wi-Fi, carrier-grade NAT, VPNs, proxies)."""
import ipaddress
import re

MAC_UNAVAILABLE = "Unavailable — not accessible through a web browser"
IP_CAVEAT = ("An IP address identifies a network endpoint at a point in time, not a person: shared networks, NAT, "
             "carrier-grade NAT, VPNs and proxies can put many people behind one address.")


def _valid(ip: str) -> bool:
    try:
        ipaddress.ip_address(ip.strip())
        return True
    except ValueError:
        return False


def client_ip(request, trusted_proxies: list[str]) -> tuple[str, str]:
    """(ip, how) where how is 'peer' or 'forwarded-by-trusted-proxy'."""
    peer = request.client.host if request.client else ""
    trusted = set(trusted_proxies or [])
    if peer in trusted:
        chain = [p.strip() for p in request.headers.get("x-forwarded-for", "").split(",") if p.strip()]
        for hop in reversed(chain):
            if _valid(hop) and hop not in trusted:
                return hop, "forwarded-by-trusted-proxy"
    return peer, "peer"


def classify(ip: str) -> dict:
    try:
        a = ipaddress.ip_address(ip)
    except ValueError:
        return {"version": None, "scope": "not an IP address (test client or unknown)"}
    if a.is_loopback:
        scope = "loopback"
    elif a.is_private or a.is_link_local:
        scope = "private"
    elif a.is_reserved or a.is_multicast or a.is_unspecified:
        scope = "reserved"
    else:
        scope = "public"
    if isinstance(a, ipaddress.IPv4Address) and a in ipaddress.ip_network("203.0.113.0/24"):
        scope = "documentation (TEST-NET-3)"
    return {"version": f"IPv{a.version}", "scope": scope}


def parse_ua(ua: str) -> dict:
    """Coarse, display-only browser/OS parsing from the User-Agent header (it is client-supplied and spoofable)."""
    ua = ua or ""
    browser, bver = "Unknown", ""
    for name, pat in (("Edge", r"Edg/([\d.]+)"), ("Opera", r"OPR/([\d.]+)"), ("Firefox", r"Firefox/([\d.]+)"),
                      ("Chrome", r"Chrome/([\d.]+)"), ("Safari", r"Version/([\d.]+).*Safari"), ("curl", r"curl/([\d.]+)"),
                      ("Python client", r"python-httpx/([\d.]+)"), ("Test client", r"(testclient)")):
        m = re.search(pat, ua)
        if m:
            browser, bver = name, m.group(1).split(".")[0] if m.group(1)[0].isdigit() else ""
            break
    os_name, over = "Unknown", ""
    for name, pat in (("iOS", r"iPhone OS ([\d_]+)"), ("iPadOS", r"iPad; CPU OS ([\d_]+)"), ("Android", r"Android ([\d.]+)"),
                      ("macOS", r"Mac OS X ([\d_]+)"), ("Windows", r"Windows NT ([\d.]+)"), ("Linux", r"(Linux)")):
        m = re.search(pat, ua)
        if m:
            os_name, over = name, m.group(1).replace("_", ".") if m.group(1)[0].isdigit() else ""
            break
    return {"browser": browser, "browser_version": bver, "os": os_name, "os_version": over}
