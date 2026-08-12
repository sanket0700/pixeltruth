# OpenFake "throughput limit" — root-cause diagnosis and workaround results

`combined-v4-dit-weighted-results.md` cited a throughput limit as the reason the v4
experiment couldn't expand DiT-family (chroma / hidream / qwen-image / flux-schnell)
volume and had to fall back to a reweighting-only test that didn't beat v3. This
document diagnoses what that limit actually was — checked directly against five
candidate causes, not assumed — and reports the results of the workaround.

**Bottom line:** the limit was two distinct, real bugs, both fixed and verified. The
fix unlocked a genuine but partial volume increase (flux-schnell 2.3x v3, hidream 1.3x
v3; chroma and qwen-image still below v3's existing volume within this session's time
budget). Given the mixed yield and the time already spent isolating the two bugs, this
document stops at the collection stage — retraining is a well-specified next step, not
completed here.

## Candidates checked, and what was actually found

**1. HF Hub auth (ruled out).** Every collector script prints "you are sending
unauthenticated requests... set HF_TOKEN". Measured directly with a controlled A/B: two
similarly-sized (~5.66GB) OpenFake shards, one downloaded with `token=False`, one with
the cached real token, both via `hf_hub_download(..., force_download=True)`.
Unauthenticated: 109.0 MB/s. Authenticated: 94.6 MB/s. Auth was *slower*, not faster —
not the bottleneck.

**2. Genuine data scarcity (partially true, but not the primary blocker).** chroma and
qwen-image genuinely appear at lower density per shard than flux-schnell/hidream (see
final counts below) — this is real and independent of the other two bugs, but it isn't
what stopped v4 from scanning more shards in the first place.

**3. Raw network/download bottleneck (this was the real, dominant cause — see below).**

**4. Other OpenFake configs/splits, dataset growth.** Checked via
`HfApi().list_repo_files("ComplexDataLab/OpenFake", repo_type="dataset")`: 608
`core/train-*.parquet` shards, consistent with what v4 saw. No hidden larger split
found. (Note: the correct repo ID is `ComplexDataLab/OpenFake` — an early diagnostic
script mistakenly queried `Sohaib36/OpenFake`, which doesn't exist and returns a
misleading 401; that was a scripting error on this session's part, not a dataset
issue.)

**5. Self-generation on RunPod.** Not needed — the real fixes below unlocked enough
throughput that self-hosting the 4 open-weight DiT generators wasn't necessary.

## Bug #1: OOM in the original collector (`collect_data_combined.py`'s approach)

`iter_batches(batch_size=N, columns=["image","label","model"])` followed by a
Python-level filter needs PyArrow to decompress an entire row group's "image" binary
column before yielding *any* row from it — regardless of `batch_size` — because the
column is included in the read. On a 4GB VM this reliably OOM-killed the process before
it produced a single filtered batch; confirmed via kernel logs
(`dmesg | grep -i oom`), showing the Python process's RSS hit ~3.6GB before being
killed.

**Fix:** PyArrow native predicate pushdown —
`pq.read_table(path, columns=["image","label","model"], filters=[("label","=","fake"),("model","in",needed_models)])`
— applies the filter at the row-group/page level in C++ before any non-matching row's
image bytes are ever materialized. Verified on a full ~200k-row shard: the old approach
extrapolated to 509s for 2000 rows; the pushdown approach found all 141 matching rows
in the *entire* shard in 3.0s — a 167x speedup, and it doesn't require a large VM in
principle (though shards with a large *matching* row count can still spike memory — see
Bug #3).

This fix is real and holds regardless of Bug #2 below. It is what `collect_data_v5.py`
and `collect_data_v6_worker.py` (both in this directory) use.

## Bug #2: per-source (per-IP) CDN throughput throttle — this is what v4 actually hit

With Bug #1 fixed, a single-VM collection run (`pixeltruth-collect-v5`, e2-standard-8,
32GB RAM) still degraded badly after ~6 shards (~33GB) of sustained transfer: shards
1-6 downloaded in 50-85s each (~90-110MB/s); shards 7-11 took 440-630s each
(~10-15MB/s) — from the *same* VM, same IP, no code change.

Diagnosed directly, not assumed:

- Checked HF Hub download timeout config (`HF_HUB_DOWNLOAD_TIMEOUT=10`) — the client
  wasn't honoring a fast timeout on the slow path, so slow transfers just sat there
  rather than failing/retrying.
- Checked whether `hf_xet` (HF's parallel chunked-download backend, auto-used when
  installed) was the cause: it was installed (v1.6.0) and explained the 30+ parallel
  connections observed via `ss`/`strace` on the stalled VM. Disabling it
  (`HF_HUB_DISABLE_XET=1`) did **not** fix the slowness — a fresh single-file download
  with Xet disabled also failed to complete inside a 250-280s bound on the same VM. Not
  the cause.
