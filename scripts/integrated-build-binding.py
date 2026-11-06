"""Bounded local build provenance. No child process, network, credential or DB APIs."""
import hashlib
import json
import os
from pathlib import Path
import stat

MAX_FILES = 2048
MAX_DIRECTORIES = 512
MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_INPUT_BYTES = 64 * 1024 * 1024
MAX_MANIFEST_BYTES = 1024 * 1024
CHUNK_BYTES = 65536
BOUNDARY = "uagent.frontend-inputs.v1"
SOURCE_ROOTS = (
    ("apps/desktop/web/src", True),
    ("apps/desktop/web/public", False),
    ("packages/runtime/src", True),
    ("packages/shared/src", True),
    ("packages/mcp-client/src", True),
)
CONFIG_FILES = (
    "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json", "tsconfig.node.json",
    "apps/desktop/package.json", "apps/desktop/tsconfig.json", "apps/desktop/web/index.html",
    "apps/desktop/web/vite.config.ts", "apps/desktop/web/tsconfig.json",
    "apps/desktop/web/tsconfig.current-integration.json",
    "packages/runtime/package.json", "packages/runtime/tsconfig.json",
    "packages/shared/package.json", "packages/shared/tsconfig.json",
    "packages/mcp-client/package.json", "packages/mcp-client/tsconfig.json",
)

class BindingError(Exception):
    pass


def fail(code):
    raise BindingError(code)


def local_path(path, required=True):
    path = Path(path)
    if not path.is_absolute() or path.drive.upper() not in ("E:", "G:"):
        fail("binding_local_drive_required")
    for part in (path, *path.parents):
        try:
            info = part.lstat()
        except FileNotFoundError:
            continue
        if getattr(info, "st_file_attributes", 0) & 0x400:
            fail("binding_reparse_rejected")
    if required and not path.exists():
        fail("binding_path_missing")
    return path


def regular(path):
    path = local_path(path)
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode):
        fail("binding_regular_file_required")
    return info


def write_json(path, value, maximum=MAX_MANIFEST_BYTES):
    body = json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":")).encode()
    if len(body) > maximum:
        fail("binding_manifest_capacity")
    local_path(path, False)
    with Path(path).open("xb") as stream:
        stream.write(body)
        stream.flush()
        os.fsync(stream.fileno())
    return hashlib.sha256(body).hexdigest()


def read_json(path, maximum=MAX_MANIFEST_BYTES):
    regular(path)
    with Path(path).open("rb") as stream:
        body = stream.read(maximum + 1)
    if len(body) > maximum:
        fail("binding_manifest_capacity")
    try:
        return json.loads(body)
    except (ValueError, UnicodeError):
        fail("binding_manifest_invalid")


def file_digest(path, maximum=MAX_FILE_BYTES, copy_to=None):
    info = regular(path)
    if not 0 <= info.st_size <= maximum:
        fail("binding_file_capacity")
    digest = hashlib.sha256()
    count = 0
    target = None
    try:
        if copy_to is not None:
            local_path(copy_to, False)
            Path(copy_to).parent.mkdir(parents=True, exist_ok=True)
            local_path(Path(copy_to).parent)
            target = Path(copy_to).open("xb")
        with Path(path).open("rb") as source:
            opened = os.fstat(source.fileno())
            if (opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns) != (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns):
                fail("binding_input_changed")
            while True:
                block = source.read(CHUNK_BYTES)
                if not block:
                    break
                count += len(block)
                if count > maximum:
                    fail("binding_file_capacity")
                digest.update(block)
                if target is not None:
                    target.write(block)
            ended = os.fstat(source.fileno())
        current = regular(path)
        identity = lambda entry: (entry.st_dev, entry.st_ino, entry.st_size, entry.st_mtime_ns)
        if count != info.st_size or identity(ended) != identity(info) or identity(current) != identity(info):
            fail("binding_input_changed")
        if target is not None:
            target.flush()
            os.fsync(target.fileno())
        return count, digest.hexdigest()
    finally:
        if target is not None:
            target.close()


def metadata_digest(path):
    return file_digest(path, MAX_MANIFEST_BYTES)[1]


def walk_files(directory, maximum_files=MAX_FILES):
    directory = local_path(directory)
    if not directory.is_dir():
        fail("binding_directory_required")
    pending = [directory]
    found = []
    directories = 0
    while pending:
        current = pending.pop()
        directories += 1
        if directories > MAX_DIRECTORIES:
            fail("binding_directory_capacity")
        entries = []
        with os.scandir(current) as iterator:
            for entry in iterator:
                entries.append(entry)
                if len(entries) + len(found) + len(pending) > MAX_FILES + MAX_DIRECTORIES:
                    fail("binding_inventory_capacity")
        for entry in sorted(entries, key=lambda item: item.name):
            path = local_path(Path(entry.path))
            info = entry.stat(follow_symlinks=False)
            if entry.name.startswith(".env"):
                fail("binding_environment_file_present")
            if stat.S_ISDIR(info.st_mode):
                if entry.name in ("node_modules", ".git"):
                    fail("binding_external_source_directory")
                pending.append(path)
            elif stat.S_ISREG(info.st_mode):
                found.append(path)
                if len(found) > maximum_files:
                    fail("binding_file_count_capacity")
            else:
                fail("binding_regular_file_required")
    return sorted(found, key=lambda path: path.as_posix())


