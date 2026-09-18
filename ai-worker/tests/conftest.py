import os
import subprocess
import sys

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
FIXTURES = os.path.join(ROOT, "tests", "fixtures", "generated")
MODELS = os.environ.get("SEVENVID_MODELS_DIR", os.path.join(ROOT, ".sevenvid-dev", "userData", "models"))


@pytest.fixture(scope="session")
def fixtures_dir() -> str:
    if not os.path.exists(os.path.join(FIXTURES, "clip-10s-720p.mp4")):
        pytest.skip("run `pnpm fixtures` first")
    if not os.path.exists(os.path.join(FIXTURES, "astronaut.png")):
        subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), "..", "scripts", "gen_fixtures.py"), FIXTURES], check=False)
    return FIXTURES


@pytest.fixture(scope="session")
def models_dir() -> str:
    return MODELS


def model_or_skip(rel: str) -> str:
    p = os.path.join(MODELS, rel)
    if not os.path.exists(p):
        pytest.skip(f"model not installed: {rel}")
    return p


class Ctx:
    def __init__(self):
        self.progress_calls = []

    def progress(self, ratio, message=None):
        self.progress_calls.append((ratio, message))

    def check(self):
        return None

    cancelled = False


@pytest.fixture
def ctx():
    return Ctx()
