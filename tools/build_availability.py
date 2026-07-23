#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
캠핑캐치 — 실시간 '진짜' 빈자리 크롤러 (1차 골격)

읽기가능(공공·자체) 캠핑장의 예약 페이지에서 이번 주말 자리 유무를 확인해
js/availability.js 를 생성한다. 대시보드는 CC.AVAIL[id] 가 있으면 예측 대신
'🟢 자리있음 (N분 전)'을 실데이터로 표시한다.

── 현재 상태(2026-07 POC 결과) ─────────────────────────────
읽기가능 채널은 실재하나, 각 예약 시스템이 SPA·세션·IP차단이라
"단순 HTTP 요청"만으로는 대부분 자리 수를 못 뽑는다(POC에서 확인).
  · camperstory(자체 SaaS): 자리 API 인증벽 없음 → 여기 구현(SOURCES['camperstory'])
  · 공공(국립공원 knps/숲나들e/공단): 페이지에 잔여수 노출되나 세션·JS 필요
    → Playwright(헤드리스 브라우저) 크롤러가 정석. 다음 마일스톤.
따라서 지금은 "골격 + camperstory 파서"만 두고, 나머지는 예측 레이어(predict.js)가 덮는다.

사용:  python3 tools/build_availability.py
출력:  js/availability.js  (CC.AVAIL = {id:{status,remain,source,date,checkedAt}})
"""
import json, os, re, sys, urllib.request, urllib.parse
from datetime import date, timedelta

HERE = os.path.dirname(__file__)
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126 Safari/537.36")

def this_weekend():
    """가장 가까운 토(체크인)~일(체크아웃)."""
    t = date.today()
    sat = t + timedelta((5 - t.weekday()) % 7)   # 이번 주 토요일
    return sat, sat + timedelta(1)

def http(url, data=None, headers=None, timeout=20):
    req = urllib.request.Request(url, data=(urllib.parse.urlencode(data).encode() if data else None),
                                 headers={"User-Agent": UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read().decode("utf-8", "replace")

# ── 소스별 파서 ──────────────────────────────────────────────
def parse_camperstory(campseq, sdt, edt):
    """r.camperstory.com 자체 SaaS. axCampSiteInfo.hbb → 구역별 cnt(잔여).
       ※ 일부 캠프는 장기예약(long_fee) 스키마 버그로 500 → None 처리(예측이 덮음)."""
    try:
        st, body = http(
            "http://r.camperstory.com/inc/axCampSiteInfo.hbb",
            data={"tp": "campsite", "campseq": str(campseq),
                  "res_dt": sdt.isoformat(), "res_edt": edt.isoformat(),
                  "res_month": sdt.strftime("%Y-%m")},
            headers={"X-Requested-With": "XMLHttpRequest",
                     "Referer": f"http://r.camperstory.com/resMain.hbb?campseq={campseq}"})
        if st != 200 or "OLE DB" in body or "error" in body.lower():
            return None
        cnts = [int(x) for x in re.findall(r'data-cnt="(\d+)"', body)]  # 구역별 잔여
        if not cnts:
            return None
        remain = sum(cnts)
        return {"status": "open" if remain > 0 else "full", "remain": remain}
    except Exception:
        return None

# 읽기가능 캠핑장 → 소스 매핑 (검증되며 확장). campseq 등 소스별 식별자 필요.
SOURCES = {
    # "id(고캠핑 contentId)": {"src":"camperstory", "campseq":1790, "label":"춘천 더숲"},
    # 공공(knps/foresttrip/pcfac)은 Playwright 크롤러 붙일 때 여기에 추가.
}

def main():
    sdt, edt = this_weekend()
    avail = {}
    for cid, cfg in SOURCES.items():
        res = None
        if cfg["src"] == "camperstory":
            res = parse_camperstory(cfg["campseq"], sdt, edt)
        if res:
            res.update({"source": cfg.get("label", cfg["src"]),
                        "date": sdt.isoformat(),
                        "checkedAt": None})  # 실행 시각은 배포 파이프라인에서 stamp
            avail[cid] = res
            print(f"  ✓ {cfg.get('label',cid)}: {res['status']} {res.get('remain','')}")
        else:
            print(f"  · {cfg.get('label',cid)}: 자리 못 읽음(예측이 대체)")

    meta = {"generatedAt": None, "weekend": [sdt.isoformat(), edt.isoformat()],
            "note": f"읽기가능 {len(SOURCES)}곳 시도 · 확보 {len(avail)}곳 (나머지는 예측)"}
    hdr = ("/* 자동생성 · tools/build_availability.py — 실시간 진짜 빈자리.\n"
           "   CC.AVAIL[id] 있으면 카드가 '🟢 자리있음(N분전)' 실데이터 표시. */\n")
    body = ("window.CC=window.CC||{};\nCC.AVAIL=" + json.dumps(avail, ensure_ascii=False)
            + ";\nCC.AVAIL_META=" + json.dumps(meta, ensure_ascii=False) + ";\n")
    open(os.path.join(HERE, "..", "js", "availability.js"), "w", encoding="utf-8").write(hdr + body)
    print(f"생성: js/availability.js · 실데이터 {len(avail)}곳 / 이번주말 {sdt}~{edt}")

if __name__ == "__main__":
    main()
