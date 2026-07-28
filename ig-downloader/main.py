#!/usr/bin/env python3
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import StreamingResponse, JSONResponse
import requests
import re
import json
from typing import Optional
from urllib.parse import urlparse

app = FastAPI(title="Instagram Video Downloader", version="1.0")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
                  " Chrome/120.0.0.0 Safari/537.36"
}


def extract_shortcode(url: str) -> str:
    path = urlparse(url).path.strip("/")
    parts = [p for p in path.split("/") if p]
    if len(parts) >= 2 and parts[0] in ("p", "tv", "reel"):
        return parts[1]
    if parts:
        return parts[-1]
    raise ValueError("Could not extract shortcode from URL")


def fetch_page(url: str) -> str:
    resp = requests.get(url, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    return resp.text


def unescape_js_string(s: str) -> str:
    try:
        return s.encode("utf-8").decode("unicode_escape")
    except Exception:
        return s.replace("\\u0026", "&")


def parse_video_nodes_from_shareddata(shared_json: dict):
    nodes = []
    try:
        media = shared_json["entry_data"]["PostPage"][0]["graphql"]["shortcode_media"]
    except Exception:
        return nodes

    def node_to_dict(node):
        n = {
            "is_video": node.get("is_video", False),
            "video_url": node.get("video_url"),
            "display_url": node.get("display_url"),
            "type": node.get("__typename") or ("Video" if node.get("is_video") else "Image")
        }
        return n

    if "edge_sidecar_to_children" in media:
        for edge in media["edge_sidecar_to_children"].get("edges", []):
            node = edge.get("node", {})
            nodes.append(node_to_dict(node))
        return nodes

    nodes.append(node_to_dict(media))
    return nodes


def find_video_urls(html: str):
    m = re.search(r'<meta[^>]+property=["\']og:video["\'][^>]+content=["\']([^"\']+)["\']', html)
    if m:
        return [{"is_video": True, "video_url": unescape_js_string(m.group(1)), "type": "Video"}]

    m = re.search(r'<meta[^>]+property=["\']og:video:secure_url["\'][^>]+content=["\']([^"\']+)["\']', html)
    if m:
        return [{"is_video": True, "video_url": unescape_js_string(m.group(1)), "type": "Video"}]

    m = re.search(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', html, re.S | re.I)
    if m:
        try:
            data = json.loads(m.group(1).strip())
            if isinstance(data, dict) and data.get("contentUrl"):
                return [{"is_video": True, "video_url": unescape_js_string(data["contentUrl"]), "type": "Video"}]
        except Exception:
            pass

    m = re.search(r'window\._sharedData\s*=\s*({.*?});\s*</script>', html, re.S)
    if m:
        try:
            shared = json.loads(m.group(1))
            nodes = parse_video_nodes_from_shareddata(shared)
            for n in nodes:
                if n.get("video_url"):
                    n["video_url"] = unescape_js_string(n["video_url"])
            if nodes:
                return nodes
        except Exception:
            pass

    m = re.findall(r'"video_url"\s*:\s*"([^"]+\.mp4[^"]*)"', html)
    if m:
        nodes = [{"is_video": True, "video_url": unescape_js_string(u), "type": "Video"} for u in m]
        return nodes

    m = re.findall(r'"display_url"\s*:\s*"([^"]+)"', html)
    if m:
        nodes = [{"is_video": False, "display_url": unescape_js_string(u), "type": "Image"} for u in m]
        return nodes

    return []


def stream_from_url(url: str, filename: str = "video.mp4"):
    resp = requests.get(url, headers=HEADERS, stream=True, timeout=30)
    resp.raise_for_status()
    content_type = resp.headers.get("content-type", "application/octet-stream")

    def iter_bytes():
        for chunk in resp.iter_content(chunk_size=8192):
            if chunk:
                yield chunk

    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"'
    }
    return StreamingResponse(iter_bytes(), media_type=content_type, headers=headers)


@app.get("/")
def root():
    return {"status": "ok"}


@app.get("/download")
def download(url: str = Query(..., description="Public Instagram post URL"), index: Optional[int] = Query(None, description="Index for carousel (0-based)")):
    try:
        html = fetch_page(url)
    except requests.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Error fetching Instagram page: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    nodes = find_video_urls(html)
    if not nodes:
        raise HTTPException(status_code=404, detail="Could not find media/video URLs on the page. It may be private or removed.")

    if len(nodes) > 1 and index is None:
        summary = [{"index": i, "is_video": n.get("is_video"), "type": n.get("type")} for i, n in enumerate(nodes)]
        return JSONResponse({"shortcode": extract_shortcode(url), "available": summary})

    idx = index if index is not None else 0
    if idx < 0 or idx >= len(nodes):
        raise HTTPException(status_code=400, detail=f"index out of range (0..{len(nodes)-1})")

    node = nodes[idx]
    if node.get("is_video"):
        video_url = node.get("video_url")
        if not video_url:
            raise HTTPException(status_code=404, detail="Video URL missing for selected node")
        shortcode = extract_shortcode(url)
        filename = f"{shortcode}"
        if len(nodes) > 1:
            filename += f"-{idx}"
        filename += ".mp4"
        try:
            return stream_from_url(video_url, filename=filename)
        except requests.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"Error streaming video file: {e}")
    else:
        img_url = node.get("display_url")
        if not img_url:
            raise HTTPException(status_code=404, detail="Image URL missing for selected node")
        shortcode = extract_shortcode(url)
        filename = f"{shortcode}"
        if len(nodes) > 1:
            filename += f"-{idx}"
        ext = ".jpg"
        m = re.search(r"\\.(jpg|jpeg|png|gif)(?:\?|$)", img_url, re.I)
        if m:
            ext = "." + m.group(1).lower()
        filename += ext
        try:
            return stream_from_url(img_url, filename=filename)
        except requests.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"Error streaming image file: {e}")
