"""Install the pinned public UI without touching wallets, DNS or business jobs."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import urllib.request

ORIGIN = "https://parley-staging.pages.dev"
ROOT = Path("/opt/parley-stats-publication")
STATE = Path("/var/lib/parley-stats-publication")
STAGE = Path("/opt/parley-interface-stage-20261128-r2")
PREVIOUS_SITE = ROOT / "site-before-ui-20261128-r2"


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def command(*args, check=True):
    return subprocess.run(args, check=check, capture_output=True, text=True, timeout=260)


def active(unit):
    return command("systemctl", "is-active", "--quiet", unit, check=False).returncode == 0


def download(url, limit=20 * 1024 * 1024):
    if url.startswith(ORIGIN + "/"):
        script = """
const [url, limit] = process.argv.slice(1);
const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(45000) });
if (response.status !== 200 || response.url !== url) throw Error("Unexpected public response");
const chunks = [];
let size = 0;
for await (const chunk of response.body) {
  size += chunk.byteLength;
  if (size > Number(limit)) throw Error("Public response too large");
  chunks.push(Buffer.from(chunk));
}
if (!size) throw Error("Empty public response");
process.stdout.write(Buffer.concat(chunks));
"""
        result = subprocess.run(
            ["/opt/parley-runtime/bin/node", "--input-type=module", "-e", script, url, str(limit)],
            check=True, capture_output=True, timeout=50)
        return result.stdout
    with urllib.request.urlopen(url, timeout=45) as response:
        assert response.status == 200 and response.geturl() == url
        raw = response.read(limit + 1)
        assert 0 < len(raw) <= limit
        return raw


def main():
    assert os.getuid() == 0
    assert len(sys.argv) == 4 and sys.argv[1] == "--install-authorized-ui"
    commit, expected = sys.argv[2:]
    assert re.fullmatch(r"[a-f0-9]{40}", commit)
    assert re.fullmatch(r"[a-f0-9]{64}", expected)
    assert not STAGE.exists(), "Exclusive staging directory required"
    base = "https://raw.githubusercontent.com/0xCaptain888/parley/" + commit + "/interface/"
    raw = download(base + "publication/release.json", 131072)
    assert sha(raw) == expected, "Release index mismatch"
    release = json.loads(raw)
    assert release["origin"] == ORIGIN and release["project"] == "parley-staging"
    assert release["contract"] == "0x374499188212a01e3614bc58afe7f71f03a3d22e"
    STAGE.mkdir(mode=0o700)
    (STAGE / "release.json").write_bytes(raw)
    staged = STAGE / "new"
    staged.mkdir()
    for name, digest in release["files"].items():
        assert re.fullmatch(r"[A-Za-z0-9_./-]+", name)
        assert not name.startswith("/") and all(p not in ["", ".", ".."] for p in name.split("/"))
        source = "publication/" + name if name in ["publisher.mjs", "formal-monitor.mjs"] else name
        data = download(base + source)
        assert sha(data) == digest, "Artifact mismatch: " + name
        file = staged / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(data)
        file.chmod(0o644)
    manifest = json.loads((staged / "site/release-manifest.json").read_bytes())
    for name, metadata in manifest["files"].items():
        assert sha((staged / "site" / name).read_bytes()) == metadata["sha256"]
    assert set(release["files"]) == {"publisher.mjs", "formal-monitor.mjs", "site/release-manifest.json"} | {
        "site/" + name for name in manifest["files"]}
    assert (staged / "site/config.json").read_bytes() == (ROOT / "site/config.json").read_bytes()
    for name in ["SKILL.md", "SHA256SUMS", "parley.mjs", "parley.zip"]:
        assert (staged / "site/skill" / name).read_bytes() == (ROOT / "site/skill" / name).read_bytes()
    for name, digest in release["previousRuntime"].items():
        assert sha((ROOT / name).read_bytes()) == digest, "Runtime drift: " + name
    timers = ["parley-stats-publication.timer", "parley-monitor.timer"]
    prior = {unit: active(unit) for unit in timers}
    for unit in timers:
        command("systemctl", "stop", unit)
    installed = False
    try:
        for _ in range(125):
            if not any(active(unit) for unit in ["parley-stats-publication.service", "parley-monitor.service"]):
                break
            time.sleep(2)
        assert not any(active(unit) for unit in ["parley-stats-publication.service", "parley-monitor.service"])
        assert not (STATE / "pending.json").exists(), "Unresolved publication; do not overwrite"
        assert not (STATE / "publisher.lock").exists(), "Publisher still owns state"
        backup = STAGE / "previous"
        backup.mkdir()
        for name in ["publisher.mjs", "formal-monitor.mjs", "site"]:
            source = ROOT / name
            assert not source.is_symlink()
            if source.is_dir():
                shutil.copytree(source, backup / name)
            else:
                shutil.copy2(source, backup / name)
        for name in ["publisher.mjs", "formal-monitor.mjs"]:
            command("/opt/parley-runtime/bin/node", "--check", str(staged / name))
        # Fail closed after replacing the baseline; a failed upload is never retried here.
        assert not PREVIOUS_SITE.exists()
        installed = True
        os.rename(ROOT / "site", PREVIOUS_SITE)
        os.rename(staged / "site", ROOT / "site")
        for name in ["publisher.mjs", "formal-monitor.mjs"]:
            os.replace(staged / name, ROOT / name)
        result = command("systemctl", "start", "parley-stats-publication.service", check=False)
        assert result.returncode == 0, "Publication blocked; timer remains stopped for reconciliation"
        assert not (STATE / "pending.json").exists(), "Uncertain publication; do not retry"
        public = json.loads(download(ORIGIN + "/release-manifest.json?ui=" + commit, 131072))
        assert public["frontendSourceSha256"] == manifest["frontendSourceSha256"]
        for name, metadata in manifest["files"].items():
            if name != "stats.json":
                assert public["files"][name] == metadata, "Public static mismatch"
        assert sha(download(ORIGIN + "/?ui=" + commit)) == manifest["files"]["index.html"]["sha256"]
        command("systemctl", "start", "parley-monitor.service", check=False)
        monitor = json.loads(Path("/var/lib/parley-monitor/formal-latest.json").read_bytes())
        assert monitor["hosting"]["status"] == "passed", "New UI hosting check failed"
        for unit, was_active in prior.items():
            if was_active:
                command("systemctl", "start", unit)
        report = {
            "status": "published-ui-and-restored-statistics-timer",
            "commit": commit,
            "frontendSourceSha256": manifest["frontendSourceSha256"],
            "observedAt": int(time.time()),
            "timers": {unit: active(unit) for unit in timers},
            "hostingChecksPassed": len(monitor["hosting"]["checks"]),
            "businessWarningsRetained": [item["code"] for item in monitor["health"]["checks"]],
            "walletAccess": False, "transactions": 0, "dnsChanged": False,
        }
        (STAGE / "activation.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report))
    except Exception as error:
        if not installed:
            for unit, was_active in prior.items():
                if was_active:
                    command("systemctl", "start", unit, check=False)
        print(json.dumps({"status": "stopped-for-reconciliation", "installed": installed,
                          "reason": str(error), "automaticRetry": False}))
        raise


if __name__ == "__main__":
    main()