def source_paths(root):
    root = local_path(root)
    # Vite loads environment files outside the typed source inventory. Refuse
    # their presence without opening them; never snapshot potential credentials.
    for folder in (root, root / "apps/desktop", root / "apps/desktop/web"):
        observed = 0
        with os.scandir(folder) as iterator:
            for entry in iterator:
                observed += 1
                if observed > MAX_FILES + MAX_DIRECTORIES:
                    fail("binding_inventory_capacity")
                if entry.name.startswith(".env"):
                    fail("binding_environment_file_present")
    paths = []
    roots = []
    for logical, required in SOURCE_ROOTS:
        path = local_path(root / logical, False)
        exists = path.exists()
        if required and not exists:
            fail("binding_source_root_missing")
        roots.append({"path": logical, "present": exists})
        if exists:
            paths.extend(walk_files(path))
    paths.extend(local_path(root / logical) for logical in CONFIG_FILES)
    if len(paths) > MAX_FILES:
        fail("binding_file_count_capacity")
    logicals = [path.relative_to(root).as_posix() for path in paths]
    if len({value.casefold() for value in logicals}) != len(logicals) or any(len(value.encode()) > 512 for value in logicals):
        fail("binding_inventory_invalid")
    return sorted(paths, key=lambda path: path.relative_to(root).as_posix()), roots


def inventory(root, paths, kind, roots=None, copy_root=None):
    if copy_root is not None:
        local_path(copy_root, False)
        Path(copy_root).mkdir(parents=True, exist_ok=False)
    entries = []
    total = 0
    for path in paths:
        logical = path.relative_to(root).as_posix()
        if total + regular(path).st_size > MAX_INPUT_BYTES:
            fail("binding_total_bytes_capacity")
        count, digest = file_digest(path, copy_to=None if copy_root is None else Path(copy_root) / logical)
        total += count
        if total > MAX_INPUT_BYTES:
            fail("binding_total_bytes_capacity")
        entries.append({"path": logical, "bytes": count, "sha256": digest})
    core = {"schemaVersion": 1, "kind": kind, "boundary": BOUNDARY, "roots": roots or [], "files": entries, "totalBytes": total}
    canonical = json.dumps(core, sort_keys=True, separators=(",", ":")).encode()
    core["treeSha256"] = hashlib.sha256(canonical).hexdigest()
    return core


def snapshot_inputs(root, snapshot_root, manifest_path):
    paths, roots = source_paths(root)
    value = inventory(root, paths, "frontend-input-snapshot", roots, snapshot_root)
    return value, write_json(manifest_path, value)


def validate_snapshot(snapshot_root, manifest):
    if not isinstance(manifest, dict) or not isinstance(manifest.get("files"), list) or len(manifest["files"]) > MAX_FILES:
        fail("binding_manifest_invalid")
    # Exact equality against the independently collected live inventory is checked
    # by verify_inputs/verify_artifacts before these paths are used.
    paths = walk_files(snapshot_root)
    actual = inventory(Path(snapshot_root), paths, manifest["kind"], manifest["roots"])
    if actual != manifest:
        fail("binding_snapshot_changed")


def verify_inputs(root, snapshot_root, manifest_path):
    expected = read_json(manifest_path)
    paths, roots = source_paths(root)
    actual = inventory(root, paths, "frontend-input-snapshot", roots)
    if actual != expected:
        fail("binding_frontend_source_drift")
    validate_snapshot(snapshot_root, expected)
    return expected


def snapshot_artifacts(web_root, snapshot_root, manifest_path):
    paths = walk_files(web_root, 128)
    if not paths or not (Path(web_root) / "index.html").is_file():
        fail("binding_frontend_output_missing")
    value = inventory(Path(web_root), paths, "frontend-artifact-snapshot", copy_root=snapshot_root)
    return value, write_json(manifest_path, value)


def verify_artifacts(web_root, snapshot_root, manifest_path):
    expected = read_json(manifest_path)
    paths = walk_files(web_root, 128)
    actual = inventory(Path(web_root), paths, "frontend-artifact-snapshot")
    if actual != expected or not (Path(web_root) / "index.html").is_file():
        fail("binding_frontend_artifact_drift")
    validate_snapshot(snapshot_root, expected)
    return expected


def peak_verdict(report):
    fields = ("processLimitBytes", "treeLimitBytes", "peakProcessBytes", "peakTreeBytes")
    if any(type(report.get(key)) is not int or report[key] < 0 for key in fields) or not report["processLimitBytes"] or not report["treeLimitBytes"]:
        fail("binding_peak_telemetry_missing")
    return {"processLimitBytes": report[fields[0]], "treeLimitBytes": report[fields[1]],
        "peakProcessBytes": report[fields[2]], "peakTreeBytes": report[fields[3]],
        "eligible": report[fields[2]] <= report[fields[0]] and report[fields[3]] <= report[fields[1]],
        "policy": "new-candidate-requires-peaks-within-configured-limits;historical-public-results-unchanged"}
