"""Document storage backends.

Every piece of editable data in this app (projects, bills, baselines, job
results, registries, master item codes, ...) is a JSON document addressed by
a posix-style key such as ``companies/provident/projects/<id>.json``. This
module is the ONLY place that knows where those documents physically live:

* ``FileBackend``     -- plain JSON files under a root directory (local dev,
                         tests; the original behaviour).
* ``PostgresBackend`` -- one row per document in a ``documents`` table
                         (Supabase or any Postgres). Chosen automatically when
                         ``DATABASE_URL`` is set; see db/schema.sql.

Both implement the same small interface, so no calling code changes between
them. Keys are "folder-like": ``list_keys('a/b')`` returns the documents
directly inside ``a/b`` and ``list_subdirs('a/b')`` the immediate sub-folder
names, exactly as a filesystem would.
"""

from __future__ import annotations

import json
import os
import shutil
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Iterable, Optional


def _norm(prefix: str) -> str:
    return prefix.strip("/")


# --------------------------------------------------------------------------
# File backend
# --------------------------------------------------------------------------
class FileBackend:
    name = "file"

    def __init__(self, root: Callable[[], Path] | Path):
        # `root` may be a callable so tests that monkeypatch the data
        # directory after import are honoured (see company_store.COMPANIES_DIR).
        self._root = root if callable(root) else (lambda: root)

    @property
    def root(self) -> Path:
        return Path(self._root())

    def _p(self, key: str) -> Path:
        return self.root / key

    def read(self, key: str) -> Optional[Any]:
        p = self._p(key)
        if not p.exists():
            return None
        return json.loads(p.read_text(encoding="utf-8"))

    def exists(self, key: str) -> bool:
        return self._p(key).exists()

    def write(self, key: str, data: Any, *, indent: int = 2, sort_keys: bool = False) -> None:
        """Atomic write: temp file in the same folder, then os.replace()
        (with a short retry for transient Windows file locks -- antivirus,
        OneDrive sync -- that otherwise raise PermissionError)."""
        path = self._p(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f"{path.name}.{uuid.uuid4().hex[:8]}.tmp")
        tmp.write_text(json.dumps(data, indent=indent, sort_keys=sort_keys), encoding="utf-8")
        last_err: Optional[Exception] = None
        for attempt in range(6):
            try:
                os.replace(tmp, path)
                return
            except PermissionError as e:
                last_err = e
                time.sleep(0.05 * (attempt + 1))
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
        raise last_err  # type: ignore[misc]

    def delete(self, key: str) -> bool:
        p = self._p(key)
        if not p.exists():
            return False
        p.unlink()
        return True

    def delete_prefix(self, prefix: str) -> bool:
        p = self._p(_norm(prefix))
        if not p.exists():
            return False
        shutil.rmtree(p) if p.is_dir() else p.unlink()
        return True

    def list_keys(self, prefix: str, suffix: str = ".json") -> list[str]:
        d = self._p(_norm(prefix))
        if not d.is_dir():
            return []
        pre = _norm(prefix)
        return sorted(
            f"{pre}/{p.name}" for p in d.iterdir() if p.is_file() and p.name.endswith(suffix) and not p.name.endswith(".tmp")
        )

    def list_subdirs(self, prefix: str) -> list[str]:
        d = self._p(_norm(prefix))
        if not d.is_dir():
            return []
        return sorted(p.name for p in d.iterdir() if p.is_dir())

    def ensure_dir(self, prefix: str) -> None:
        self._p(_norm(prefix)).mkdir(parents=True, exist_ok=True)

    def read_many(self, prefix: str, suffix: str = ".json", exclude_suffix: Optional[str] = None) -> list[tuple[str, Any]]:
        return [
            (k, self.read(k))
            for k in self.list_keys(prefix, suffix)
            if not (exclude_suffix and k.endswith(exclude_suffix))
        ]


# --------------------------------------------------------------------------
# Postgres backend
# --------------------------------------------------------------------------
def _like_escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


class PostgresBackend:
    name = "postgres"

    def __init__(self, dsn: str, *, max_size: int = 5):
        from psycopg_pool import ConnectionPool

        self.dsn = dsn
        # prepare_threshold=None: works through Supabase's transaction pooler
        # (pgbouncer) as well as the session pooler / a direct connection.
        self._pool = ConnectionPool(
            dsn,
            min_size=1,
            max_size=max_size,
            kwargs={"autocommit": True, "prepare_threshold": None},
            check=ConnectionPool.check_connection,  # drop dead connections (idle timeouts)
            open=True,
            timeout=30,
        )

    def close(self) -> None:
        self._pool.close()

    def _q(self, sql: str, params: tuple = ()):
        with self._pool.connection() as conn:
            cur = conn.execute(sql, params)
            return cur.fetchall() if cur.description else None

    def read(self, key: str) -> Optional[Any]:
        rows = self._q("select data from documents where path = %s", (key,))
        return rows[0][0] if rows else None

    def exists(self, key: str) -> bool:
        return bool(self._q("select 1 from documents where path = %s", (key,)))

    def write(self, key: str, data: Any, *, indent: int = 2, sort_keys: bool = False) -> None:
        body = json.dumps(data, sort_keys=sort_keys)
        self._q(
            "insert into documents (path, data, updated_at) values (%s, %s, now()) "
            "on conflict (path) do update set data = excluded.data, updated_at = now()",
            (key, body),
        )

    def delete(self, key: str) -> bool:
        rows = self._q("delete from documents where path = %s returning 1", (key,))
        return bool(rows)

    def delete_prefix(self, prefix: str) -> bool:
        pre = _norm(prefix)
        rows = self._q(
            "delete from documents where path = %s or path like %s escape '\\' returning 1",
            (pre, _like_escape(pre) + "/%"),
        )
        return bool(rows)

    def _keys_under(self, prefix: str) -> list[str]:
        pre = _norm(prefix)
        rows = self._q(
            "select path from documents where path like %s escape '\\'",
            (_like_escape(pre) + "/%",),
        )
        return [r[0] for r in rows or []]

    def list_keys(self, prefix: str, suffix: str = ".json") -> list[str]:
        pre = _norm(prefix) + "/"
        out = []
        for k in self._keys_under(prefix):
            rest = k[len(pre):]
            if "/" not in rest and rest.endswith(suffix):
                out.append(k)
        return sorted(out)

    def list_subdirs(self, prefix: str) -> list[str]:
        pre = _norm(prefix) + "/"
        return sorted({k[len(pre):].split("/", 1)[0] for k in self._keys_under(prefix) if "/" in k[len(pre):]})

    def ensure_dir(self, prefix: str) -> None:  # folders are implicit
        return None

    def read_many(self, prefix: str, suffix: str = ".json", exclude_suffix: Optional[str] = None) -> list[tuple[str, Any]]:
        # Pick the wanted keys first (cheap, keys only) so large sibling
        # documents we are excluding (e.g. *_result.json) are never fetched.
        keys = [k for k in self.list_keys(prefix, suffix) if not (exclude_suffix and k.endswith(exclude_suffix))]
        if not keys:
            return []
        rows = self._q("select path, data from documents where path = any(%s) order by path", (keys,))
        return [(r[0], r[1]) for r in rows or []]
