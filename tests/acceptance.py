"""Acceptance tests for the within-subject study platform.
Run against a server started with: ADMIN_PASSWORD=testpw LLM_MOCK=1 LLM_MOCK_DELAY_MS=1500
Usage: python3 tests/acceptance.py [base_url]
"""
import json, sys, time, datetime, csv, io, itertools, urllib.request, urllib.error, concurrent.futures as cf, http.cookiejar

B = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3100"
cj = http.cookiejar.CookieJar()
adm = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
FAILS = []

def ok(c, m):
    print(("PASS " if c else "FAIL ") + m)
    if not c: FAILS.append(m)

def post(path, body):
    req = urllib.request.Request(B + path, data=json.dumps(body).encode(), headers={"content-type": "application/json"})
    try:
        r = urllib.request.urlopen(req); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")

def aget(p, raw=False):
    r = adm.open(B + p).read()
    return r.decode("utf-8-sig") if raw else json.loads(r)

def apost(p, b):
    req = urllib.request.Request(B + p, data=json.dumps(b).encode(), headers={"content-type": "application/json"})
    try:
        return json.loads(adm.open(req).read())
    except urllib.error.HTTPError as e:
        return {"_status": e.code, **json.loads(e.read() or b"{}")}

COND = [
    {"id": "L1", "label": "English only", "tutor_instruction": "RULE-ENGLISH-ONLY", "opening_message": "Hello"},
    {"id": "L2", "label": "French only", "tutor_instruction": "RULE-FRENCH-ONLY", "opening_message": "Bonjour"},
    {"id": "MIX", "label": "Mixed", "tutor_instruction": "RULE-MIXED", "opening_message": "Hello, bonjour"},
]
FLOW = {
    "conditions": COND, "order_mode": "counterbalanced",
    "sections": {
        "start": [{"id": "welcome", "items": [{"id": "w", "type": "info", "text": "Welcome"}]}],
        "per_condition": [
            {"id": "task", "items": [{"id": "chat", "type": "chat", "duration_seconds": 30, "text": "Chat now",
                                      "tutor_task": {"all": "", "by": {"L1": "TOPIC-A", "L2": "TOPIC-B", "MIX": "TOPIC-C"}}}]},
            {"id": "ratings", "items": [
                {"id": "understanding", "type": "slider", "text": {"all": "How well?", "by": {"L2": "Comment?"}}, "min": 0, "max": 10, "start": 5, "required": True},
                {"id": "lang", "type": "mc", "text": "Language used", "options": ["English", "French", "Both"], "required": True}]},
        ],
        "end": [{"id": "demographics", "items": [
            {"id": "age", "type": "mc", "text": "Age", "options": ["18-25", "26+"], "required": True},
            {"id": "l1", "type": "text", "text": "First language", "required": True},
            {"id": "fr_level", "type": "slider", "text": "French level", "min": 0, "max": 10, "start": 5, "required": True}]}],
    },
    "end_message": "THANK-YOU-END", "end_url": "",
}

apost("/api/admin/login", {"name": "CI", "password": "testpw"})
cfg = aget("/api/admin/settings")["config"]
cfg.update(provider="mock", flow_json=json.dumps(FLOW))
r = apost("/api/admin/settings", cfg)
ok(r.get("ok") is True, f"study design saved ({r.get('prompt_version', r)})")
bad = dict(FLOW, sections=dict(FLOW["sections"], end=[{"id": "x", "items": [{"id": "age", "type": "slider", "min": 5, "max": 1}]}]))
r = apost("/api/admin/settings", dict(cfg, flow_json=json.dumps(bad)))
ok(r.get("_status") == 400, "invalid design rejected (duplicate ID, bad slider range)")

created = apost("/api/admin/participants", {"action": "generate", "count": 12})["created"]
codes = {c["participant_id"]: c["access_code"].replace("-", "") for c in created}

s, d = post("/api/p/state", {"code": "ZZZZZZZZZZ"}); ok(s == 404 and d["phase"] == "invalid", "invalid code rejected")
p1 = codes["P001"]
s, d = post("/api/p/state", {"code": p1}); ok(d["phase"] == "waiting", "unapproved participant waits")
s, d = post("/api/p/start", {"code": p1}); ok(s == 403, "cannot start before approval")
apost("/api/admin/participants", {"action": "ready", "ids": list(codes)})

with cf.ThreadPoolExecutor(36) as ex:
    res = list(ex.map(lambda c: post("/api/p/state", {"code": c}), [c for c in codes.values() for _ in range(3)]))
