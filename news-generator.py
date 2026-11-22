#!/usr/bin/env python3
"""news-generator.py - publisher RSS -> flat JSON headline arrays, plus a small
info.json (gold, silver, weather) for the KJ news ticker card.
Outputs (in this file's folder, usually /config/www/):
  news_en.json  ["Headline", ...]
  news_ta.json  ["Headline", ...]
  info.json     {"location":"Bangalore","items":{"gold24":"...","silver":"...","weather":"..."}}
Standard library only. Atomic writes, 0644, keep-last-good on failure.
"""
import json, sys, os, tempfile, urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime

# ---------------------------------------------------------------- config
FEEDS = {
    "news_en.json": "https://timesofindia.indiatimes.com/rssfeedstopstories.cms",
    "news_ta.json": "https://feeds.bbci.co.uk/tamil/rss.xml",
}
LOCATION  = "Bangalore"     # drives weather + the place label shown on the card
MAX_ITEMS = 15
STRIP_SOURCE = True
UA  = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"
OUT_DIR = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(OUT_DIR, "news-generator.log")

GRAMS_PER_OZT = 31.1034768   # troy ounce -> gram

# ---------------------------------------------------------------- helpers
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

def fetch_json(url):
    return json.loads(fetch(url).decode("utf-8", "replace"))

def write_atomic(path, data_str):
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(data_str)
        os.replace(tmp, path)
        os.chmod(path, 0o644)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise

def inr(value):
    return "₹" + format(int(round(value)), ",")   # ₹7,845

# ---------------------------------------------------------------- headlines
def parse_feed(xml_bytes):
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

# ---------------------------------------------------------------- info: metals
def parse_metals(doc):
    """goldprice.org dbXRates/INR -> {'gold24','gold22','silver'} (per gram)."""
    item = doc["items"][0]
    xau = float(item["xauPrice"])   # gold INR / troy oz
    xag = float(item["xagPrice"])   # silver INR / troy oz
    g24 = xau / GRAMS_PER_OZT
    return {
        "gold24": inr(g24) + "/g",
        "gold22": inr(g24 * 22.0 / 24.0) + "/g",
        "silver": inr(xag / GRAMS_PER_OZT) + "/g",
    }

def get_metals():
    try:
        doc = fetch_json("https://data-asg.goldprice.org/dbXRates/INR")
        return parse_metals(doc)
    except Exception as e:
        log("WARN metals: " + str(e))
        return {}

# ---------------------------------------------------------------- info: weather
WMO = {
    0: "Clear ☀", 1: "Clear ☀", 2: "Partly ⛅", 3: "Cloudy ☁",
    45: "Fog \U0001f32b", 48: "Fog \U0001f32b",
    51: "Drizzle \U0001f326", 53: "Drizzle \U0001f326", 55: "Drizzle \U0001f326",
    61: "Rain \U0001f327", 63: "Rain \U0001f327", 65: "Rain \U0001f327",
    66: "Rain \U0001f327", 67: "Rain \U0001f327",
    71: "Snow \U0001f328", 73: "Snow \U0001f328", 75: "Snow \U0001f328", 77: "Snow \U0001f328",
    80: "Showers \U0001f326", 81: "Showers \U0001f326", 82: "Showers \U0001f326",
    95: "Storm ⛈", 96: "Storm ⛈", 99: "Storm ⛈",
}

def geocode(name):
    doc = fetch_json("https://geocoding-api.open-meteo.com/v1/search?count=1&name="
                     + urllib.request.quote(name))
    r = doc["results"][0]
    return float(r["latitude"]), float(r["longitude"])

def parse_weather(doc):
    cur = doc["current"]
    t = round(float(cur["temperature_2m"]))
    code = int(cur.get("weather_code", 0))
    desc = WMO.get(code, "")
    emoji = desc.split(" ")[-1] if desc else ""
    return str(t) + "°C " + emoji

def get_weather(location):
    try:
        lat, lon = geocode(location)
        doc = fetch_json(
            "https://api.open-meteo.com/v1/forecast?current=temperature_2m,weather_code"
            "&latitude=" + str(lat) + "&longitude=" + str(lon))
        return parse_weather(doc).strip()
    except Exception as e:
        log("WARN weather: " + str(e))
        return ""

# ---------------------------------------------------------------- info build
def build_info():
    items = {}
    items.update(get_metals())
    w = get_weather(LOCATION)
    if w:
        items["weather"] = w
    if not items:
        raise ValueError("no info fetched - keeping existing file")
    payload = {
        "location": LOCATION,
        "updated": datetime.now().astimezone().isoformat(timespec="seconds"),
        "items": items,
    }
    return payload

# ---------------------------------------------------------------- main
def main():
    failures = 0
    for fname, url in FEEDS.items():
        path = os.path.join(OUT_DIR, fname)
        try:
            titles = parse_feed(fetch(url))
            if not titles:
                raise ValueError("0 headlines parsed - keeping existing file")
            write_atomic(path, json.dumps(titles, ensure_ascii=False))
            log("OK   " + fname + ": " + str(len(titles)) + " headlines")
        except Exception as e:
            failures += 1
            log("FAIL " + fname + ": " + str(e) + "  (kept previous file)")
    try:
        payload = build_info()
        write_atomic(os.path.join(OUT_DIR, "info.json"),
                     json.dumps(payload, ensure_ascii=False))
        log("OK   info.json: " + ", ".join(sorted(payload["items"].keys())))
    except Exception as e:
        failures += 1
        log("FAIL info.json: " + str(e) + "  (kept previous file)")
    sys.exit(1 if failures else 0)

if __name__ == "__main__":
    main()
