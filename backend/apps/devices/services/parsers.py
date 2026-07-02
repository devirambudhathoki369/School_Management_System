"""ZKTeco push-protocol body parsers (exact port of the legacy parsers)."""

from collections.abc import Iterator
from datetime import datetime

from django.utils import timezone


def _decode(body: bytes) -> str:
    return body.decode("utf-8", errors="replace")


def parse_attlog(body: bytes) -> Iterator[dict]:
    """ATTLOG: one record per line, tab-separated: PIN Time Status Verify [Workcode]."""
    for raw in _decode(body).splitlines():
        line = raw.strip()
        if not line:
            continue
        fields = line.split("\t")
        if len(fields) < 4:
            continue
        try:
            naive = datetime.strptime(fields[1], "%Y-%m-%d %H:%M:%S")
        except ValueError:
            continue
        punch_time = timezone.make_aware(naive, timezone.get_current_timezone())
        status = int(fields[2]) if fields[2].lstrip("-").isdigit() else 0
        verify = int(fields[3]) if fields[3].lstrip("-").isdigit() else 0
        workcode = 0
        if len(fields) >= 5 and fields[4].lstrip("-").isdigit():
            workcode = int(fields[4])
        yield {
            "pin": fields[0],
            "punch_time": punch_time,
            "status": status,
            "verify": verify,
            "workcode": workcode,
        }


def parse_kv_after_prefix(line: str) -> dict:
    """Lines look like: 'PREFIX K1=V1\\tK2=V2\\t...'."""
    rest = line.partition(" ")[2] if " " in line else line
    out = {}
    for token in rest.split("\t"):
        if "=" in token:
            key, _, value = token.partition("=")
            out[key.strip()] = value
    return out


def parse_operlog(body: bytes) -> Iterator[tuple[str, dict]]:
    for raw in _decode(body).splitlines():
        line = raw.strip()
        if not line:
            continue
        yield line.split(" ", 1)[0], parse_kv_after_prefix(line)
