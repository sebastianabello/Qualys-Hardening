import re

MESES_ES = {
    1: "enero", 2: "febrero", 3: "marzo", 4: "abril", 5: "mayo", 6: "junio",
    7: "julio", 8: "agosto", 9: "septiembre", 10: "octubre", 11: "noviembre", 12: "diciembre"
}

RE_OS_1 = re.compile(r"CIS\s+Benchmark\s+for\s+(.+?)\s+v", re.IGNORECASE)
RE_OS_2 = re.compile(r"CIS\s+(.+?)\s+Benchmark", re.IGNORECASE)

def parse_fecha(fecha_str: str) -> tuple[int, int, int]:
    y, m, d = fecha_str.split("-")
    return int(y), int(m), int(d)

def extract_operating_system(first_line: str) -> str | None:
    m = RE_OS_1.search(first_line)
    if m:
        return m.group(1).strip()
    m = RE_OS_2.search(first_line)
    if m:
        return m.group(1).strip()
    return None

def has_domain_controller(first_line: str) -> bool:
    return "DOMAIN CONTROLLER" in first_line.upper()

def is_adjusted(first_line: str) -> bool:
    up = first_line.upper()
    return ("AJUSTADA" in up) or re.search(r"\bAJU\b", up) is not None

def make_scan_name(cliente: str, y: int, m: int, d: int, *, es_control_static: bool, es_ajustada: bool) -> str:
    base = f"{cliente}-hardening"
    if es_control_static:
        base += "-control-statics"
    base += f"-{y}-{MESES_ES[m]}-{d:02d}"
    if es_ajustada:
        base += "-ajustado"
    return base

def make_periodo(y: int, m: int, d: int) -> str:
    return f"{d}/{m}/{y}"
