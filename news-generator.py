#!/usr/bin/env python3
"""news-generator.py - publisher RSS -> flat JSON string arrays for the KJ
news ticker. Output: ["Headline", ...]. In www/ so ha-backup.sh captures it."""
import json, sys, os, tempfile, urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime

FEEDS = {
    "news_en.json": "https://timesofindia.indiatimes.com/rssfeedstopstories.cms",
    "news_ta.json": "https://feeds.bbci.co.uk/tamil/rss.xml",
}
OUT_DIR      = os.path.dirname(os.path.abspath(__file__))
MAX_ITEMS    = 15
STRIP_SOURCE = True
UA           = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"
LOG          = os.path.join(OUT_DIR, "news-generator.log")

def log(msg):
    line = datetime.now().isoformat(timespec="seconds") + "  " + msg
    print(line)
    try:
        with open(LOG, "a") as f:
            f.write(line + "\n")
    except OSError:
        pass

def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()

def parse(xml_bytes):
    root = ET.fromstring(xml_bytes)
    titles = []
    for item in root.iter("item"):
        t = item.findtext("title")
        if not t:
            continue
        t = t.strip()
        if STRIP_SOURCE and " - " in t:
            t = t.rsplit(" - ", 1)[0].strip()
        if t:
            titles.append(t)
        if len(titles) >= MAX_ITEMS:
            break
    return titles

def write_atomic(path, data):
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        os.replace(tmp, path)
        os.chmod(path, 0o644)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise

def main():
    failures = 0
    for fname, url in FEEDS.items():
        path = os.path.join(OUT_DIR, fname)
        try:
            titles = parse(fetch(url))
            if not titles:
                raise ValueError("0 headlines parsed - keeping existing file")
            write_atomic(path, titles)
            log("OK   " + fname + ": " + str(len(titles)) + " headlines")
        except Exception as e:
            failures += 1
            log("FAIL " + fname + ": " + str(e) + "  (kept previous file)")
    sys.exit(1 if failures else 0)

if __name__ == "__main__":
    main()
