"""ClearTalk local web server and SQLite API (Python standard library only)."""
from __future__ import annotations

import json
import hashlib
import getpass
import secrets
import sqlite3
import time
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
DB_DIR = ROOT / "data"
DB_PATH = Path(os.environ.get("CLEARTALK_DB_PATH", str(DB_DIR / "cleartalk.sqlite3"))).expanduser()
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT") or os.environ.get("CLEARTALK_PORT", "8000"))
YOUTUBE_API = "https://www.googleapis.com/youtube/v3/commentThreads"


def youtube_video_id(value):
    """Accept a YouTube watch, short, embed, or shorts URL and return its ID."""
    parsed = urlparse(str(value).strip())
    host = (parsed.hostname or "").lower()
    if parsed.scheme not in ("http", "https"):
        raise ValueError("กรุณาใส่ลิงก์ YouTube ที่ขึ้นต้นด้วย https://")
    if host in ("youtu.be", "www.youtu.be"):
        video_id = parsed.path.strip("/").split("/")[0]
    elif host in ("youtube.com", "www.youtube.com", "m.youtube.com"):
        parts = [part for part in parsed.path.split("/") if part]
        video_id = (parse_qs(parsed.query).get("v", [""])[0] if parsed.path == "/watch"
                    else parts[1] if len(parts) > 1 and parts[0] in ("shorts", "embed", "live") else "")
    else:
        raise ValueError("รองรับลิงก์จาก YouTube เท่านั้น")
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
        raise ValueError("ไม่พบรหัสวิดีโอ YouTube ที่ถูกต้องในลิงก์")
    return video_id


