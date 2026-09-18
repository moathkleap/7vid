"""Newline-delimited JSON-RPC 2.0 over stdio with progress notifications and cooperative cancellation."""
from __future__ import annotations

import json
import sys
import threading
import traceback
from dataclasses import dataclass, field
from typing import Any, Callable


class Cancelled(Exception):
    pass


class WorkerError(Exception):
    """Error with a stable code; surfaced to the Node side as AppError."""

    def __init__(self, code: str, message: str, data: dict | None = None):
        super().__init__(message)
        self.code = code
        self.data = data or {}


@dataclass
class Context:
    request_id: Any
    server: "RpcServer"
    cancel_event: threading.Event = field(default_factory=threading.Event)

    @property
    def cancelled(self) -> bool:
        return self.cancel_event.is_set()

    def check(self) -> None:
        if self.cancel_event.is_set():
            raise Cancelled()

    def progress(self, ratio: float, message: str | None = None) -> None:
        self.server.notify("progress", {"id": self.request_id, "ratio": max(0.0, min(1.0, float(ratio))), "message": message})


Handler = Callable[[dict, Context], Any]


class RpcServer:
    def __init__(self, handlers: dict[str, Handler], stdin=None, stdout=None):
        self.handlers = handlers
        self.stdin = stdin or sys.stdin
        self.stdout = stdout or sys.stdout
        self._lock = threading.Lock()
        self._active: dict[Any, Context] = {}
        self._queue_lock = threading.Semaphore(1)

    def write(self, obj: dict) -> None:
        line = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
        with self._lock:
            self.stdout.write(line + "\n")
            self.stdout.flush()

    def notify(self, method: str, params: dict) -> None:
        self.write({"jsonrpc": "2.0", "method": method, "params": params})

    def log(self, level: str, message: str, **fields: Any) -> None:
        self.notify("log", {"level": level, "message": message, **fields})

    def serve(self) -> None:
        for raw in self.stdin:
            raw = raw.strip()
            if not raw:
                continue
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                self.log("warn", "invalid json line")
                continue
            method = msg.get("method")
            if "id" not in msg:
                if method == "cancel":
                    target = (msg.get("params") or {}).get("id")
                    ctx = self._active.get(target)
                    if ctx:
                        ctx.cancel_event.set()
                elif method == "shutdown":
                    return
                continue
            threading.Thread(target=self._run, args=(msg,), daemon=True).start()

    def _run(self, msg: dict) -> None:
        req_id = msg.get("id")
        method = msg.get("method")
        params = msg.get("params") or {}
        ctx = Context(request_id=req_id, server=self)
        self._active[req_id] = ctx
        handler = self.handlers.get(method)
        try:
            if handler is None:
                self.write({"jsonrpc": "2.0", "id": req_id, "error": {"code": -32601, "message": f"method not found: {method}", "data": {"type": "METHOD_NOT_FOUND"}}})
                return
            with self._queue_lock:
                ctx.check()
                result = handler(params, ctx)
            self.write({"jsonrpc": "2.0", "id": req_id, "result": result})
        except Cancelled:
            self.write({"jsonrpc": "2.0", "id": req_id, "error": {"code": -32001, "message": "cancelled", "data": {"type": "CANCELLED"}}})
        except WorkerError as e:
            self.write({"jsonrpc": "2.0", "id": req_id, "error": {"code": -32000, "message": str(e), "data": {"type": e.code, **e.data}}})
        except Exception as e:  # noqa: BLE001
            self.write({"jsonrpc": "2.0", "id": req_id, "error": {"code": -32000, "message": f"{type(e).__name__}: {e}", "data": {"type": "WORKER_FAILED", "traceback": traceback.format_exc()[-4000:]}}})
        finally:
            self._active.pop(req_id, None)
