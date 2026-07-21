#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
예약처/홈페이지 링크 검증기 (게시 전 실행)

js/sites.js 에 구운 resveUrl·homepage 를 '브라우저와 동일하게' 열어보고
확실히 죽은 링크만 골라 js/links.js 로 내보낸다. 앱은 그 목록을 읽어
죽은 링크는 네이버 검색으로 자동 폴백한다(→ 404 방지).

브라우저와 맞추기 위한 처리:
  - URL 뒤 탭/개행/공백 제거, JS 이스케이프(\\/, \\t 등) 해제  (고캠핑 데이터에 흔함)
  - 한글 도메인(예: 홍천제이글램핑.kr)은 IDNA(퓨니코드) 인코딩
  - 401/403/405/406/429 = 봇차단·인증·메서드 제한 → '살아있음'(페이지는 존재)

죽음 판정(보수적, 확실한 것만):
  404 · 410 · DNS 실패 · 연결 거부 · 타임아웃 · 명백한 오타 도메인

사용:
  python3 tools/check_links.py           # 리포트만
  python3 tools/check_links.py --emit    # 리포트 + js/links.js 생성(앱이 사용)
"""
import re, sys, json, socket, ssl
import urllib.request, urllib.error
from urllib.parse import urlsplit, urlunsplit, quote
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITES = ROOT / "js" / "sites.js"
LINKS = ROOT / "js" / "links.js"

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")

OBVIOUS_BAD = [r"instargram\.com"]           # instagram 오타
ALIVE_CODES = {401, 403, 405, 406, 429}      # 봇차단·인증 → 페이지 존재로 간주
DEAD_CODES = {404, 410}                       # 확실히 없음


def parse_sites(text):
    out = []
    for block in re.findall(r"\{[^{}]*\}", text):
        def g(k):
            m = re.search(r'"?' + k + r'"?\s*:\s*"((?:[^"\\]|\\.)*)"', block)
            return m.group(1) if m else ""
        if g("name"):
            out.append({"id": g("id"), "name": g("name"),
                        "resveUrl": g("resveUrl"), "homepage": g("homepage")})
    return out


def norm(v):
    """브라우저의 normUrl과 동일: JS 이스케이프 해제 + 공백/탭 제거 → 유효 URL이면 반환"""
    if not v:
        return ""
    v = (v.replace("\\/", "/").replace("\\t", " ").replace("\\n", " ")
          .replace("\\r", " ").replace('\\"', '"').replace("\\\\", "\\"))
    v = v.strip()
    if not v:
        return ""
    if re.match(r"^https?://", v, re.I):
        return v
    if re.match(r"^[\w.\-가-힣]+\.[a-z가-힣]{2,}([/?#]|$)", v, re.I):
        return "https://" + v
    return ""


def to_ascii(u):
    """한글 도메인 IDNA 인코딩 + 경로 non-ASCII 퍼센트 인코딩 (브라우저 동작 재현)"""
    p = urlsplit(u)
    host = p.hostname or ""
    try:
        ehost = host.encode("idna").decode("ascii")
    except Exception:
        ehost = host.encode("ascii", "ignore").decode("ascii") or host
    netloc = ehost + (":" + str(p.port) if p.port else "")
    path = quote(p.path or "/", safe="/%:@&=+$,;~*!'()")
    query = quote(p.query, safe="/%:@&=+$,;~*!'()?")
    return urlunsplit((p.scheme, netloc, path, query, p.fragment))


def check(url):
    for pat in OBVIOUS_BAD:
        if re.search(pat, url, re.I):
            return ("dead", "오타/폐도메인")
    try:
        req_url = to_ascii(url)
    except Exception:
        return ("dead", "URL 파싱 실패")
    req = urllib.request.Request(req_url, method="GET", headers={
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "ko,en;q=0.8",
    })
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE           # 캠핑장 사이트 인증서 만료 흔함 → 접속가능만 본다
    try:
        with urllib.request.urlopen(req, timeout=12, context=ctx) as r:
            return ("ok", f"HTTP {r.getcode()}")
    except urllib.error.HTTPError as e:
        if e.code in ALIVE_CODES:
            return ("ok", f"HTTP {e.code}(차단/인증·존재)")
        if e.code in DEAD_CODES:
            return ("dead", f"HTTP {e.code}")
        return ("ok", f"HTTP {e.code}(모호·유지)")   # 400/5xx 등은 보수적으로 살림
    except urllib.error.URLError as e:
        reason = str(getattr(e, "reason", e))
        if "Name or service not known" in reason or "nodename nor servname" in reason \
           or "getaddrinfo" in reason or "Name does not resolve" in reason:
            return ("dead", "DNS 실패")
        if "refused" in reason.lower():
            return ("dead", "연결 거부")
        if "timed out" in reason.lower():
            return ("dead", "타임아웃")
        return ("ok", f"기타({reason[:24]})·유지")     # 일시적 오류는 살림
    except (socket.timeout, TimeoutError):
        return ("dead", "타임아웃")
    except Exception as e:
        return ("ok", f"예외({type(e).__name__})·유지")


def main():
    emit = "--emit" in sys.argv
    text = SITES.read_text(encoding="utf-8")
    sites = parse_sites(text)

    jobs = []
    for s in sites:
        for field in ("resveUrl", "homepage"):
            u = norm(s[field])
            if u:
                jobs.append((s, field, u))

    print(f"검증 대상: {len(jobs)}개 링크 (사이트 {len(sites)}곳)\n")

    def run(job):
        s, field, u = job
        label, detail = check(u)
        return (s, field, u, label, detail)

    link = {}   # id -> {"r":0/"h":0}  (죽은 것만 기록)
    dead = []
    with ThreadPoolExecutor(max_workers=12) as ex:
        for s, field, u, label, detail in ex.map(run, jobs):
            mark = "✅" if label == "ok" else "❌"
            print(f"{mark} [{field:9}] {s['name'][:15]:15} {detail:22} {u[:56]}")
            if label == "dead":
                dead.append((s, field, u, detail))
                key = "r" if field == "resveUrl" else "h"
                link.setdefault(s["id"], {})[key] = 0

    print("\n" + "=" * 60)
    dead_r = [d for d in dead if d[1] == "resveUrl"]
    dead_h = [d for d in dead if d[1] == "homepage"]
    print(f"전체 {len(jobs)} · 살아있음 {len(jobs)-len(dead)} · 죽음 {len(dead)} "
          f"(예약링크 {len(dead_r)} · 홈페이지 {len(dead_h)})")
    if dead:
        print("\n❌ 죽은 링크 → 앱에서 네이버 검색으로 폴백:")
        for s, field, u, detail in dead:
            print(f"   - {s['name']} [{field}] {detail}")

    if emit:
        body = ",\n".join(f'  "{sid}": {json.dumps(v, ensure_ascii=False)}'
                          for sid, v in sorted(link.items()))
        js = ("/* 자동생성 (tools/check_links.py --emit) — 직접 수정 금지\n"
              "   확실히 죽은 링크만 기록. r=예약링크,h=홈페이지 (0=죽음).\n"
              "   앱은 이 목록의 링크를 네이버 검색으로 폴백한다. */\n"
              "window.CC = window.CC || {};\n"
              "CC.LINK = {\n" + body + ("\n" if body else "") + "};\n")
        LINKS.write_text(js, encoding="utf-8")
        print(f"\n💾 생성: {LINKS}  (죽은 링크 보유 사이트 {len(link)}곳)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
