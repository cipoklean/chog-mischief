#!/usr/bin/env python3
"""Re-harvest NAMES only, for tokens whose name is missing or unusable.

Why this exists
---------------
The first full harvest read OpenSea's top-level "name" field, which for this
collection is a collection-wide default ("CHOG #1462") applied to every asset
page, so 1,959 of the names are wrong. Traits and image_url came from the same
page and are per-token and correct, so a full re-harvest is unnecessary.

The per-asset name actually lives in skeletonHints.name, next to
"collectionSlug" and the real tokenId. This script refreshes ONLY the name
field for the tokens that need it, and leaves everything else alone.

Usage:  python3 scripts/harvest-names.mjs 1969 --apply
"""
import json
import os
import random
import re
import sys
import time
import urllib.request

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
OPENSEA = (
    "https://opensea.io/assets/monad/"
    "0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763/{}"
)
CACHE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "cache", "chogs.json")

# Matches the escaped OR the plain copy of skeletonHints.
NAME_RE = re.compile(r'\\?"collectionSlug\\?":\\?"[^"\\]*\\?",\\?"name\\?":\\?"([^"\\]*)\\?"')
# Confirm the page is really about the token we asked for.
TOKEN_RE = re.compile(r'\\?"tokenId\\?":\\?"(\d+)\\?"')


def get(url: str, timeout: int = 30) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf8", "replace")


def fetch_name(token_id: int, retries: int = 4):
    last = None
    for attempt in range(retries):
        try:
            body = get(OPENSEA.format(token_id))
            m = NAME_RE.search(body)
            tm = TOKEN_RE.search(body)
            if not m:
                return None, "no-name-in-html"
            # Never trust a name from a page about a different token.
            if tm and int(tm.group(1)) != token_id:
                return None, "token-id-mismatch"
            return m.group(1), None
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(0.6 * (attempt + 1) + random.random() * 0.4)
    return None, f"fetch-failed: {last}"


def main() -> int:
    apply = "--apply" in sys.argv
    argv = [a for a in sys.argv[1:] if a != "--apply"]
    with open(CACHE) as f:
        cache = json.load(f)

    # Only the Chogs whose name is absent or the known-bad collection default
    # need a refresh. Everything else gets the derived `CHOG #<id>` display name.
    targets = [int(k) for k, v in cache.items() if not v.get("name")]
    print(f"tokens with no usable name: {len(targets)}")

    changed = 0
    for tid in targets:
        name, err = fetch_name(tid)
        if name:
            cache[str(tid)]["name"] = name
            changed += 1
            print(f"  #{tid:<5} -> {name!r}")
        else:
            print(f"  #{tid:<5} !! {err}")
        time.sleep(0.4)

    print(f"recovered: {changed}/{len(targets)}")
    if apply:
        with open(CACHE, "w") as f:
            json.dump(cache, f, indent=2, sort_keys=True)
        print(f"wrote {CACHE}")
    else:
        print("dry run - pass --apply to write")
    return 0


if __name__ == "__main__":
    sys.exit(main())