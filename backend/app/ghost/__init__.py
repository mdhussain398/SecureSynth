"""Ghost Banking: an isolated, entirely synthetic banking ledger for sessions the risk engine BLOCKed.

Isolation rules (test-enforced in tests/test_ghost.py):
  * Separate SQLite database (Settings.ghost_database_url) with its own declarative Base: no foreign keys,
    no shared tables, no shared engine with the protected database.
  * Nothing in this package imports the protected banking models or the protected ledger. Callers pass plain
    ids (session id, user id); this package can neither read nor move protected money.
  * Only enabled when GHOST_BANKING_ENABLED=true (off by default, pending mentor approval).
"""
