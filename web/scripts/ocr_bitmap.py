#!/usr/bin/env python3
"""OCR one bitmap subtitle file and print JSON progress lines on stdout."""

from __future__ import annotations

import json
import logging
import re
import subprocess
import sys
from pathlib import Path

logging.basicConfig(stream=sys.stderr, level=logging.WARNING)

BATCH = 20


def emit(phase: str, message: str, percent: float, current: int | None = None, total: int | None = None) -> None:
    payload: dict[str, object] = {
        "phase": phase,
        "message": message,
        "percent": percent,
    }
    if current is not None:
        payload["current"] = current
    if total is not None:
        payload["total"] = total
    print(json.dumps(payload), flush=True)


def read_percent(done: int, total: int) -> float:
    if total <= 0:
        return 10
    return 10 + (80 * min(done, total) / total)


def ocr_pgs(sup_path: Path, srt_path: Path) -> None:
    from babelfish import Language
    from pgsrip.api import decode
    from pgsrip.cue import Cue
    from pgsrip.engines.tessdata import Tessdata
    from pgsrip.engines.tesseract import TesseractEngine
    from pgsrip.media import Media
    from pgsrip.options import Options
    from pgsrip.writers.srt import SrtWriter

    language = Language("eng")
    engine = TesseractEngine(
        workers=2,
        tessdata=Tessdata(data_dir="/usr/share/tessdata", download=False),
    )
    options = Options(force=True, engines=[engine], post_processors=[])
    media = Media(str(sup_path))
    subtitles = media.subtitles(options)
    if not subtitles:
        raise RuntimeError(f"No PGS track in {sup_path.name}")

    subtitle = subtitles[0]
    engine.prepare([language])
    emit("read", "Reading subtitle images", 10)
    with subtitle:
        items = [item for item in decode(subtitle) if item.height]
        total = len(items)
        if total == 0:
            raise RuntimeError("No subtitle images in this PGS track")

        cues: list[Cue] = []
        done = 0
        for start in range(0, total, BATCH):
            chunk = items[start : start + BATCH]
            readings = engine.recognize(chunk, language, None)
            for item, reading in zip(chunk, readings, strict=True):
                cues.append(
                    Cue(
                        item.index,
                        item.start,
                        item.end,
                        reading.text,
                        reading.confidence,
                        reading.doubtful,
                        "TesseractEngine",
                        item,
                    )
                )
            done += len(chunk)
            emit(
                "read",
                f"Reading subtitle {done} of {total}",
                read_percent(done, total),
                done,
                total,
            )

        SrtWriter().write(str(srt_path), cues, subtitle.track, "utf-8")


def count_vobsub_cues(idx_path: Path) -> int:
    text = idx_path.read_text(encoding="utf-8", errors="replace")
    return len(re.findall(r"(?m)^timestamp:", text))


def ocr_vobsub(idx_path: Path, srt_path: Path) -> None:
    base = str(idx_path.with_suffix(""))
    total = count_vobsub_cues(idx_path)
    emit("read", "Reading subtitle images", 10, 0, total or None)
    process = subprocess.Popen(
        [
            "vobsub2srt",
            "--verbose",
            "--tesseract-lang",
            "eng",
            "--tesseract-data",
            "/usr/share/tessdata",
            "--index",
            "0",
            base,
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    assert process.stdout is not None
    current = 0
    for line in process.stdout:
        match = re.match(r"(\d+) Text:", line)
        if not match:
            continue
        current = int(match.group(1))
        shown_total = max(total, current)
        emit(
            "read",
            f"Reading subtitle {current} of {shown_total}",
            read_percent(current, shown_total),
            current,
            shown_total,
        )
    stderr = process.stderr.read() if process.stderr else ""
    code = process.wait()
    if code != 0:
        detail = stderr.strip() or f"vobsub2srt exited with {code}"
        raise RuntimeError(detail)
    produced = Path(base + ".srt")
    if not produced.is_file():
        raise RuntimeError("vobsub2srt did not write an SRT")
    if produced.resolve() != srt_path.resolve():
        srt_path.write_bytes(produced.read_bytes())


def main() -> int:
    if len(sys.argv) != 4:
        print("usage: ocr_bitmap.py pgs|vobsub INPUT OUTPUT", file=sys.stderr)
        return 2
    kind, source, output = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])
    try:
        if kind == "pgs":
            ocr_pgs(source, output)
        elif kind == "vobsub":
            ocr_vobsub(source, output)
        else:
            raise RuntimeError(f"Unknown subtitle kind {kind}")
    except Exception as error:
        emit("error", str(error), 0)
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
