"""Encryption at rest for TOTP seeds (Fernet / AES-128-CBC + HMAC)."""
from cryptography.fernet import Fernet


class SecretBox:
    def __init__(self, key: str | bytes):
        self._f = Fernet(key)

    @classmethod
    def generate(cls) -> "SecretBox":
        return cls(Fernet.generate_key())

    def encrypt(self, plaintext: str) -> str:
        return self._f.encrypt(plaintext.encode()).decode()

    def decrypt(self, ciphertext: str) -> str:
        return self._f.decrypt(ciphertext.encode()).decode()

    def encrypt_bytes(self, data: bytes) -> bytes:
        return self._f.encrypt(data)

    def decrypt_bytes(self, token: bytes) -> bytes:
        return self._f.decrypt(token)
