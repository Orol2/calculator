# Instagram Video Downloader

Run locally:

python -m venv venv
. venv/bin/activate
pip install -r ig-downloader/requirements.txt
uvicorn ig-downloader.main:app --reload --port 8000

Example:
GET /download?url=https://www.instagram.com/p/<shortcode>/

For carousels call /download without index to list available media, then call with &index=N to download.
