from datetime import timedelta

import pyotp
import pytest

from app.security import passwords, totp, tokens, ratelimit, secrets_box


def test_password_hash_verifies_correct_password_only():
    h = passwords.hash_password("Correct-Horse-9")
    assert h.startswith("$argon2id$")
    assert passwords.verify_password(h, "Correct-Horse-9") is True
    assert passwords.verify_password(h, "wrong") is False


def test_totp_accepts_current_code_and_returns_step(clock):
    secret = pyotp.random_base32()
    now = clock.now()
    code = pyotp.TOTP(secret).at(now)
    step = totp.verify(secret, code, last_step=None, now=now)
    assert step == int(now.timestamp()) // 30


def test_totp_rejects_replay_of_same_code(clock):
    secret = pyotp.random_base32()
    now = clock.now()
    code = pyotp.TOTP(secret).at(now)
    step = totp.verify(secret, code, last_step=None, now=now)
    assert totp.verify(secret, code, last_step=step, now=now) is None


def test_totp_rejects_code_three_steps_old(clock):
    secret = pyotp.random_base32()
    now = clock.now()
    old = pyotp.TOTP(secret).at(now - timedelta(seconds=90))
    assert totp.verify(secret, old, last_step=None, now=now) is None


def test_totp_rejects_non_numeric_input(clock):
    secret = pyotp.random_base32()
    assert totp.verify(secret, "12ab56", last_step=None, now=clock.now()) is None


def test_token_hash_differs_from_raw_and_is_stable():
    raw, digest = tokens.new_token()
    assert raw != digest and len(raw) >= 32
    assert tokens.hash_token(raw) == digest


def test_rate_limiter_locks_after_five_failures_and_unlocks_later(clock):
    rl = ratelimit.RateLimiter(max_failures=5, window_s=300, lockout_s=300)
    for _ in range(5):
        assert rl.allowed("user:asha")
        rl.record_failure("user:asha")
    assert rl.allowed("user:asha") is False
    clock.advance(minutes=6)
    assert rl.allowed("user:asha") is True


def test_secret_box_roundtrip_and_ciphertext_not_plaintext():
    box = secrets_box.SecretBox.generate()
    ct = box.encrypt("JBSWY3DPEHPK3PXP")
    assert "JBSWY3DPEHPK3PXP" not in ct
    assert box.decrypt(ct) == "JBSWY3DPEHPK3PXP"
