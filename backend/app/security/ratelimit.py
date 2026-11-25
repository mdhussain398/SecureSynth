"""In-memory sliding-window failure limiter (resets on restart — documented limitation)."""
from collections import defaultdict, deque
from datetime import timedelta

from app.services import clock


class RateLimiter:
    def __init__(self, max_failures: int = 5, window_s: int = 300, lockout_s: int = 300):
        self.max_failures = max_failures
        self.window = timedelta(seconds=window_s)
        self.lockout = timedelta(seconds=lockout_s)
        self._failures: dict[str, deque] = defaultdict(deque)
        self._locked_until: dict = {}

    def allowed(self, key: str) -> bool:
        until = self._locked_until.get(key)
        if until and clock.now() < until:
            return False
        if until:
            self._locked_until.pop(key, None)
            self._failures.pop(key, None)
        return True

    def record_failure(self, key: str) -> None:
        now = clock.now()
        q = self._failures[key]
        q.append(now)
        while q and now - q[0] > self.window:
            q.popleft()
        if len(q) >= self.max_failures:
            self._locked_until[key] = now + self.lockout

    def reset(self) -> None:
        self._failures.clear()
        self._locked_until.clear()
