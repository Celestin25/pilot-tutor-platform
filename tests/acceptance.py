"""Acceptance tests from the development brief (section 20).
Run against a server started with: ADMIN_PASSWORD=testpw LLM_MOCK=1 LLM_MOCK_DELAY_MS=1500
Usage: python3 tests/acceptance.py [base_url]
"""
import json, sys, time, datetime, urllib.request, urllib.error, concurrent.futures as cf, http.cookiejar
B = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3100"
def post(path, body, opener=None):
    req=urllib.request.Request(B+path, data=json.dumps(body).encode(), headers={"content-type":"application/json"})
    try:
        r=(opener or urllib.request).open(req) if opener else urllib.request.urlopen(req); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
cj=http.cookiejar.CookieJar()
adm=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
def aget(p): return json.loads(adm.open(B+p).read())
def apost(p,b):
    req=urllib.request.Request(B+p,data=json.dumps(b).encode(),headers={"content-type":"application/json"}); return json.loads(adm.open(req).read())
apost("/api/admin/login",{"name":"CI","password":"testpw"})
cfg=aget("/api/admin/settings")["config"]; cfg.update(duration_seconds=20, allow_custom_duration=True, provider="mock")
apost("/api/admin/settings", cfg)
created=apost("/api/admin/participants",{"action":"generate","count":12})["created"]
codes={c["participant_id"]:c["access_code"].replace("-","") for c in created}
FAILS=[]
def ok(c,m):
    print(("PASS " if c else "FAIL ")+m)
    if not c: FAILS.append(m)

s,d=post("/api/p/state",{"code":"ZZZZZZZZZZ"}); ok(s==404 and d["phase"]=="invalid","invalid code rejected")
p1=codes["P001"]
s,d=post("/api/p/state",{"code":p1}); ok(d["phase"]=="waiting","unapproved -> waiting, no timer")
s,d=post("/api/p/start",{"code":p1}); ok(s==403,"cannot start before approval")
apost("/api/admin/participants",{"action":"ready","ids":list(codes)})
# concurrent arrivals: each participant 3 parallel requests
with cf.ThreadPoolExecutor(36) as ex:
    res=list(ex.map(lambda c: post("/api/p/state",{"code":c}), [c for c in codes.values() for _ in range(3)]))
ok(all(d["phase"]=="ready" for _,d in res),"all 12 ready after concurrent entry")
rows=aget("/api/admin/sessions")["rows"]
sess=[r for r in rows if r["session_id"]]
ok(len(sess)==12 and len({r["session_id"] for r in sess})==12,"exactly one session per participant")
ctl=sum(r["condition"]=="control" for r in sess); ok(ctl==6,f"balanced allocation control={ctl} treatment={12-ctl}")
ok("condition" not in json.dumps(res[0][1]) and "treatment" not in json.dumps(res[0][1]),"participant state hides group")
g1={r["participant_id"]:r["condition"] for r in sess}
# start twice in parallel -> same deadline
with cf.ThreadPoolExecutor(3) as ex: st=list(ex.map(lambda _: post("/api/p/start",{"code":p1}),range(3)))
ok(len({d["expires_at"] for _,d in st})==1,"parallel start -> one deadline")
exp=st[0][1]["expires_at"]
s,d=post("/api/p/state",{"code":p1,"reconnect":True}); ok(d["expires_at"]==exp and len(d["messages"])==1,"reconnect keeps deadline; opening message saved")
# chat + duplicate request id
s,d=post("/api/p/chat",{"code":p1,"request_id":"req00000001","text":"Bonjour, hello é à"})
ok(s==200 and "mock" in d["reply"],"chat reply")
s2,d2=post("/api/p/chat",{"code":p1,"request_id":"req00000001","text":"Bonjour, hello é à"})
ok(s2==200 and len(d2["state"]["messages"])==3,"duplicate request id -> no duplicate turn")
# concurrent different requests -> one busy
with cf.ThreadPoolExecutor(2) as ex: r2=list(ex.map(lambda i: post("/api/p/chat",{"code":p1,"request_id":f"reqpar0000{i}","text":"q"+str(i)}),range(2)))
ok(sorted(x[0] for x in r2)==[200,429],f"one outstanding request per session {[x[0] for x in r2]}")
# isolation: other participant's history
p2=codes["P002"]; post("/api/p/start",{"code":p2}); s,d=post("/api/p/state",{"code":p2})
ok(len(d["messages"])==1,"independent history")
# expiry during reply
left=datetime.datetime.fromisoformat(exp.replace("Z","+00:00")).timestamp()-time.time()
time.sleep(max(0,left-0.6))
s,d=post("/api/p/chat",{"code":p1,"request_id":"reqlate00001","text":"late"})
ok(s==409 and d["state"]["phase"]=="ended" and d["state"]["end_reason"]=="time_limit","reply after expiry discarded, ended(time_limit)")
ok(not any(m["text"].startswith("(mock") and "late" in m["text"] for m in d["state"]["messages"]),"no new tutor content shown after expiry")
s,d=post("/api/p/chat",{"code":p1,"request_id":"reqlate00002","text":"x"}); ok(s==409,"chat rejected after expiry")
s,d=post("/api/p/start",{"code":p1}); ok(d["phase"]=="ended","ended cannot be restarted")
s,d=post("/api/p/final",{"code":p1}); ok(s==200 and d["url"].endswith("pid=P001"),"final link carries id: "+d.get("url",""))
# finish early
s,d=post("/api/p/finish",{"code":p2}); ok(d["phase"]=="ended" and d["end_reason"]=="participant_finished","finish early")
s,d=post("/api/p/final",{"code":p2}); ok(s==200,"final link after finish")
s,d=post("/api/p/state",{"code":codes["P001"]}); 
rows={r["participant_id"]:r for r in aget("/api/admin/sessions")["rows"]}
ok(rows["P001"]["final_assessment_link_opened"]==1 and rows["P001"]["end_reason"]=="time_limit","dashboard shows link opened + end reason")
ok(all(rows[k]["condition"]==g1[k] for k in g1),"groups unchanged after repeat entries")
det=aget("/api/admin/session/"+rows["P001"]["session_id"])
print("events:",[e["event_type"] for e in det["events"]])
print("statuses:",[(m["role"],m["delivery_status"]) for m in det["messages"]])

print(f"\n{len(FAILS)} failure(s)")
sys.exit(1 if FAILS else 0)