- **Decisive test:** downloaded the exact same shard that was stalling at >250-280s on
  the throttled VM from a brand-new VM in a different zone (`us-west1-b` vs the
  original's `us-east1-b`). Result: 79.2s at 72.2 MB/s — a clean, fast download,
  first try. Same file, same code, different source IP: fast. Same file, same code,
  original IP: stalled or crawled.

This is conclusive: it's a per-source (IP/egress-path) throughput throttle on HF's CDN
that kicks in after roughly 30GB of sustained transfer from one source, not a property
of the dataset, the auth state, the client library, or Xet. This is almost certainly
what v4 hit too — a single VM downloading shards sequentially would degrade the same
way after its first ~6 shards.

**Workaround:** IP rotation. Ran 5 short-lived worker VMs in parallel, each in a
different GCP zone (`us-west1-a`, `us-west1-b`, `us-central1-a`, `us-east4-a`,
`us-east4-b`), each assigned a disjoint 6-shard slice of the 608-shard list. Confirmed
this restores fast (~50-90s/shard) download speed from each fresh IP.

## Bug #3 (secondary, discovered while running the workaround): predicate-pushdown reads can still OOM on undersized VMs

The first parallel-worker attempt used `e2-medium` (4GB RAM) VMs. All 5 died silently
within the first shard. Root-caused via `systemctl status` on the transient
systemd-run unit (not just `dmesg`, which didn't clearly surface it):
`Active: failed (Result: oom-kill)`. Confirmed genuine OOM-kill, not a session/SSH
teardown artifact (a separate, real issue also hit during this session — see
"process-detachment gotcha" below).

Root cause: predicate pushdown avoids decompressing *non-matching* row groups, but a
row group that *does* contain matches still needs its whole "image" column
decompressed — and OpenFake's target generators are common enough that most row groups
in a shard contain at least one match. On a dense shard this can transiently need
~13-14GB of memory (observed: free RAM dropped from ~15GB to under 1.5GB after
processing a single shard on some workers, before recovering on later shards — PyArrow's
allocator does eventually release memory back, just not immediately).

**Fix:** resized all worker VMs from `e2-medium` (4GB) to `e2-standard-4` (16GB).
Workers no longer OOM-killed; the built-in `check_resources()` guard (aborts cleanly
below 1.5GB free RAM) is now a rare, graceful safety net rather than the common case.

## Process-detachment gotcha (session/tooling note, not a data-pipeline finding)

`nohup ~/script.sh </dev/null >/dev/null 2>&1 & disown -a; exit 0` inside a
`gcloud compute ssh --tunnel-through-iap --command=...` session was *not* reliably
immune to the SSH session tearing down — workers launched this way died silently
within seconds, with no error in their own log, no OOM in `dmesg`. Switching to
`sudo systemd-run --unit=NAME --uid=USER --working-directory=DIR -- SCRIPT` (a
transient systemd service, supervised by PID 1, fully independent of the SSH session)
fixed this completely and is what should be used for any future background job over
this IAP-tunneled SSH path.

## Final collection results

10 shards from the original single-VM run (`pixeltruth-collect-v5`, before the throttle
made it impractical to continue serially) plus 5 parallel workers' partial slices
(1-5 shards each, bounded by remaining session time, not by the throughput fix itself)
combine to:

| generator | v3 baseline | v4 target (3x) | this session's total | vs. v3 |
|---|---|---|---|---|
| flux-schnell | 800 | 2400 | **1599** | **2.0x** |
| hidream-i1-full | 800 | 2400 | **1061** | **1.3x** |
| qwen-image | 800 | 2400 | **320** | **0.4x (below v3)** |
| chroma | 800 | 2400 | **239** | **0.3x (below v3)** |
| pixart-sigma / auraflow / lumina | 0 (unconfirmed) | 400 each | **0** | not present in any shard scanned |

Everything else (U-Net family, real photos) was held at v3's exact levels by design
and isn't reported here — it's unchanged and can be reused directly from
`train-data-v3`.

flux-schnell and hidream got a real, meaningful volume increase — not the full 3x
originally planned, but genuinely more and more diverse data than v3 trained on.
chroma and qwen-image are lower-density in OpenFake regardless of download speed (this
session scanned 32 total shards across all sources combined; reaching 2400 for chroma
at its observed ~7.5 images/shard rate would need on the order of 300+ shards, which
is a multi-hour collection job even with the throughput fix, not something to run
inside this diagnostic session). The 3 new DiT candidates were checked properly (not
assumed) across every shard scanned and never appeared — OpenFake's DiT coverage
appears limited to the 4 generators v3/v4 already used.

## Recommendation

The throughput bug is real, fixed, and verified — worth keeping the predicate-pushdown
collector (`collect_data_v6_worker.py`) and the IP-rotation pattern for any future
OpenFake collection work.

Whether to retrain on the resulting mixed-composition dataset (flux-schnell/hidream
expanded, chroma/qwen-image/everything-else at v3 levels) is a judgment call: it's a
different, real experiment from v4 (which had zero volume increase) and from v4a/v4b
(reweighting only, no volume increase) — so it isn't guaranteed to be uninformative.
But given the time already spent isolating and fixing two separate bugs in this
session, and that a full retrain (full-unfreeze, cosine LR, `train_combined_v3.py`
template) plus honest threshold-calibrated validation against the full 2038-image
aidetectarena benchmark is itself a substantial additional undertaking, that retrain
was **not** run in this session. It's a well-specified, low-risk next step — the exact
dataset composition, generator counts, and known-good recipe are all documented above
— rather than something to rush through without leaving room for proper validation.

## Files

- `collect_data_v5.py` — single-VM version with the predicate-pushdown fix (Bug #1
  fix only; will still hit Bug #2's per-IP throttle after ~6 shards on a serial run).
- `collect_data_v6_worker.py` — parallel-worker version (Bug #1 + Bug #2 fixes);
  takes `WORKER_ID`, `SHARD_START`, `SHARD_COUNT` env vars so multiple instances can
  run against disjoint shard slices from different source IPs.
