from __future__ import annotations

import argparse
import sys

from .capabilities import build_handlers
from .rpc import RpcServer


def main() -> None:
    parser = argparse.ArgumentParser(prog="sevenvid-worker")
    parser.add_argument("--stdio", action="store_true", help="serve JSON-RPC over stdin/stdout (default)")
    parser.add_argument("--probe", action="store_true", help="print capability probe as JSON and exit")
    args = parser.parse_args()
    handlers = build_handlers()
    if args.probe:
        import json

        from .capabilities.system import hello

        print(json.dumps(hello({}, None), ensure_ascii=False, indent=2))  # type: ignore[arg-type]
        return
    server = RpcServer(handlers)
    server.notify("ready", {"version": "0.1.0", "python": sys.version.split()[0]})
    server.serve()


if __name__ == "__main__":
    main()
