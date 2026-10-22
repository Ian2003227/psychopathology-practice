#!/usr/bin/env python3
"""Re-encrypt data/bank.enc with a new 通關密語 without needing data-raw/.

Usage: python3 scripts/rekey.py --old <舊密語> --new <新密語>
After this, build.py must be run with the new passphrase. Remember to set the same value as
access_code in the Google Sheet's "settings" tab, otherwise logged-in users cannot open the bank.
"""
import argparse
import base64
import json
import os
import sys

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build import OUT, encrypt  # noqa: E402


def decrypt(path, password):
    with open(path, encoding="utf-8") as f:
        env = json.load(f)
    d = base64.b64decode
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=d(env["salt"]), iterations=env["iterations"]).derive(password.encode())
    try:
        return AESGCM(key).decrypt(d(env["iv"]), d(env["ciphertext"]), None)
    except Exception:
        sys.exit("舊密語解不開 data/bank.enc，未做任何更動")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--old", required=True, help="現在的通關密語")
    ap.add_argument("--new", required=True, help="新的通關密語")
    args = ap.parse_args()
    path = os.path.join(OUT, "bank.enc")
    plain = decrypt(path, args.old)
    json.loads(plain)  # sanity check before overwriting
    with open(path, "w", encoding="utf-8") as f:
        json.dump(encrypt(plain, args.new), f)
    print(f"已用新密語重新加密 data/bank.enc（{os.path.getsize(path) / 1024:.1f} KB）。記得 commit，並更新 Google Sheet 的 access_code。")


if __name__ == "__main__":
    main()