def fetch_youtube_comments(video_id, api_key, limit=200):
    comments, page_token = [], None
    while len(comments) < limit:
        params = {"part": "snippet", "videoId": video_id, "maxResults": min(100, limit-len(comments)),
                  "textFormat": "plainText", "key": api_key}
        if page_token:
            params["pageToken"] = page_token
        request = urllib.request.Request(YOUTUBE_API + "?" + urllib.parse.urlencode(params),
                                         headers={"Accept": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                result = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            try:
                api_error = json.loads(error.read().decode("utf-8")).get("error", {})
                detail = api_error.get("message", "")
                errors = api_error.get("errors", [])
                reason = errors[0].get("reason", "") if errors else ""
            except (ValueError, UnicodeDecodeError):
                detail = ""
                reason = ""
            if error.code == 403 and (reason == "commentsDisabled" or "commentsDisabled" in detail):
                raise ValueError("วิดีโอนี้ปิดการแสดงความคิดเห็น")
            if reason in ("keyInvalid", "keyExpired") or "API key not valid" in detail:
                raise ValueError("API key ไม่ถูกต้องหรือหมดอายุ ตรวจคีย์ใน Google Cloud Console")
            if reason == "accessNotConfigured" or "has not been used in project" in detail:
                raise ValueError("โปรเจกต์ Google Cloud ยังไม่ได้เปิด YouTube Data API v3")
            if reason in ("quotaExceeded", "dailyLimitExceeded", "userRateLimitExceeded", "rateLimitExceeded"):
                raise ValueError("โควตาหรือจำนวนคำขอ YouTube Data API ถึงขีดจำกัดแล้ว")
            if "IP address" in detail or "referer" in detail.lower() or "blocked" in detail.lower():
                raise ValueError("ข้อจำกัด API key บล็อกคำขอ ตรวจ Application restrictions; สำหรับ localhost ให้เลือก None")
            if error.code == 403:
                message = f" ({reason})" if reason else ""
                raise ValueError(f"YouTube ปฏิเสธคำขอ{message}: {detail or 'ตรวจ API key, ข้อจำกัดคีย์ และสิทธิ์ API'}")
            if error.code == 404:
                raise ValueError("ไม่พบวิดีโอนี้")
            raise ValueError("เรียกข้อมูลจาก YouTube ไม่สำเร็จ")
        except (urllib.error.URLError, TimeoutError):
            raise ValueError("เชื่อมต่อ YouTube ไม่สำเร็จ กรุณาลองใหม่")
        for item in result.get("items", []):
            snippet = item.get("snippet", {}).get("topLevelComment", {}).get("snippet", {})
            text = snippet.get("textDisplay", "").strip()
            if text:
                comments.append(text)
        page_token = result.get("nextPageToken")
        if not page_token:
            break
    return comments


def connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    return db


def initialize():
    with connect() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS records (
                position INTEGER PRIMARY KEY,
                record_id TEXT NOT NULL,
                checked_at TEXT NOT NULL,
                message TEXT NOT NULL,
                category TEXT NOT NULL,
                result TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS words (
                position INTEGER PRIMARY KEY,
                phrase TEXT NOT NULL,
                category TEXT NOT NULL,
                severity TEXT NOT NULL,
                active TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS settings (
                setting_key TEXT PRIMARY KEY,
                setting_value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS users (
                user_id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                display_name TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                password_salt BLOB NOT NULL,
                password_hash BLOB NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
                expires_at INTEGER NOT NULL
            );
        """)
        columns = {row[1] for row in db.execute("PRAGMA table_info(users)")}
        if "role" not in columns:
            db.execute("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'")
    seed_profanity_words()


def create_admin(name, email):
    """Create or promote an administrator from a trusted local terminal."""
    password = getpass.getpass("รหัสผ่านแอดมิน (อย่างน้อย 8 ตัวอักษร): ")
    if len(password) < 8:
        raise ValueError("รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร")
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    with connect() as db:
        row = db.execute("SELECT user_id FROM users WHERE email=?", (email.lower(),)).fetchone()
        if row:
            db.execute("UPDATE users SET display_name=?, role='admin', password_salt=?, password_hash=? WHERE user_id=?",
                       (name, salt, digest, row["user_id"]))
            print(f"ยกระดับบัญชี {email} เป็นผู้ดูแลระบบแล้ว")
        else:
            db.execute("INSERT INTO users(email,display_name,role,password_salt,password_hash,created_at) VALUES(?,?,'admin',?,?,?)",
                       (email.lower(), name, salt, digest, int(time.time())))
            print(f"สร้างบัญชีผู้ดูแลระบบ {email} แล้ว")


def seed_profanity_words():
    """Import bundled PyThaiNLP lexicons once, preserving existing edits."""
    sources = [
        (ROOT / "profanity_th.txt", "สูง", "คำหยาบคาย"),
        (ROOT / "swear-words-high.txt", "สูง", "คำหยาบคาย"),
        (ROOT / "swear-words-medium.txt", "ปานกลาง", "คำหยาบคาย"),
        (ROOT / "swear-words-low.txt", "ต่ำ", "คำหยาบคาย"),
        (ROOT / "profanity-extra-th.txt", "ปานกลาง", "คำหยาบคาย"),
        (ROOT / "sexist-hate-th.txt", "ปานกลาง", "เหยียดเพศ/อัตลักษณ์ทางเพศ"),
        (ROOT / "racist-hate-th.txt", "สูง", "เหยียดเชื้อชาติ/ชาติพันธุ์"),
        (ROOT / "violence-extra-th.txt", "สูง", "ความรุนแรง"),
        (ROOT / "sensitive-content-th.txt", "ปานกลาง", "เนื้อหาล่อแหลม"),
    ]
    phrases = []
    for source, severity, category in sources:
        if not source.exists():
            continue
        phrases.extend((line.strip(), severity, category) for line in source.read_text(encoding="utf-8-sig").splitlines()
                       if line.strip() and not line.lstrip().startswith("#"))
    with connect() as db:
        existing = {row[0].strip().casefold() for row in db.execute("SELECT phrase FROM words")}
        next_position = db.execute("SELECT COALESCE(MAX(position), -1) + 1 FROM words").fetchone()[0]
        for phrase, severity, category in phrases:
            if phrase.casefold() in existing:
                continue
            db.execute(
                "INSERT INTO words(position, phrase, category, severity, active) VALUES(?,?,?,?,?)",
                (next_position, phrase, category, severity, "ใช้งาน"),
            )
            next_position += 1
            existing.add(phrase.casefold())


def current_user(handler):
    cookie = handler.headers.get("Cookie", "")
    token = next((part.strip().split("=", 1)[1] for part in cookie.split(";")
                  if part.strip().startswith("ct_session=")), None)
    if not token:
        return None
    digest = hashlib.sha256(token.encode()).hexdigest()
    now = int(time.time())
    with connect() as db:
        db.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))
        row = db.execute(
            "SELECT u.user_id, u.email, u.display_name, u.role FROM sessions s "
            "JOIN users u ON u.user_id=s.user_id WHERE s.token_hash=? AND s.expires_at>=?",
            (digest, now),
        ).fetchone()
    return dict(row) if row else None


def create_session(user_id):
    token = secrets.token_urlsafe(32)
    expires = int(time.time()) + 7 * 24 * 60 * 60
    with connect() as db:
        db.execute("INSERT INTO sessions VALUES (?, ?, ?)",
                   (hashlib.sha256(token.encode()).hexdigest(), user_id, expires))
    return token


def read_state():
    with connect() as db:
        records = [list(row) for row in db.execute(
            "SELECT record_id, checked_at, message, category, result FROM records ORDER BY position"
        )]
        words = [list(row) for row in db.execute(
            "SELECT phrase, category, severity, active FROM words ORDER BY position"
        )]
        settings_row = db.execute(
            "SELECT setting_value FROM settings WHERE setting_key = 'preferences'"
        ).fetchone()
        settings = json.loads(settings_row[0]) if settings_row else {}
        return {"records": records, "words": words, "settings": settings}


def write_state(state):
    records = state.get("records", [])
    words = state.get("words", [])
    settings = state.get("settings", {})
    if not isinstance(records, list) or not isinstance(words, list) or not isinstance(settings, dict):
        raise ValueError("Invalid state format")
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        db.execute("DELETE FROM records")
        db.execute("DELETE FROM words")
        db.executemany(
            "INSERT INTO records VALUES (?, ?, ?, ?, ?, ?)",
            [(i, str(r[0]), str(r[1]), str(r[2]), str(r[3]), str(r[4]))
             for i, r in enumerate(records) if isinstance(r, list) and len(r) >= 5],
        )
        db.executemany(
            "INSERT INTO words VALUES (?, ?, ?, ?, ?)",
            [(i, str(w[0]), str(w[1]), str(w[2]), str(w[3]))
             for i, w in enumerate(words) if isinstance(w, list) and len(w) >= 4],
        )
        db.execute(
            "INSERT INTO settings(setting_key, setting_value) VALUES('preferences', ?) "
            "ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value",
            (json.dumps(settings, ensure_ascii=False),),
        )


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, status, value):
        payload = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def read_json(self):
        size = int(self.headers.get("Content-Length", "0"))
        if size > 2_000_000:
            raise ValueError("Payload too large")
        return json.loads(self.rfile.read(size).decode("utf-8"))

    def set_session_cookie(self, token):
        self.send_header("Set-Cookie", f"ct_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={7*24*60*60}")

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/youtube/comments":
            try:
                body = self.read_json()
                video_id = youtube_video_id(body.get("url", ""))
                api_key = os.environ.get("YOUTUBE_API_KEY", "").strip()
                if not api_key:
                    return self.send_json(503, {"error": "ยังไม่ได้ตั้งค่า YouTube API key ที่เซิร์ฟเวอร์ (YOUTUBE_API_KEY)"})
                comments = fetch_youtube_comments(video_id, api_key)
                return self.send_json(200, {"videoId": video_id, "comments": comments, "count": len(comments)})
            except (ValueError, TypeError, json.JSONDecodeError) as error:
                return self.send_json(400, {"error": str(error)})
        
        if path == "/api/register":
            try:
                body = self.read_json()
                name = str(body.get("name", "")).strip()
                email = str(body.get("email", "")).strip().lower()
                password = str(body.get("password", ""))
                if not name or len(name) > 80 or "@" not in email or len(email) > 254 or len(password) < 8:
                    return self.send_json(400, {"error": "กรุณากรอกชื่อ อีเมล และรหัสผ่านอย่างน้อย 8 ตัวอักษร"})
                salt = secrets.token_bytes(16)
                digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
                with connect() as db:
                    cursor = db.execute(
                        "INSERT INTO users(email,display_name,password_salt,password_hash,created_at) VALUES(?,?,?,?,?)",
                        (email, name, salt, digest, int(time.time())),
                    )
                    user_id = cursor.lastrowid
                token = create_session(user_id)
                self.send_response(201)
                self.set_session_cookie(token)
                payload = json.dumps({"user":{"email":email,"display_name":name,"role":"user"}}, ensure_ascii=False).encode()
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
            except sqlite3.IntegrityError:
                self.send_json(409, {"error": "อีเมลนี้มีบัญชีอยู่แล้ว"})
            except (ValueError, TypeError, json.JSONDecodeError):
                self.send_json(400, {"error": "ข้อมูลไม่ถูกต้อง"})
            return
        if path == "/api/login":
            try:
                body = self.read_json()
                email, password = str(body.get("email", "")).strip().lower(), str(body.get("password", ""))
                with connect() as db:
                    row = db.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
                if not row:
                    return self.send_json(401, {"error": "อีเมลหรือรหัสผ่านไม่ถูกต้อง"})
                digest = hashlib.scrypt(password.encode(), salt=row["password_salt"], n=2**14, r=8, p=1)
                if not secrets.compare_digest(digest, row["password_hash"]):
                    return self.send_json(401, {"error": "อีเมลหรือรหัสผ่านไม่ถูกต้อง"})
                token = create_session(row["user_id"])
                self.send_response(200)
                self.set_session_cookie(token)
                payload = json.dumps({"user":{"email":row["email"],"display_name":row["display_name"],"role":row["role"]}}, ensure_ascii=False).encode()
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
            except (ValueError, TypeError, json.JSONDecodeError):
                self.send_json(400, {"error": "ข้อมูลไม่ถูกต้อง"})
            return
        if path == "/api/logout":
            token = next((part.strip().split("=", 1)[1] for part in self.headers.get("Cookie", "").split(";")
                          if part.strip().startswith("ct_session=")), None)
            if token:
                with connect() as db:
                    db.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),))
            self.send_response(200)
            self.send_header("Set-Cookie", "ct_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        self.send_json(404, {"error": "Not found"})

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/":
            self.path = "/home.html"
            return super().do_GET()
        if path == "/api/session":
            user = current_user(self)
            return self.send_json(200 if user else 401, {"user": user})
        if path == "/api/youtube/status":
            configured = bool(os.environ.get("YOUTUBE_API_KEY", "").strip())
            return self.send_json(200, {"configured": configured})
        if path == "/api/admin/users":
            user = current_user(self)
            if not user or user["role"] != "admin":
                return self.send_json(403, {"error": "เฉพาะผู้ดูแลระบบเท่านั้น"})
            with connect() as db:
                rows = db.execute("SELECT user_id,email,display_name,role,created_at FROM users ORDER BY created_at DESC").fetchall()
            return self.send_json(200, {"users": [dict(row) for row in rows]})
        if path == "/api/state":
            user = current_user(self)
            if not user:
                return self.send_json(401, {"error": "กรุณาเข้าสู่ระบบ"})
            state = read_state()
            if user["role"] != "admin":
                state["records"] = []
            state["user"] = user
            return self.send_json(200, state)
        user = current_user(self)
        if path in ("/index.html", "/admin.html"):
            if not user:
                self.send_response(302)
                self.send_header("Location", "/login.html")
                self.end_headers()
                return
            if path == "/admin.html" and user["role"] != "admin":
                self.send_response(302)
                self.send_header("Location", "/index.html")
                self.end_headers()
                return
        return super().do_GET()

    def do_PUT(self):
        if urlparse(self.path).path != "/api/state":
            return self.send_json(404, {"error": "Not found"})
        user = current_user(self)
        if not user:
            return self.send_json(401, {"error": "กรุณาเข้าสู่ระบบ"})
        if user["role"] != "admin":
            return self.send_json(403, {"error": "เฉพาะผู้ดูแลระบบเท่านั้น"})
        try:
            state = self.read_json()
            write_state(state)
            self.send_json(200, {"saved": True})
        except (ValueError, TypeError, json.JSONDecodeError) as error:
            self.send_json(400, {"error": str(error)})
        except sqlite3.Error:
            self.send_json(500, {"error": "Database operation failed"})


if __name__ == "__main__":
    initialize()
    import sys
    if len(sys.argv) == 4 and sys.argv[1] == "--create-admin":
        create_admin(sys.argv[2], sys.argv[3])
        raise SystemExit(0)
    http_server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"ClearTalk is running at http://{HOST}:{PORT}")
    print(f"SQLite database: {DB_PATH}")
    print(f"YouTube API key configured: {'yes' if os.environ.get('YOUTUBE_API_KEY', '').strip() else 'no'}")
    http_server.serve_forever()
