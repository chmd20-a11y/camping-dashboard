#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
채널 enrichment 결과 → js/channels.js 생성 (대시보드가 카드에 '실제 예약채널·온라인여부' 표시용)
입력: tools/final_channels.json, tools/channels.json, scratchpad/lookup_result_*.json
출력: js/channels.js  (CC.CHAN = {id:{p,r,on,cl,url}})
"""
import json, glob, os
HERE=os.path.dirname(__file__)
SP="/private/tmp/claude-501/-Users-happysolar-Desktop-02-Claude/c7f0fe80-c663-4fa7-aa0e-44de68676764/scratchpad"

final={r['id']:r for r in json.load(open(os.path.join(HERE,'final_channels.json'),encoding='utf-8'))}
base ={r['id']:r for r in json.load(open(os.path.join(HERE,'channels.json'),encoding='utf-8'))}
looked={}
for f in sorted(glob.glob(os.path.join(SP,'lookup_result_*.json'))):
    for r in json.load(open(f,encoding='utf-8')):
        looked[r['id']]=r

PLAT_KO={'self':'자체예약','naver':'네이버예약','camfit':'캠핏','thankq':'땡큐캠핑',
         'campingtalk':'캠핑톡','camplink':'캠프링크','public':'공공예약',
         'phone_only':'전화예약','unknown':'채널확인중'}

out={}
for cid,f in final.items():
    b=base.get(cid,{}); lk=looked.get(cid,{})
    cl=b.get('resveCl','')
    url=(lk.get('url') or b.get('resveUrl') or '').strip()
    out[cid]={
        'p':f['platform'],               # platform code
        'pk':PLAT_KO.get(f['platform'],f['platform']),  # 한글 라벨
        'r':f['readability'],            # yes/partial/no/unknown
        'on':1 if '온라인' in cl else 0, # 온라인실시간예약 여부
        'cl':cl,
        'url':url,
    }

hdr=("/* ============================================================\n"
     "   캠핑캐치 — channels.js (자동생성 · tools/build_channels.py)\n"
     "   출처: 고캠핑 resveCl + 예약채널 조사(2026-07). 각 캠핑장의 실제\n"
     "   예약채널·온라인실시간예약 여부·자리읽기 가능성. 직접 수정 금지.\n"
     "   ============================================================ */\n")
body=("window.CC=window.CC||{};\nCC.CHAN="+json.dumps(out,ensure_ascii=False,separators=(',',':'))+";\n")
dst=os.path.join(HERE,'..','js','channels.js')
open(dst,'w',encoding='utf-8').write(hdr+body)

from collections import Counter
print("생성: js/channels.js ·", len(out), "곳")
print("온라인예약:", sum(v['on'] for v in out.values()), "곳 · 읽기가능(yes):",
      sum(1 for v in out.values() if v['r']=='yes'), "곳")
print("플랫폼:", dict(Counter(v['p'] for v in out.values())))