ok(all(d["phase"] == "ready" for _, d in res), "all 12 ready after 36 concurrent entries")
rows = {r["participant_id"]: r for r in aget("/api/admin/sessions")["rows"]}
orders = [rows[p]["condition_order"] for p in codes]
ok(all(orders), "every participant has exactly one condition order")
counts = {",".join(o): orders.count(",".join(o)) for o in itertools.permutations(["L1", "L2", "MIX"])}
ok(all(v == 2 for v in counts.values()), f"counterbalanced: each of 6 orders used twice {counts}")
s, d = post("/api/p/state", {"code": p1}); ok(rows["P001"]["condition_order"] == aget("/api/admin/sessions")["rows"][0]["condition_order"], "repeat entry keeps the same order")

order = rows["P001"]["condition_order"].split(",")
s, d = post("/api/p/start", {"code": p1}); ok(d["phase"] == "active" and d["page"]["index"] == 0, "start shows page 1 (start section)")
ok(d["page"]["total"] == 1 + 2 * 3 + 1, f"page count = start + 2 pages x 3 conditions + end ({d['page']['total']})")
s, d = post("/api/p/answer", {"code": p1, "step_key": d["page"]["key"], "answers": {}})
page = d["state"]["page"]; ok(page["chat"]["status"] == "not_started" and page["key"].startswith(f"c1.{order[0]}"), "page 2 is the first condition's chat")
s, d = post("/api/p/answer", {"code": p1, "step_key": page["key"], "answers": {}}); ok(s == 409 and d["error"] == "chat_open", "cannot skip a chat before it is finished")
with cf.ThreadPoolExecutor(3) as ex: st = list(ex.map(lambda _: post("/api/p/chat-start", {"code": p1, "step_key": page["key"]}), range(3)))
ok(len({x[1]["page"]["chat"]["remaining_ms"] // 2000 for x in st}) == 1, "parallel chat start creates one timer")
s, d = post("/api/p/chat", {"code": p1, "step_key": page["key"], "request_id": "req0000001", "text": "Bonjour é à"}); ok(s == 200 and "mock" in d["reply"], "tutor replies")
s2, d2 = post("/api/p/chat", {"code": p1, "step_key": page["key"], "request_id": "req0000001", "text": "Bonjour é à"})
ok(len(d2["state"]["page"]["chat"]["messages"]) == 3, "duplicate request id makes no duplicate turn")
with cf.ThreadPoolExecutor(2) as ex: r2 = list(ex.map(lambda i: post("/api/p/chat", {"code": p1, "step_key": page["key"], "request_id": f"reqpar000{i}", "text": f"q{i}"}), range(2)))
ok(sorted(x[0] for x in r2) == [200, 429], "one outstanding tutor request per chat")
det = aget("/api/admin/participant/P001")
ok(f"RULE-{ {'L1':'ENGLISH-ONLY','L2':'FRENCH-ONLY','MIX':'MIXED'}[order[0]] }" in det["chats"][0]["system_prompt"] and
   f"TOPIC-{ {'L1':'A','L2':'B','MIX':'C'}[order[0]] }" in det["chats"][0]["system_prompt"], "chat 1 uses the first condition's language rule and topic")
s, d = post("/api/p/chat-finish", {"code": p1, "step_key": page["key"]}); ok(d["page"]["chat"]["status"] == "ended", "participant can finish a chat early")
s, d = post("/api/p/answer", {"code": p1, "step_key": page["key"], "answers": {}}); page = d["state"]["page"]
ok(page["key"].endswith("ratings"), "after chat: the rating page")
ok(page["items"][0]["text"] == ("Comment?" if order[0] == "L2" else "How well?"), "question text varies by condition")
s, d = post("/api/p/answer", {"code": p1, "step_key": page["key"], "answers": {"lang": "English"}}); ok(s == 400 and "understanding" in d["errors"], "untouched required slider is rejected")
s, d = post("/api/p/answer", {"code": p1, "step_key": page["key"], "answers": {"understanding": 11, "lang": "English"}}); ok(s == 400, "out-of-range slider value rejected")
s, d = post("/api/p/answer", {"code": p1, "step_key": page["key"], "answers": {"understanding": 7, "lang": "Klingon"}}); ok(s == 400, "unknown multiple-choice option rejected")
with cf.ThreadPoolExecutor(3) as ex:
    rs = list(ex.map(lambda _: post("/api/p/answer", {"code": p1, "step_key": page["key"], "answers": {"understanding": 7, "lang": "English"}, "page_seconds": 9.5}), range(3)))
s, d = post("/api/p/state", {"code": p1}); ok(d["page"]["index"] == 3 and d["page"]["key"].startswith(f"c2.{order[1]}"), "double submit advances exactly one page; part 2 uses the second condition")

# part 2: chat expiry with a reply in progress
k = d["page"]["key"]; post("/api/p/chat-start", {"code": p1, "step_key": k})
det = aget("/api/admin/participant/P001"); exp = [c for c in det["chats"] if c["step_key"] == k][0]["expires_at"]
time.sleep(max(0, datetime.datetime.fromisoformat(exp.replace("Z", "+00:00")).timestamp() - time.time() - 0.6))
s, d = post("/api/p/chat", {"code": p1, "step_key": k, "request_id": "reqlate001", "text": "late"})
ok(s == 409 and d["state"]["page"]["chat"]["status"] == "ended" and d["state"]["page"]["chat"]["end_reason"] == "time_limit", "reply finishing after the deadline is discarded; chat ended (time_limit)")
ok(not any("late" in m["text"] and m["role"] == "assistant" for m in d["state"]["page"]["chat"]["messages"]), "no tutor content shown after the deadline")
s, d = post("/api/p/chat", {"code": p1, "step_key": k, "request_id": "reqlate002", "text": "x"}); ok(s == 409, "chat rejected after the deadline")

# finish the rest
def finish_all(code):
    for _ in range(20):
        s, d = post("/api/p/state", {"code": code})
        if d["phase"] != "active": return d
        pg = d["page"]
        if pg.get("chat") and pg["chat"]["status"] != "ended":
            post("/api/p/chat-start", {"code": code, "step_key": pg["key"]}); post("/api/p/chat-finish", {"code": code, "step_key": pg["key"]})
        ans = {}
        for it in pg["items"]:
            if it["type"] == "slider": ans[it["id"]] = 6
            if it["type"] == "mc": ans[it["id"]] = it["options"][0]
            if it["type"] == "text": ans[it["id"]] = "Arabic, français"
        post("/api/p/answer", {"code": code, "step_key": pg["key"], "answers": ans})
    return post("/api/p/state", {"code": code})[1]
d = finish_all(p1)
ok(d["phase"] == "ended" and d["end_reason"] == "completed" and d["end_message"] == "THANK-YOU-END", "study completes with the thank-you message")
det = aget("/api/admin/participant/P001")
ok([c["condition"] for c in sorted(det["chats"], key=lambda c: c["position"])] == order, "three chats, one per condition, in the assigned order")
last = [r for r in det["responses"] if r["section"] == "end"]
ok(len(last) == 3 and all(r["step_index"] == 7 for r in last), "demographic answers are collected at the end")
s, d = post("/api/p/start", {"code": p1}); ok(d["phase"] == "ended", "a finished participant cannot restart")

p2 = codes["P002"]; post("/api/p/start", {"code": p2}); s, d = post("/api/p/state", {"code": p2})
ok(d["page"]["index"] == 0 and "chat" not in d["page"], "participants have independent progress")
r = apost("/api/admin/participant/P002", {"action": "stop", "end_reason": "withdrawn", "reason": "test"})
s, d = post("/api/p/state", {"code": p2}); ok(d["phase"] == "ended" and d["end_reason"] == "withdrawn", "researcher can stop a participant")

wide = list(csv.DictReader(io.StringIO(aget("/api/admin/export/responses-wide?scope=participants", raw=True))))
row = [w for w in wide if w["participant_id"] == "P001"][0]
ok(all(row.get(f"understanding_{c}") for c in ["L1", "L2", "MIX"]) and row["l1"] == "Arabic, français", "wide export: one column per question per condition, accents kept")
long = list(csv.DictReader(io.StringIO(aget("/api/admin/export/responses?scope=participants", raw=True))))
ok(len([x for x in long if x["participant_id"] == "P001"]) == 9, "long export: 9 answers for P001 (2 x 3 conditions + 3 demographics)")
msgs = list(csv.DictReader(io.StringIO(aget("/api/admin/export/messages?scope=participants", raw=True))))
ok({m["condition"] for m in msgs if m["participant_id"] == "P001"} == {"L1", "L2", "MIX"}, "message export labels each chat with its condition")

r = apost("/api/admin/participants", {"action": "delete", "ids": ["P001"]}); ok(r.get("kept") == ["P001"], "started participant is not deleted without confirmation")
r = apost("/api/admin/participants", {"action": "delete", "ids": ["P001"], "force": True, "reason": "test"}); ok(r.get("deleted") == ["P001"], "forced delete works")
s, d = post("/api/p/state", {"code": p1}); ok(s == 404, "deleted participant's code no longer works")

print(f"\n{len(FAILS)} failure(s)")
sys.exit(1 if FAILS else 0)
