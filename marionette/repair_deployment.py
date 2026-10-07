"""File-scoped deploy recovery. No reset, checkout, recursive delete or data migration."""
import base64
import hashlib
import json
import os
import re
from pathlib import Path


def sha(data):
    return hashlib.sha256(data).hexdigest()


class RepairDeployment:
    def __init__(self, root, relative):
        self.root = Path(root).resolve()
        if not re.fullmatch(r"data/self-modification/deployments/[A-Za-z0-9_-]+/manifest.json", str(relative)):
            raise ValueError("Invalid deployment manifest path")
        self.manifest_path = self.contained(relative)
        self.receipt_path = self.manifest_path.with_name("receipt.json")
        self.manifest = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        self.id = self.manifest.get("promotion_id")
        if self.manifest.get("schema_version") != 2 or self.id != self.manifest_path.parent.name:
            raise ValueError("Invalid deployment identity/version")
        self.files = self.manifest.get("files", [])
        if not 1 <= len(self.files) <= 4 or len({f["path"].lower() for f in self.files}) != len(self.files):
            raise ValueError("Invalid deployment file scope")
        for item in self.files:
            if not re.fullmatch(r"(?:core|arbiters|server|scripts)/[^:]+\.(?:js|cjs|mjs|ts)", item["path"]):
                raise ValueError("Deployment is source-only")
            self.contained(item["path"])
            if sha(base64.b64decode(item["before_base64"], validate=True)) != item["before_sha256"]:
                raise ValueError("Corrupt recovery snapshot")
        if self.manifest.get("test_receipt", {}).get("passed") is not True:
            raise ValueError("Deployment lacks passing tests")

    def contained(self, relative):
        candidate = (self.root / relative).resolve()
        if candidate == self.root or not candidate.is_relative_to(self.root):
            raise ValueError("Deployment path escapes workspace")
        return candidate

    def verify(self, version="after"):
        for item in self.files:
            if sha(self.contained(item["path"]).read_bytes()) != item[f"{version}_sha256"]:
                raise ValueError(f"Deployment file changed: {item['path']}")

    def receipt(self, status, **details):
        record = dict(schema_version=2, promotion_id=self.id, candidate_ref=self.manifest["candidate_ref"], status=status, **details)
        temp = self.receipt_path.with_suffix(".tmp")
        temp.write_text(json.dumps(record, indent=2), encoding="utf-8")
        os.replace(temp, self.receipt_path)
        return record

    def previous_receipt(self):
        try:
            return json.loads(self.receipt_path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return None

    def rollback(self):
        # Preflight ALL files before any write. Permit already-restored files so
        # recovery resumes safely after the supervisor itself is interrupted.
        for item in self.files:
            current = sha(self.contained(item["path"]).read_bytes())
            if current not in (item["before_sha256"], item["after_sha256"]):
                raise ValueError(f"Rollback blocked by intervening edit: {item['path']}")
        for item in self.files:
            target = self.contained(item["path"])
            temp = target.with_name(target.name + ".soma-recovery.tmp")
            if temp.exists():
                raise ValueError(f"Recovery temporary path already exists: {temp.name}")
            try:
                with temp.open("xb") as handle:
                    handle.write(base64.b64decode(item["before_base64"], validate=True))
                os.replace(temp, target)
            finally:
                if temp.exists():
                    temp.unlink()
        self.verify("before")
