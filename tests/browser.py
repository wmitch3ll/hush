"""Browser tests (Playwright + Chromium): vault screens, reader view, PDF viewer, downloads list. Run: python3 tests/browser.py"""
import base64, os, subprocess, sys, time
from playwright.sync_api import sync_playwright
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..')); UI = os.path.join(ROOT, 'ui'); SRC = os.path.join(ROOT, 'src-tauri', 'src')
FAIL = []
def ok(c, m):
    print(('ok   ' if c else 'FAIL ') + m)
    if not c: FAIL.append(m)
VARS = ':root{--bg:#f5f5f4;--card:#fff;--line:#e4e4e2;--ink:#161616;--mute:#8b8b88}body{margin:0}'
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8791', '-d', ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
B = 'http://localhost:8791/'
try:
  with sync_playwright() as p:
    br = p.chromium.launch(); errs = []
    def page(w=390, h=780):
        pg = br.new_page(viewport={'width': w, 'height': h}); pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(B + 'tests/blank.html'); return pg
    open(os.path.join(ROOT, 'tests', 'blank.html'), 'w').write('<!doctype html><meta charset=utf-8><style>' + VARS + '</style><div id=r style="position:fixed;inset:0;overflow:auto;padding:14px"></div>')
    # ---- vault ----
    pg = page()
    for f in ['importer.js', 'vault.js', 'vault-ui.js']: pg.add_script_tag(url=B + 'ui/' + f)
    pg.evaluate("""HXVUI.open(document.getElementById('r'),{host:'github.com',readForm:async()=>JSON.stringify({has:true,host:'github.com',user:'me',pass:'S3cret!pass'}),fill:i=>window.__f=i,copy:s=>window.__c=s,toast:m=>0,range:async p=>'',bookmarks:async i=>i.length,close(){}})""")
    pg.fill('#pw', 'correct horse battery'); pg.fill('#pw2', 'correct horse battery'); pg.click('#go'); pg.wait_for_selector('#q')
    pg.click('[data-save]'); pg.wait_for_selector('.it'); ok(pg.evaluate('HXV.all().length') == 1, 'vault: saved login from page form')
    pg.click('[data-fill]'); ok(pg.evaluate('window.__f && window.__f.user') == 'me', 'vault: fill hands the login to the page')
    pg.click('.it'); pg.click('#sh'); ok(pg.inner_text('#pv') == 'S3cret!pass', 'vault: reveal password')
    pg.click('[data-v=list]'); pg.click('[data-v=import]'); pg.fill('#t', '<DT><A HREF="https://a.com">A</A>'); pg.click('#pp'); pg.click('#ib'); ok('1 new' in pg.inner_text('#er'), 'vault: bookmark import')
    pg.click('[data-v=list]'); pg.click('[data-v=gen]'); pg.wait_for_selector('#out'); ok(len(pg.inner_text('#out')) == 20, 'vault: generator')
    pg.click('[data-v=list]'); pg.click('[data-lock]'); pg.wait_for_selector('#go'); ok(pg.inner_text('#go') == 'Unlock', 'vault: lock screen after locking')
    # ---- reader ----
    para = lambda n: '<p>' + ('The city council voted on Tuesday to approve the new stadium plan, which supporters say will bring jobs, while critics point to the cost. ' * 3) + f'({n})</p>'
    art = '<!doctype html><meta charset=utf-8><title>T</title><meta property="og:site_name" content="Daily Paper"><meta name=author content="Jane Roe"><header><nav><a href=/>Home</a></nav></header><ul class=side><li><a href=/a>Related</a></li></ul><div id=content class=post><h1>Council approves stadium</h1>' + ''.join(para(i) for i in range(8)) + '</div><footer><a href=/x>About</a></footer>'
    open(os.path.join(ROOT, 'tests', 'article.html'), 'w').write(art)
    pg = page(); pg.goto(B + 'tests/article.html'); pg.add_script_tag(url=B + 'src-tauri/src/page.js'); pg.evaluate('__hushPage.reader()')
    ok(pg.evaluate("document.querySelectorAll('#hush-reader p').length") >= 8, 'reader: keeps the article paragraphs')
    ok(not pg.evaluate("!!document.querySelector('#hush-reader nav, #hush-reader footer, #hush-reader .side')"), 'reader: drops navigation and sidebars')
    ok('Daily Paper' in pg.inner_text('#hush-reader .by') and 'min read' in pg.inner_text('#hush-reader .by'), 'reader: byline and reading time')
    pg = page(); pg.goto(B + 'tests/article.html'); pg.add_script_tag(url=B + 'src-tauri/src/page.js')
    pg.evaluate("document.querySelector('footer').innerHTML='<a href=\"/legal/privacy-policy\">Privacy Policy</a> <a href=/terms>Terms</a>'")
    ok(pg.evaluate("JSON.parse(__hushPage.policy()).url").endswith('/legal/privacy-policy'), 'privacy: finds the policy link in the footer')
    # ---- privacy check screen ----
    pg = page(); pg.add_script_tag(url=B + 'ui/autopilot.js')
    pol = ' We provide the service and keep things running every day for everyone who uses it around the world.' * 14
    pg.evaluate("t=>HXPA.open(document.getElementById('r'),{host:'example.com',getPolicy:async()=>({url:'https://example.com/privacy',text:t}),ask:null,close(){}})", 'We may sell your personal information to data brokers. We share your information with advertising partners. We use tracking pixels.' + pol)
    pg.wait_for_selector('.pa .g'); ok(pg.inner_text('.pa .g') in ('D', 'F'), 'privacy: grade shown for an invasive policy')
    ok(pg.evaluate("document.querySelectorAll('.pa .f').length") >= 2, 'privacy: evidence cards shown')
    # ---- game day ----
    pg = page(); pg.add_script_tag(url=B + 'ui/scores.js'); pg.add_script_tag(url=B + 'ui/gameday.js')
    pg.evaluate("""()=>{const ev=(id,hs,as,state,win)=>({id,date:new Date(Date.now()+36e5).toISOString(),status:{type:{state,shortDetail:state==='post'?'Final':'7:30 PM'}},competitions:[{odds:[{details:'BOS -3.5',overUnder:221.5}],competitors:[{homeAway:'home',score:String(hs),winner:win==='h',team:{id:'2',abbreviation:'BOS',shortDisplayName:'Celtics'}},{homeAway:'away',score:String(as),winner:win==='a',team:{id:'5',abbreviation:'NYK',shortDisplayName:'Knicks'}}]}]});
      const A={pref:k=>k==='sp_leagues'?'nba':'',setPref:async()=>{},toast(){},open(u){window.__o=u},inv:async(c,a)=>{if(c==='scores_get')return JSON.stringify({events:[ev('g1',0,0,'pre',''),ev('g2',110,102,'post','h')]});
        if(c==='news_get')return JSON.stringify({articles:[{headline:'Celtics win again',description:'d',published:new Date().toISOString(),links:{web:{href:'https://www.espn.com/nba/story/_/id/1'}}}]});
        if(c==='feed_get')return '<rss><channel><item><title>Feed story</title><link>https://hyperfeast.com/p/1</link><pubDate>Mon, 09 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>';}};
      HXGD.open(document.getElementById('r'),A)}""")
    pg.wait_for_selector('.gd .g'); ok(pg.evaluate("document.querySelectorAll('.gd .g').length") == 2, 'gameday: games listed')
    ok('BOS -3.5' in pg.inner_text('.gd'), 'gameday: betting line shown')
    pg.click('[data-pick$=":2"]'); ok(pg.evaluate("JSON.parse(localStorage.getItem('hush.gd.picks'))['nba:g1'].t") == '2', 'gameday: pick saved')
    pg.evaluate("localStorage.setItem('hush.gd.picks',JSON.stringify({'nba:g2':{t:'2',at:1}}))"); pg.click('[data-tab=news]'); pg.click('[data-tab=games]'); pg.wait_for_timeout(300)
    pg.evaluate("HXGD.grade([{lg:'nba',id:'g2',state:'post',a:{id:'5',win:false},h:{id:'2',win:true}}])"); ok(pg.evaluate("JSON.parse(localStorage.getItem('hush.gd.rec')).w") == 1, 'gameday: pick graded as a win')
    pg.click('[data-tab=news]'); pg.wait_for_selector('.gd .n'); ok(pg.evaluate("document.querySelectorAll('.gd .n').length") == 2, 'gameday: headlines from ESPN and the feed')
    # ---- memory ----
    pg = page(); pg.add_script_tag(url=B + 'ui/brain.js')
    ok(pg.evaluate("HXBR.skipUrl('https://www.chase.com/accounts')") and pg.evaluate("HXBR.skipUrl('http://example.com/a')") and not pg.evaluate("HXBR.skipUrl('https://news.example.com/story/1')"), 'memory: skips banking, login and non-https pages')
    pg.evaluate("""async()=>{await HXBR.clear();const t='The city council debated the new stadium financing plan for hours before voting. '.repeat(8);
      await HXBR.save({url:'https://news.example.com/stadium',host:'news.example.com',title:'Council votes on stadium plan',text:t});
      await HXBR.save({url:'https://cooking.example.com/bread',host:'cooking.example.com',title:'Sourdough bread guide',text:'Flour water salt and a long slow rise. '.repeat(20)});
      window.__st={pref:()=>'on',setPref:async()=>{},toast(){},open(u){window.__o=u},ask:async(p,on)=>{window.__p=p;on('Answer [1]')}};HXBR.open(document.getElementById('r'),window.__st)}""")
    pg.wait_for_selector('#q'); pg.fill('#q', 'stadium vote'); ok(pg.evaluate("document.querySelectorAll('.br .r').length") == 1 and 'stadium' in pg.inner_text('.br .r').lower(), 'memory: search finds the right page only')
    pg.click('[data-ask]'); pg.wait_for_timeout(300); ok('ONLY these pages' in pg.evaluate('window.__p') and 'Answer [1]' in pg.inner_text('.br .ai'), 'memory: AI answers from the saved pages')
    pg.click('.br .r'); ok(pg.evaluate('window.__o') == 'https://news.example.com/stadium', 'memory: result opens the page')
    # ---- PDF ----
    pg = br.new_page(); pg.set_content('<h1>Report</h1>' + ''.join(f'<h2 style="page-break-before:always">Section {i}</h2><p>Revenue grew in Q{i}.</p>' for i in range(1, 5))); pdf = pg.pdf(format='A4')
    pg = page(); pg.add_script_tag(url=B + 'ui/pdf.js')
    pg.evaluate("""async b64=>{const u=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));window.V=await HXPDF.open(document.getElementById('r'),{data:u.buffer,name:'report.pdf',close(){window.__closed=1},summarize:t=>window.__sum=t,toast:()=>0})}""", base64.b64encode(pdf).decode())
    pg.wait_for_selector('.pv-p canvas', timeout=20000)
    ok(pg.evaluate("document.querySelectorAll('.pv-p').length") == 5, 'pdf: all pages laid out')
    pg.click('[data-a=find]'); pg.fill('.pv-find input', 'revenue'); pg.press('.pv-find input', 'Enter'); pg.wait_for_timeout(800); ok('/ 4' in pg.inner_text('#fc'), 'pdf: search finds every match')
    pg.click('[data-a=sum]'); pg.wait_for_timeout(600); ok('Revenue grew' in (pg.evaluate('window.__sum') or ''), 'pdf: text handed to the summarizer')
    pg.click('[data-a=close]'); ok(pg.evaluate('window.__closed') == 1, 'pdf: close')
    # ---- downloads persist ----
    pg = page(); pg.add_script_tag(url=B + 'ui/extras.js')
    stub = "const A={inv:async()=>null,pref:()=>'',setPref(){},toast(){},state:()=>({settings:{ui:{}},bookmarks:[]}),mobile:false,act(){}};"
    pg.evaluate("()=>{" + stub + "window.HX=HushX(A);for(let i=0;i<7;i++){HX.dl.event({id:i,name:'f'+i+'.pdf',url:'https://h.com/'+i,state:'started'});HX.dl.event({id:i,name:'f'+i+'.pdf',state:'done',size:1000})}HX.dl.list(document.getElementById('r'),{})}")
    pg.fill('[data-dq]', 'f3'); ok(pg.evaluate("document.querySelectorAll('.dl-r').length") == 1, 'downloads: search filters the list')
    pg.reload(); pg.add_script_tag(url=B + 'ui/extras.js'); ok(pg.evaluate("(()=>{" + stub + "return HushX(A).dl.items.length})()") == 7, 'downloads: history survives a restart')
    ok(not errs, 'no page errors: ' + str(errs[:2]))
finally:
    srv.kill()
sys.exit(1 if FAIL else 0)
