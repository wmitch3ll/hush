const {P,flush,ok,gm,A,B}=require('./sim.js');
const {Sea,Word}=require('' + require('path').join(__dirname,'..','ui') + '/games-core.js');
function newGame(type,opt){P[A].G.start(B,type,opt);flush();const id=Object.keys(P[A].store.g).pop();P[B].G.answer(id,true);flush();return id}
// cheat: loser swaps board after commit
{const id=newGame('sea');
 for(const p of[A,B]){const G=P[p].G,gg=G.get(id);gg.me.board=Sea.random();gg.me.salt='0123456789abcdef'.repeat(2);G._send(id,'rdy',{h:G._sha(Sea.pack(gg.me.board,gg.me.salt))});}
 flush();const host=P[A].G.get(id).host,guest=host===A?B:A;
 P[guest].G.get(id).me.board=Sea.random(); // guest cheats: board no longer matches the commitment
 let n=0;const order=[...Array(100).keys()];
 while(P[A].G.get(id).status==='play'&&n++<400){const g=P[A].G.get(id);const who=g.turn;if(!who){flush();continue}
   if(g.await){flush();continue}const sh=g.shots[who]||[];const pool=who===host?order:order.slice().reverse();const i=pool.filter(x=>!sh.includes(x)).slice(0,Math.min(3,100-sh.length));P[who].G._send(id,'sh',i);flush();}
 const h=P[host].G.get(id);console.log(h.end);ok(h.end.why==='cheat'||P[guest].G.get(id).end.why==='cheat','cheat flagged by '+(h.cheat?'host':'guest'));}
// word race
{const id=newGame('word',{secs:180});const a=P[A].G.get(id),b=P[B].G.get(id);ok(a.word&&a.word===b.word,'same word '+a.word);
 const W=a.word;
 // A solves in 3, B fails
 const gA=['house','crane',W];const patsA=[];
 for(const [p,gs] of[[A,['crane','house',W]],[B,['crane','crane','house','later','those','water']]]){const g=P[p].G.get(id);g.mine.start=Date.now()-5000;
   for(const w of gs){g.mine.gs.push(w);g.mine.pat.push(Word.score(w,W));P[p].G._send(id,'gs',Word.score(w,W));}
   P[p].G._send(id,'fin',{gs:g.mine.gs,ms:p===A?30000:60000,solved:g.mine.gs.at(-1)===W});}
 flush({shuffle:1,dup:1,echo:1});
 const x=P[A].G.get(id),y=P[B].G.get(id);console.log(x.end,x.mine.fin,x.th.fin);
 ok(x.status==='done'&&y.status==='done'&&x.end.w===y.end.w,'word race resolved, winner '+(x.end.w===A?'A':x.end.w===B?'B':'none'));}
console.log('end');
