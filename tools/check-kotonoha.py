"""Headless integration: real upstream receiver/decoder/display and local mpv, no accounts.

This is protocol evidence, not a Hyprland/layer-shell/GPU test. No upstream files are edited.
"""
from __future__ import annotations

import asyncio
import json
import math
import socket
import struct
import subprocess
import sys
import tempfile
import wave
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parents[1]
REFERENCE_COMMIT = subprocess.run(["git", "-C", str(ROOT / "kotonoha"), "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
sys.path.insert(0, str(ROOT / "kotonoha/src"))
from kotonoha.app.display_coordinator import DisplayCoordinator
from kotonoha.app.source_gate import SourceOwnershipCoordinator
from kotonoha.display.presentation import DisplayEngine
from kotonoha.display.timeline import TimelineEngine
from kotonoha.receiver import AdapterReceiver
from kotonoha.ui.overlay.publisher import QtDisplayPublisher
from kotonoha.ui.overlay.state import LyricsState


class RecordingReceiver(AdapterReceiver):
    """Instrument accepted messages while keeping real protocol and ownership validation."""

    def __init__(self, port: int, wake: asyncio.Event) -> None:
        state = LyricsState()
        display = DisplayCoordinator(QtDisplayPublisher(state), presenter=DisplayEngine(), timeline=TimelineEngine())
        super().__init__(display, port=port, ownership=SourceOwnershipCoordinator())
        self.records: list[str] = []
        self.rejected = 0
        self.wake = wake

    def ingest(self, raw_text: str, *, client_id: int) -> bool:
        accepted = super().ingest(raw_text, client_id=client_id)
        if accepted:
            self.records.append(raw_text)
        else:
            self.rejected += 1
        self.wake.set()
        return accepted


async def main() -> None:
    """Observe offline playback, live transitions, repeat and reconnect through the real receiver."""
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    wake = asyncio.Event()
    receiver = RecordingReceiver(port, wake)
    backend: list[str] = []
    with tempfile.TemporaryDirectory(prefix="kugou-kotonoha-") as directory:
        file = Path(directory) / "tone.wav"
        with wave.open(str(file), "wb") as audio:
            audio.setparams((1, 2, 8000, 0, "NONE", "not compressed"))
            audio.writeframes(b"".join(struct.pack("<h", round(4000 * math.sin(i * math.tau * 440 / 8000))) for i in range(64000)))
        process = await asyncio.create_subprocess_exec(
            "node", str(ROOT / "tools/kotonoha-probe.mjs"), f"ws://127.0.0.1:{port}/kotonoha/adapter", str(file),
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )

        async def collect() -> None:
            if process.stdout is None:
                raise RuntimeError("missing probe output")
            async for line in process.stdout:
                backend.append(line.decode())
                wake.set()

        reader = asyncio.create_task(collect())

        async def wait(records: list[str], predicate: Callable[[dict], bool], start: int = 0) -> dict:
            async with asyncio.timeout(8):
                while True:
                    wake.clear()
                    for raw in records[start:]:
                        message = json.loads(raw)
                        if predicate(message):
                            return message
                    await wake.wait()

        async def command(value: str) -> None:
            if process.stdin is None:
                raise RuntimeError("missing probe input")
            process.stdin.write((value + "\n").encode())
            await process.stdin.drain()

        try:
            await wait(backend, lambda m: m.get("kind") == "ready")
            await command("start")
            await wait(backend, lambda m: m.get("status") == "Playing")
            await wait(backend, lambda m: m.get("position", 0) > 0.1)
            await command("lyrics")
            # Receiver intentionally starts late: playback already works while connection is refused.
            await receiver.start()
            snapshot = await wait(receiver.records, lambda m: m["type"] == "snapshot" and m["lyrics"] is not None)
            assert snapshot["playback"]["durationS"] == 8
            assert snapshot["lyrics"]["lines"][0]["start"] == 1.25
            assert snapshot["lyrics"]["lines"][0]["words"][1]["start"] == 1.65
            assert snapshot["lyrics"]["lines"][0]["translation"] == "本地测试译文"
            start = len(receiver.records)
            await command("pause")
            await wait(receiver.records, lambda m: m["type"] == "clock" and m["status"] == "Paused", start)
            start = len(receiver.records)
            await command("resume")
            await wait(receiver.records, lambda m: m["type"] == "clock" and m["status"] == "Playing", start)
            start = len(receiver.records)
            await command("seek")
            seek = await wait(receiver.records, lambda m: m["type"] == "clock" and m["positionS"] is not None and abs(m["positionS"] - 3) < 0.25, start)
            start = len(receiver.records)
            await command("reconnect")
            reconnect = await wait(receiver.records, lambda m: m["type"] == "snapshot" and m["sequence"] == 0 and m["lyrics"] is not None, start)
            assert reconnect["playback"]["track"]["stableId"] == snapshot["playback"]["track"]["stableId"]
            start = len(receiver.records)
            await command("start")
            repeated = await wait(receiver.records, lambda m: m["type"] == "snapshot" and m["playback"]["track"] is not None and m["lyrics"] is None, start)
            assert repeated["playback"]["track"]["stableId"] == snapshot["playback"]["track"]["stableId"]
            start = len(receiver.records)
            await command("loop")
            await wait(backend, lambda m: m.get("autoLoop") is True)
            await wait(receiver.records, lambda m: m["type"] == "clock" and m["status"] == "Playing" and m["positionS"] is not None and m["positionS"] < 1, start)
            start = len(receiver.records)
            await command("stop")
            await wait(receiver.records, lambda m: m["type"] == "clock" and m["status"] == "Stopped", start)
            assert receiver.rejected == 0
            evidence = {"referenceCommit": REFERENCE_COMMIT, "protocol": "kotonoha.adapter", "version": 1,
                        "backend": "real mpv --ao=null / local synthetic PCM", "receiver": "actual upstream AdapterReceiver/decoder/display coordinator",
                        "desktopVerified": False, "acceptedFrames": len(receiver.records), "rejectedFrames": receiver.rejected,
                        "checks": ["offline playback", "word times/offset/translation", "actual duration", "pause/resume", "actual seek", "same-song restart without lyrics", "single-loop EOF/restart", "reconnect snapshot", "stop"],
                        "snapshot": snapshot, "clock": seek}
            evidence_file = ROOT / "docs/kotonoha-protocol-evidence.json"
            evidence_file.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n")
            print(json.dumps({k: v for k, v in evidence.items() if k not in {"snapshot", "clock"}}, ensure_ascii=False))
            await command("quit")
            await asyncio.wait_for(process.wait(), timeout=3)
            if process.returncode != 0:
                raise RuntimeError("probe driver failed")
        finally:
            if process.returncode is None:
                process.terminate()
                await asyncio.wait_for(process.wait(), timeout=3)
            reader.cancel()
            await asyncio.gather(reader, return_exceptions=True)
            await receiver.stop()


if __name__ == "__main__":
    asyncio.run(main())
