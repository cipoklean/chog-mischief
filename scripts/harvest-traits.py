#!/usr/bin/env python3
"""
Harvest Chog Genesis trait metadata (1,969 tokens) and emit a trait report.

WHY THIS EXISTS
---------------
The collection's `tokenURI` points at IPFS (`ipfs://bafybei.../<id>.json`), but
every public IPFS gateway reachable from this VM either:
  * returns 403 behind a Cloudflare bot challenge (ipfs.io, dweb.link, w3s.link,
    nftstorage.link), or
  * cannot retrieve this particular content (filebase.io returns 504, pinata
    times out, 4everland times out).

So the IPFS route is NOT usable for seeding from here. The working source is the
server-rendered JSON that OpenSea embeds in each asset page, which contains the
same `attributes` array the IPFS document would. That is what this script reads.

It ALSO reads `tokenURI` from chain (batched) and records the CID per token, so
the moment IPFS is reachable the metadata can be re-fetched from origin without
re-enumerating the collection.

Outputs:
  data/cache/chogs.json      full per-token trait cache (also the DB seed input)
  data/cache/trait-report.md human-readable trait report
  data/cache/token-uris.json tokenId -> ipfs uri, for a later origin-side fetch

Usage:  python3 scripts/harvest-traits.py [--concurrency N] [--limit N]
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

CONTRACT = "0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763"
TOTAL_SUPPLY = 1969  # verified on-chain: totalSupply() == 0x7b1
OPENSEA = f"https://opensea.io/assets/monad/{CONTRACT}/{{}}"
RPC_FALLBACKS = [
    "https://rpc.monad.xyz",
    "https://rpc1.monad.xyz",
    "https://rpc3.monad.xyz",
]
UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "cache"

# Trait categories that gate gameplay. Anything else is cosmetic for now.
POWER_CATEGORIES = ["Tier", "Aura", "Eyes", "Mouth", "Head", "Accessory"]

ATTR_RE = re.compile(r'"traitType":"([^"]+)","value":"([^"]*)"')

# The per-asset name lives in skeletonHints.name, NOT in the top-level "name"
# field. OpenSea's top-level name is a collection-wide default: every asset page
# in this collection renders it as "CHOG #1462" (token 1462's name) no matter
# which token the page is about, which is how the first harvest ended up
# labelling all 1,959 named Chogs with the wrong id. skeletonHints sits next to
# "collectionSlug" and the real tokenId, so it is the authoritative block.
# Verified: #561 -> "CHOG #53 - Blaze", #900 -> "CHOG #392 - Burning Skully".
#
# The payload appears TWICE in the HTML: once JSON-escaped (\"name\") and once
# plain. The leading \\? makes the pattern match either form, so this does not
# silently return nothing if OpenSea changes which copy it emits first.
NAME_RE = re.compile(r'\\?"collectionSlug\\?":\\?"[^"\\]*\\?",\\?"name\\?":\\?"([^"\\]*)\\?"')
# OpenSea proxies collection art on its own CDN, which is NOT Cloudflare-gated
# (unlike the public IPFS gateways). Verified 200 image/webp from this VM.
IMAGE_RE = re.compile(
    r'(https://i2c\.seadn\.io/monad/' + re.escape(CONTRACT) + r'/[^"\\\s]+)'
)


def _get(url: str, timeout: int = 30, retries: int = 3) -> str:
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf8", "replace")
        except Exception as exc:  # noqa: BLE001 - want the type, not a guess
            last = exc
            time.sleep(0.6 * (attempt + 1) + random.random() * 0.4)
    raise last  # type: ignore[misc]


def fetch_attributes(token_id: int) -> dict | None:
    """Return {traitType: value} for one token, or None if the page had none."""
    try:
        body = _get(OPENSEA.format(token_id))
    except Exception:
        return None
    i = body.find('"attributes":[{"traitType"')
    if i < 0:
        return None
    segment = body[i : i + 4000]
    pairs = ATTR_RE.findall(segment)
    if not pairs:
        return None
    attrs: dict[str, str] = {}
    for k, v in pairs:
        # First occurrence wins: the page repeats the same block escaped.
        attrs.setdefault(k, v)
    img = IMAGE_RE.search(body)
    name = NAME_RE.search(body)
    if img:
        attrs["__image_url"] = img.group(1).replace("\\u0026", "&")
    if name:
        attrs["__name"] = name.group(1)
    return attrs


def decode_abi_string(hex_result: str) -> str:
    """Decode a single dynamic string from an eth_call return blob."""
    raw = bytes.fromhex(hex_result[2:])
    length = int.from_bytes(raw[32:64], "big")
    return raw[64 : 64 + length].decode("utf8", "replace")


def fetch_token_uris(start: int, end: int) -> dict[int, str]:
    """Read tokenURI for a token-id range, batching JSON-RPC calls.

    Each batch is retried against every RPC in turn. A single dropped HTTP
    request silently costs exactly one batch's worth of token ids (a clean
    contiguous run of 25), so a "one pass" loop returns a quietly incomplete
    cache - the failure looks like an on-chain gap, not a network blip.
    """
    out: dict[int, str] = {}
    ids = list(range(start, end + 1))

    def fetch_batch(rpc: str, batch: list[int]) -> dict[int, str]:
        payload = [
            {
                "jsonrpc": "2.0",
                "id": n,
                "method": "eth_call",
                "params": [{"to": CONTRACT, "data": "0xc87b56dd" + f"{t:064x}"}, "latest"],
            }
            for n, t in enumerate(batch)
        ]
        req = urllib.request.Request(
            rpc,
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json", "User-Agent": UA},
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.loads(r.read())
        except Exception:
            return {}
        if not isinstance(data, list):
            return {}
        by_id = {d.get("id"): d for d in data if isinstance(d, dict)}
        got: dict[int, str] = {}
        for n, t in enumerate(batch):
            hexres = (by_id.get(n) or {}).get("result")
            # Do NOT gate on a magic length: URIs vary with the CID and the path
            # length, and a length guard silently drops real values. Accept any
            # decodable result that looks like an IPFS URI.
            if isinstance(hexres, str) and hexres.startswith("0x") and len(hexres) >= 2 + 64 * 2:
                try:
                    decoded = decode_abi_string(hexres)
                except Exception:
                    continue
                if decoded.startswith("ipfs://"):
                    got[t] = decoded
        return got

    for i in range(0, len(ids), 25):
        batch = ids[i : i + 25]
        for attempt in range(3):
            for rpc in RPC_FALLBACKS:
                out.update(fetch_batch(rpc, batch))
                if all(t in out for t in batch):
                    break
            if all(t in out for t in batch):
                break
            time.sleep(0.8 * (attempt + 1))
        still_missing = [t for t in batch if t not in out]
        if still_missing:
            print(f"  WARN batch {batch[0]}-{batch[-1]}: {len(still_missing)} unresolved", flush=True)
        time.sleep(0.12)  # be a good citizen on public RPCs
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--concurrency", type=int, default=6)
    ap.add_argument("--limit", type=int, default=TOTAL_SUPPLY)
    ap.add_argument("--skip-uris", action="store_true")
    args = ap.parse_args()

    CACHE.mkdir(parents=True, exist_ok=True)
    ids = list(range(1, min(args.limit, TOTAL_SUPPLY) + 1))
    print(f"harvesting {len(ids)} tokens @ concurrency={args.concurrency}", flush=True)

    chogs: dict[str, dict] = {}
    t0 = time.time()
    done = 0

    with cf.ThreadPoolExecutor(max_workers=args.concurrency) as ex:
        futures = {ex.submit(fetch_attributes, t): t for t in ids}
        for fut in cf.as_completed(futures):
            tid = futures[fut]
            done += 1
            try:
                attrs = fut.result()
            except Exception:
                attrs = None
            if attrs:
                record: dict = {"token_id": tid, "attributes": {}}
                # Reserved __ keys are promoted to real columns, never left in
                # the trait bag - the trait bag must contain ONLY game traits so
                # the counts and the powers table cannot see a stray key.
                for reserved, field in (("__image_url", "image_url"), ("__name", "name")):
                    if reserved in attrs:
                        record[field] = attrs.pop(reserved)
                record["attributes"] = attrs
                chogs[str(tid)] = record
            if done % 50 == 0 or done == len(ids):
                rate = done / max(time.time() - t0, 0.001)
                eta = (len(ids) - done) / max(rate, 0.001)
                print(
                    f"  {done}/{len(ids)} ok={len(chogs)} {rate:.1f}/s eta={eta/60:.1f}m",
                    flush=True,
                )

    (CACHE / "chogs.json").write_text(json.dumps(chogs, indent=1, sort_keys=True))
    print(f"wrote {CACHE/'chogs.json'} ({len(chogs)} tokens)", flush=True)

    if not args.skip_uris:
        print("reading tokenURI from chain...", flush=True)
        uris = fetch_token_uris(1, min(args.limit, TOTAL_SUPPLY))
        (CACHE / "token-uris.json").write_text(
            json.dumps({str(k): v for k, v in uris.items()}, indent=1, sort_keys=True)
        )
        print(f"wrote {CACHE/'token-uris.json'} ({len(uris)} uris)", flush=True)

    write_report(chogs)
    return 0


def write_report(chogs: dict) -> None:
    counts: dict[str, Counter] = defaultdict(Counter)
    with_image = 0
    for c in chogs.values():
        for k, v in c["attributes"].items():
            if k.startswith("__"):
                continue
            counts[k][v] += 1
        if "image_url" in c:
            with_image += 1

    total = len(chogs)
    lines: list[str] = []
    lines.append("# Chog Genesis - trait report")
    lines.append("")
    lines.append(f"- tokens harvested: **{total}** / {TOTAL_SUPPLY}")
    lines.append(f"- contract: `{CONTRACT}` (Monad mainnet, chain 143)")
    lines.append(f"- source: OpenSea SSR `attributes` payload (IPFS gateways unreachable from this VM)")
    lines.append(f"- trait categories found: **{len(counts)}**")
    lines.append(f"- tokens with a resolved image URL: **{with_image} / {total}**")
    lines.append("")
    lines.append("## Trait categories by rarity of presence")
    lines.append("")
    lines.append("| Category | distinct values | present on | share |")
    lines.append("|---|---|---|---|")
    for cat in sorted(counts, key=lambda c: (c not in POWER_CATEGORIES, -len(counts[c]), c)):
        distinct = len(counts[cat])
        present = sum(counts[cat].values())
        share = 100.0 * present / total if total else 0
        star = " ⭐" if cat in POWER_CATEGORIES else ""
        lines.append(f"| {cat}{star} | {distinct} | {present} | {share:.1f}% |")

    lines.append("")
    lines.append("⭐ = category that gates gameplay (see `src/game/powers.ts`).")
    lines.append("")
    lines.append("## Full value breakdown")
    for cat in sorted(counts, key=lambda c: (-sum(counts[c].values()), c)):
        lines.append("")
        lines.append(f"### {cat} ({len(counts[cat])} values)")
        lines.append("")
        lines.append("| value | count | share |")
        lines.append("|---|---|---|")
        for val, n in counts[cat].most_common():
            share = 100.0 * n / total if total else 0
            lines.append(f"| {val} | {n} | {share:.2f}% |")

    lines.append("")
    lines.append("## Notes for the powers mapping")
    lines.append("")
    for cat in POWER_CATEGORIES:
        if cat not in counts:
            lines.append(f"- **{cat}**: absent from all harvested tokens - cannot gate gameplay on it.")
            continue
        n_present = sum(counts[cat].values())
        rare = counts[cat].most_common()[-3:]
        lines.append(
            f"- **{cat}**: on {n_present}/{total} tokens, {len(counts[cat])} values; "
            f"rarest: {', '.join(f'{v} ({c})' for v, c in rare)}"
        )

    (CACHE / "trait-report.md").write_text("\n".join(lines) + "\n")
    print(f"wrote {CACHE/'trait-report.md'}", flush=True)

    # Console summary, so the run is legible without opening the file.
    print("\n=== CATEGORY SUMMARY ===", flush=True)
    for cat in sorted(counts, key=lambda c: (c not in POWER_CATEGORIES, c)):
        present = sum(counts[cat].values())
        print(
            f"{cat:<12} values={len(counts[cat]):>3}  present={present:>4}/{total}"
            f"  ({100.0*present/total if total else 0:>5.1f}%)",
            flush=True,
        )


if __name__ == "__main__":
    sys.exit(main())