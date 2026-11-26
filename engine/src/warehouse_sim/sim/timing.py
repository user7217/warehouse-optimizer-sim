"""Wall-clock timing of algorithm calls. Mirrors `CallStats` / `Timing` in frontend/src/types.ts.

Uses time.perf_counter. In the browser (Pyodide) that is performance.now(), which is precise to
~5 us when the page is cross-origin isolated (the site sends COOP/COEP headers) and ~100 us otherwise.
Single calls near that resolution are noisy; totals and means over many calls are reliable.
"""

from __future__ import annotations

import random
import time

RESERVOIR = 5000  # samples kept for the p95; reservoir sampling keeps memory flat on long runs


class CallStats:
    __slots__ = ("calls", "total", "max", "_samples", "_rng")

    def __init__(self) -> None:
        self.calls = 0
        self.total = 0.0
        self.max = 0.0
        self._samples: list[float] = []
        self._rng = random.Random(0)  # separate RNG: timing must never perturb the simulation

    def add(self, seconds: float) -> None:
        self.calls += 1
        self.total += seconds
        if seconds > self.max:
            self.max = seconds
        if len(self._samples) < RESERVOIR:
            self._samples.append(seconds)
        else:
            j = self._rng.randrange(self.calls)
            if j < RESERVOIR:
                self._samples[j] = seconds

    def to_dict(self) -> dict:
        p95 = 0.0
        if self._samples:
            s = sorted(self._samples)
            p95 = s[min(len(s) - 1, int(0.95 * len(s)))]
        ms = 1000.0
        return {
            "calls": self.calls,
            "total_ms": round(self.total * ms, 3),
            "mean_ms": round(self.total / self.calls * ms, 4) if self.calls else 0.0,
            "p95_ms": round(p95 * ms, 4),
            "max_ms": round(self.max * ms, 4),
        }


class Timing:
    def __init__(self) -> None:
        self.route = CallStats()
        self.assign = CallStats()
        self.tick = CallStats()
        self.wall = 0.0

    def to_dict(self) -> dict:
        return {"route": self.route.to_dict(), "assign": self.assign.to_dict(), "tick": self.tick.to_dict(),
                "wall_ms": round(self.wall * 1000.0, 2)}


now = time.perf_counter
