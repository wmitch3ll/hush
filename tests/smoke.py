import os,tempfile
import subprocess,time,sys,json
from playwright.sync_api import sync_playwright
srv=subprocess.Popen([sys.executable,'-m','http.server','8793','-d',''+os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","ui")+''],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1)
MOCK='''
window.__calls=[];window.__ev={};
const STATE={settings:{search:'duckduckgo',custom_search:'',theme:'system',counter:true,ui:{}},bookmarks:[{title:'A',url:'https://a.com',folder:''}],custom_filters:[],allow_sites:[],site_dark:{},session:[],boosts:{},stats:{total:5,week:2,week_id:1},history:[],spaces:[]};
const dflt=(c,a)=>{ if(c==='get_state')return JSON.parse(JSON.stringify(STATE)); if(/^(list_|get_|history_|bookmarks_)/.test(c)) return []; return null };
window.__TAURI__={core:{invoke:async(c,a)=>{window.__calls.push(c);return dflt(c,a)},convertFileSrc:x=>x},event:{listen:async(e,f)=>{(window.__ev[e]=window.__ev[e]||[]).push(f);return ()=>{}},emit:async()=>{}},
 window:{getCurrentWindow:()=>({listen:async()=>()=>{},onResized:async()=>()=>{},setTitle:async()=>{},isMaximized:async()=>false,onCloseRequested:async()=>()=>{},innerSize:async()=>({width:1200,height:800}),scaleFactor:async()=>1})}};
'''
which=sys.argv[1]; vp={'width':390,'height':780} if which=='mobile' else {'width':1280,'height':800}
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport=vp,has_touch=(which=='mobile')); pg=ctx.new_page(); errs=[]
    pg.on('requestfailed',lambda r:errs.append('REQFAIL '+r.url)); pg.on('response',lambda r:errs.append('HTTP%d '%r.status+r.url) if r.status>=400 else 0); pg.on('pageerror',lambda e:errs.append('PAGEERR '+str(e)+' '+(e.stack or '')[:500]))
    pg.on('console',lambda m:errs.append('CONSOLE '+m.text) if m.type=='error' else 0)
    pg.add_init_script(MOCK); pg.goto(f'http://localhost:8793/'+('mobile' if which=='mobile' else 'index')+'.html'); pg.wait_for_timeout(2500)
    pg.screenshot(path=os.path.join(tempfile.gettempdir(),f'sm_{which}.png'))
    print(which,'errors:',len(errs)); [print(' ',e[:300]) for e in errs[:25]]
    print('invoked:',sorted(set(pg.evaluate('window.__calls'))))
srv.kill(); sys.exit(1 if errs else 0)
