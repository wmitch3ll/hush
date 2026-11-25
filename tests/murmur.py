# Murmur delivery test: a message written before any relay is connected must wait in the outbox, survive a restart,
# go out when a relay connects, and clear once the relay confirms it.
import os,subprocess,sys,time,json
from playwright.sync_api import sync_playwright
UI=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','ui')
srv=subprocess.Popen([sys.executable,'-m','http.server','8795','-d',UI],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1)
KEY='11'*32; PEER='22'*32
MOCK='''
window.__calls=[];window.__ev={};window.__opened=[];window.__sent=[];window.__n=0;
try{window.__sec=JSON.parse(localStorage.getItem('t.sec')||'{}')}catch(e){window.__sec={}}
if(!window.__sec['murmur-key']){window.__sec['murmur-key']='%s';localStorage.setItem('t.sec',JSON.stringify(window.__sec))}
const STATE={settings:{search:'duckduckgo',custom_search:'',theme:'system',counter:true,ui:{}},bookmarks:[],custom_filters:[],allow_sites:[],site_dark:{},sessions:[]};
window.__TAURI__={core:{invoke:async(c,a)=>{window.__calls.push(c);
 if(c==='get_state')return JSON.parse(JSON.stringify(STATE));
 if(c==='secret_get')return window.__sec[a.name]||null; if(c==='secret_set'){window.__sec[a.name]=a.value;return null}
 if(c==='msg_ws_open'){window.__opened.push(a.url);return ++window.__n}
 if(c==='msg_ws_send'){if(window.__dead)throw 'gone';window.__sent.push([a.id,JSON.parse(a.data)]);return null}
 if(/^(list_|get_|history_|bookmarks_)/.test(c))return []; return null},convertFileSrc:x=>x},
 event:{listen:async(e,f)=>{(window.__ev[e]=window.__ev[e]||[]).push(f);return ()=>{}},emit:async()=>{}},
 window:{getCurrentWindow:()=>({listen:async()=>()=>{},onResized:async()=>()=>{},setTitle:async()=>{},isMaximized:async()=>false,onCloseRequested:async()=>()=>{},innerSize:async()=>({width:1200,height:800}),outerSize:async()=>({width:1200,height:800}),scaleFactor:async()=>1})}};
'''%KEY
fails=[]
def ok(n,c):
    print(('ok   ' if c else 'FAIL ')+n)
    if not c: fails.append(n)
def fire(pg,payload): pg.evaluate("p=>(window.__ev['msg-ws']||[]).forEach(f=>f({payload:p}))",payload)
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':1280,'height':800}); pg=ctx.new_page(); errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.add_init_script(MOCK); pg.goto('http://localhost:8795/index.html'); pg.wait_for_timeout(2500)
    ok('relays are being opened',pg.evaluate('window.__opened.length')>0)
    pg.evaluate("HM.api.sendTo('%s','hello there')"%PEER); pg.wait_for_timeout(500)
    ob=lambda: pg.evaluate("JSON.parse(localStorage.getItem('hush.msg.outbox')||'{}')")
    ok('message waits in the outbox while no relay is open',len(ob())>=1 and not pg.evaluate("window.__sent.some(x=>x[1][0]==='EVENT')"))
    pg.reload(); pg.wait_for_timeout(2500)   # app restart
    ok('outbox survives a restart',len(ob())>=1)
    fire(pg,{'id':1,'t':'open'}); pg.wait_for_timeout(600)
    ev=pg.evaluate("window.__sent.filter(x=>x[1][0]==='EVENT').map(x=>x[1][1])")
    ok('stored message is sent when a relay connects',len(ev)>=1 and ev[0]['kind']==1059)
    eid=ev[0]['id'] if ev else ''
    fire(pg,{'id':1,'t':'msg','d':json.dumps(['OK',eid,True,''])}); pg.wait_for_timeout(500)
    ok('outbox clears once the relay confirms',eid not in ob())
    st=pg.evaluate("Object.values(JSON.parse(localStorage.getItem('hush.msg.chats')||'{}')).flat().map(m=>m.status)")
    ok('message shows as sent',st and st[-1]=='sent')
    # a dead connection is noticed when sending fails, and the app reconnects
    n0=pg.evaluate('window.__opened.length'); pg.evaluate('window.__dead=true'); pg.evaluate("HM.api.sendTo('%s','second')"%PEER); pg.wait_for_timeout(9000)
    ok('a failed send triggers a reconnect',pg.evaluate('window.__opened.length')>n0)
    ok('no page errors',not errs)
    if errs: print(errs[:3])
srv.kill(); sys.exit(1 if fails else 0)
