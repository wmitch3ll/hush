const vm=require('vm'),fs=require('fs'),crypto=require('crypto');
const U='' + require('path').join(__dirname,'..','ui') + '/';
const A='a'.repeat(64),B='b'.repeat(64),names={[A]:'Ann',[B]:'Bob'};
const net=[];
function mk(pk,peer){
  const store={g:{}};const ctx={console,TextEncoder,setTimeout:(f,t)=>{timers.push(f);return 1},setInterval:()=>0,clearInterval(){},crypto:crypto.webcrypto,navigator:{},JSON,Math,Date,Set,Array,Object,Number,String,Uint8Array,Uint32Array,DataView,parseInt,isFinite,Error};
  ctx.window=ctx;ctx.document={getElementById:()=>1,querySelector:()=>null,addEventListener(){},removeEventListener(){}};
  vm.createContext(ctx);
  for(const f of['games-core.js','wordlist.js','games.js'])vm.runInContext(fs.readFileSync(U+f,'utf8'),ctx,{filename:f});
  const G=ctx.HUSH_GAMES;
  G.init({me:()=>pk,get:()=>JSON.parse(JSON.stringify(store.g)),set:v=>{store.g=JSON.parse(JSON.stringify(v));},name:p=>names[p],toast:t=>{},repaint(){},send:(key,obj)=>net.push({to:peer,from:pk,text:JSON.stringify(obj)})});
  G.open=()=>{};
  return {G,store,pk,peer};
}
const timers=[];
const P={[A]:mk(A,B),[B]:mk(B,A)};
function flush(o={}){let g=0;while((net.length||timers.length)&&g++<20000){while(timers.length)timers.shift()();if(!net.length)break;const i=o.shuffle?Math.floor(Math.random()*net.length):0;const m=net.splice(i,1)[0];
  P[m.to].G.recv(m.from,m.from,m.text,false);if(o.dup&&Math.random()<.4)P[m.to].G.recv(m.from,m.from,m.text,false);
  // echo to sender's other device
  if(o.echo)P[m.from].G.recv(m.to,m.from,m.text,true);}}
const ok=(c,m)=>{console.log(c?'ok  ':'FAIL',m);if(!c)process.exitCode=1};
ok(P[A].G._sha('abc')===crypto.createHash('sha256').update('abc').digest('hex'),'sha256');
ok(P[A].G._sha('é'.repeat(100))===crypto.createHash('sha256').update('é'.repeat(100)).digest('hex'),'sha256 utf8');
const gm=(p)=>Object.values(P[p].store.g)[0];
module.exports={P,flush,ok,gm,A,B};
if(require.main===module){
// ---- chess with shuffled/duplicated delivery
P[A].G.start(B,'chess');flush({shuffle:1,dup:1,echo:1});
let ga=gm(A),gb=gm(B);ok(ga&&gb&&ga.id===gb.id&&ga.status==='invite','invite delivered');
P[B].G.answer(gb.id,true);flush({shuffle:1,dup:1,echo:1});ga=gm(A);gb=gm(B);ok(ga.status==='play'&&gb.status==='play','accepted');
// whoever is white moves
const {Chess}=require('' + require('path').join(__dirname,'..','ui') + '/games-core.js');
const wh=pk=>ga.seed&&((parseInt(ga.seed[0],16)&1)?(pk===A?'w':'b'):(pk===A?'b':'w'));
const seq=['f2f3','e7e5','g2g4','d8h4'];
for(const mv of seq){const who=P[A].G.get(ga.id).st.t===wh(A)?A:B;const g0=P[who].G.get(ga.id);const sendOk=(()=>{const before=net.length;/*find sendMsg through public? */return true})();
  // use internal path: UI uses sendMsg via play(); emulate through a message by calling recv-less API
  P[who].G._send(g0.id,'mv',mv);flush({shuffle:1,dup:1,echo:1});}
ga=gm(A);gb=gm(B);ok(ga.status==='done'&&gb.status==='done','chess finished '+ga.end.why);ok(ga.end.why==='mate'&&gb.end.why==='mate','mate on both');
ok(ga.moves.join()===gb.moves.join()&&ga.end.w===gb.end.w,'both agree on winner '+ga.end.w);
}
