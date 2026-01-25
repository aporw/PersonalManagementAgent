#!/usr/bin/env python3
"""
One-shot migration script to re-hash plaintext passwords in Backend/data/users.json.

Usage:
  python scripts/migrate_hash_passwords.py

This will read the users file, detect passwords that are not bcrypt hashes (using passlib.identify),
hash them and overwrite the users.json file. It prints a summary of changes.
"""
import json
from pathlib import Path
from passlib.context import CryptContext

BASE = Path(__file__).resolve().parent.parent
DATA = BASE / "data" / "users.json"

pwd = CryptContext(schemes=["pbkdf2_sha256", "bcrypt"], deprecated="auto")

def load():
    if not DATA.exists():
        print("no users.json found at", DATA)
        return {}
    with DATA.open("r", encoding="utf-8") as f:
        return json.load(f)

def save(d):
    with DATA.open("w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)

def is_hashed(val):
    try:
        return bool(pwd.identify(val))
    except Exception:
        return False

def main():
    users = load()
    changed = 0
    for uid, u in list(users.items()):
        pw = u.get("password")
        if not pw:
            continue
        if is_hashed(pw):
            continue
        # treat as plaintext — hash and save.
        # bcrypt has a 72-byte input limit; truncate if necessary to avoid errors.
        raw = str(pw)
        if len(raw.encode('utf-8')) > 72:
            print(f"Warning: password for {uid} exceeds 72 bytes; truncating before hashing")
            raw = raw.encode('utf-8')[:72].decode('utf-8', errors='ignore')
        new = pwd.hash(raw)
        u["password"] = new
        users[uid] = u
        changed += 1
        print(f"Re-hashed password for {uid}")
    if changed:
        save(users)
        print(f"Updated {changed} users in {DATA}")
    else:
        print("No plaintext passwords found; no changes made.")

if __name__ == '__main__':
    main()
