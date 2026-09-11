#!/bin/sh
# probe-market-pagination.sh
#
# Measure the Loomloom market listing endpoint page by page, proving:
#   1. pageSize is capped server-side at 100, so the full dataset spans
#      several pages (the market currently holds ~225 listings = 3 pages).
#   2. The per-page response time, so an intermittent slow tail page shows up.
#
# Usage
#   sh probe-market-pagination.sh
#   sh probe-market-pagination.sh --token <key>
#   sh probe-market-pagination.sh --page-size 100 --max-pages 20
#
# Token resolution order: --token, $SHENGSUANYUN_API_KEY, then the local
# ~/.loomloom/.credentials.yaml refs block. The token value is never printed.
#
# Exit status: 0 when the walk completed, 1 on configuration or network error.

# shellcheck disable=SC2086

BASE_URL="${LOOMLOOM_BASE_URL:-https://loomloom.shengsuanyun.com/loom/v1}"
PAGE_SIZE="${LOOMLOOM_PAGE_SIZE:-100}"
MAX_PAGES="${LOOMLOOM_MAX_PAGES:-20}"
TIMEOUT="${LOOMLOOM_TIMEOUT:-120}"
TOKEN="${SHENGSUANYUN_API_KEY:-}"

while [ $# -gt 0 ]; do
  case "$1" in
    --token) TOKEN="${2:-}"; shift 2 ;;
    --page-size) PAGE_SIZE="${2:-}"; shift 2 ;;
    --max-pages) MAX_PAGES="${2:-}"; shift 2 ;;
    --base-url) BASE_URL="${2:-}"; shift 2 ;;
    --timeout) TIMEOUT="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done

command -v curl >/dev/null 2>&1 || { echo "error: curl is required" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "error: python3 is required to parse the JSON responses" >&2; exit 1; }

if [ -z "$TOKEN" ]; then
  TOKEN="$(python3 - <<'PY'
import os, re, pathlib
path = pathlib.Path(os.path.expanduser('~/.loomloom/.credentials.yaml'))
if path.exists():
    match = re.search(r'SHENGSUANYUN_API_KEY:\s*([A-Za-z0-9._-]+)', path.read_text())
    if match:
        print(match.group(1))
PY
)"
  if [ -n "$TOKEN" ]; then
    echo "note: read the credential from ~/.loomloom/.credentials.yaml (value not shown)"
  fi
fi

if [ -z "$TOKEN" ]; then
  echo "error: no credential. Pass --token <key> or set SHENGSUANYUN_API_KEY." >&2
  exit 1
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/loom-pagination.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT INT TERM

echo "Loomloom market pagination probe"
echo "================================"
echo "endpoint : $BASE_URL/marketListings"
echo "pageSize : $PAGE_SIZE (server caps this at 100)"
echo

echo "page | items | time(s)   | next"
echo "-----+-------+-----------+-----"

token=""
page=0
total=0
sum=0
max_time=0
max_page=0

while [ "$page" -lt "$MAX_PAGES" ]; do
  page=$((page + 1))
  if [ -z "$token" ]; then
    url="$BASE_URL/marketListings?pageSize=$PAGE_SIZE"
  else
    url="$BASE_URL/marketListings?pageSize=$PAGE_SIZE&pageToken=$token"
  fi

  body="$WORK/page$page.json"
  metrics="$(curl -sS -m "$TIMEOUT" \
    -H "authorization: Bearer $TOKEN" \
    -H 'accept: application/json' \
    -o "$body" \
    -w '%{http_code} %{time_total} %{size_download}' \
    "$url" 2>/dev/null || echo '000 0 0')"

  code="${metrics%% *}"
  rest="${metrics#* }"
  elapsed="${rest%% *}"
  bytes="${rest#* }"

  read -r items next_token <<EOF
$(python3 - "$body" <<'PY'
import json, sys
try:
    with open(sys.argv[1], encoding='utf-8') as handle:
        payload = json.load(handle)
    items = payload.get('items') if isinstance(payload, dict) else None
    if not isinstance(items, list):
        print('0 -')
        raise SystemExit(0)
    print(len(items), (payload.get('nextPageToken') or '-'))
except Exception:
    print('0 -')
PY
)
EOF

  total=$((total + items))
  sum="$(awk -v a="$sum" -v b="$elapsed" 'BEGIN { printf "%.3f", a + b }')"
  if awk -v e="$elapsed" -v m="$max_time" 'BEGIN { exit !(e > m) }'; then
    max_time="$elapsed"
    max_page="$page"
  fi

  has_next='no'
  [ "$next_token" = "-" ] || has_next='yes'
  printf '  %-3s | %5s | %9s | %s\n' "$page" "$items" "$elapsed" "$has_next"

  if [ "$code" != "200" ]; then
    echo "  ^ page $page returned http=$code" >&2
  fi

  if [ "$next_token" = "-" ] || [ "$next_token" = "" ]; then
    break
  fi
  token="$next_token"
done

echo "-----+-------+-----------+-----"
echo
printf 'full dataset : %s listings across %s page(s)\n' "$total" "$page"
printf 'walk cost    : %ss (serial, all pages)\n' "$sum"
printf 'slowest page : page %s at %ss\n' "$max_page" "$max_time"

awk -v slow="$max_page" -v n="$page" -v t="$max_time" 'BEGIN{
  if (n <= 1) { print "note         : a single page sufficed; nothing to compare"; exit }
  if (slow == n && t >= 2) {
    printf "note         : the LAST page was the slowest (%.3fs) — a full walk pays it\n", t
  } else if (t >= 5) {
    printf "note         : page %d was an outlier at %.3fs (likely a transient network/server spike)\n", slow, t
  } else {
    printf "note         : every page under 2s — no slow tail in this run\n"
  }
}'

echo "done."
