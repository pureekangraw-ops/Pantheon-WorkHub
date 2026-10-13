from __future__ import annotations

import hashlib
import os
import re
from pathlib import Path


class ArtifactConflict(RuntimeError):
    pass


class TextArtifactTool:
    """Create one deterministic artifact under a dedicated local workspace."""

    name = "workspace.create_text_artifact"

    def __init__(self, workspace: str | Path):
        self.workspace = Path(workspace).resolve()
        self.workspace.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def sha256(data: bytes) -> str:
        return hashlib.sha256(data).hexdigest()

    def _path(self, task_id: str, action_key: str) -> Path:
        if not re.fullmatch(r"task_[a-f0-9]{32}", task_id):
            raise ValueError("invalid Task ID")
        if not re.fullmatch(r"act_[a-f0-9]{64}", action_key):
            raise ValueError("invalid Action Key")
        path = (self.workspace / "artifacts" / task_id / f"{action_key}.txt").resolve()
        if self.workspace not in path.parents:
            raise ValueError("artifact path escaped workspace")
        return path

    def execute(self, task_id: str, action_key: str, content: str, expected_sha256: str) -> dict:
        path = self._path(task_id, action_key)
        path.parent.mkdir(parents=True, exist_ok=True)
        data = content.encode("utf-8")
        if self.sha256(data) != expected_sha256:
            raise ValueError("input hash mismatch")
        try:
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            observed = self.inspect(task_id, action_key, expected_sha256)
            if observed["matches"]:
                return {"path": str(path.relative_to(self.workspace)), "sha256": expected_sha256, "deduplicated": True}
            raise ArtifactConflict("artifact exists with different content")
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        return {"path": str(path.relative_to(self.workspace)), "sha256": expected_sha256, "deduplicated": False}

    def inspect(self, task_id: str, action_key: str, expected_sha256: str) -> dict:
        path = self._path(task_id, action_key)
        if not path.exists():
            return {"exists": False, "matches": False, "path": str(path.relative_to(self.workspace))}
        data = path.read_bytes()
        digest = self.sha256(data)
        return {
            "exists": True,
            "matches": digest == expected_sha256,
            "path": str(path.relative_to(self.workspace)),
            "sha256": digest,
        }
