import subprocess, json

NODE = r"C:\Users\helib\.workbuddy\binaries\node\versions\22.22.2-2\node.exe"
SERVER = r"C:\Users\helib\dsh-cn-disclosure\cn-disclosure-mcp-server.mjs"

SAMPLES = {
  "减持": "关于股东减持股份计划的公告。XX科技股份有限公司（证券简称：XX股份）于2026年3月15日收到股东张三函告，拟自2026年4月1日起6个月内，通过集中竞价方式减持不超过1200万股（占公司总股本3.5%）。减持原因为自身资金需求。",
  "业绩+分红": "2025年年度报告摘要。公司2025年实现营业收入58.32亿元，同比增长23.5%；归属于上市公司股东的净利润9.74亿元，同比增长18.2%；基本每股收益1.25元。公司拟向全体股东每10股派发现金红利5.00元（含税）。",
  "解禁": "关于首次公开发行前已发行股份上市流通的提示性公告。本次解除限售的股份数量为4500万股，占公司总股本的15.0%，上市流通日期为2026年5月20日。",
}

def rpc(m): return json.dumps(m, ensure_ascii=False)
p = subprocess.Popen([NODE, SERVER], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8')
def send(m): p.stdin.write(rpc(m)+"\n"); p.stdin.flush()
def read():
    while True:
        line = p.stdout.readline()
        if not line: return None
        line = line.strip()
        if not line: continue
        try: return json.loads(line)
        except: continue

send({"jsonrpc":"2.0","id":1,"method":"initialize","params":{}})
print("INIT:", read().get("result",{}).get("serverInfo"))
send({"jsonrpc":"2.0","method":"notifications/initialized","params":{}})
send({"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}})
print("TOOLS:", [t["name"] for t in read()["result"]["tools"]])

# stats
send({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"disclosure_stats","arguments":{}}})
print("\n=== disclosure_stats ===\n"+read()["result"]["content"][0]["text"])

for i,(k,v) in enumerate(SAMPLES.items()):
    send({"jsonrpc":"2.0","id":10+i,"method":"tools/call","params":{"name":"extract_disclosure","arguments":{"text":v}}})
    r = read()
    print(f"\n========== 样本: {k} ==========")
    print(r["result"]["content"][0]["text"])

p.stdin.close()
try: p.wait(timeout=5)
except: p.kill()
print("\n[selftest done]")
