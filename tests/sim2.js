const {P,flush,ok,gm,A,B}=require('./sim.js');
const {Sea,Word}=require('' + require('path').join(__dirname,'..','ui') + '/games-core.js');
function newGame(type,opt){P[A].G.start(B,type,opt);flush({shuffle:1,dup:1,echo:1});const id=Object.keys(P[A].store.g).pop();P[B].G.answer(id,true);flush({shuffle:1,dup:1,echo:1});return id}
// battleship
{const id=newGame('sea');
 for(const p of[A,B]){const g=P[p].store.g[id];const G=P[p].G;
   // emulate placement UI: set board+salt then rdy
   const gg=G.get(id);gg.me.board=Sea.random();gg.me.salt='0123456789abcdef'.repeat(2);G._send(id,'rdy',{h:G._sha(Sea.pack(gg.me.board,gg.me.salt))});}
 flush({shuffle:1,dup:1,echo:1});
 let a=P[A].G.get(id),b=P[B].G.get(id);ok(a.phase==='battle'&&b.phase==='battle','battle started, turn host '+(a.turn===a.host));
 const shotsLeft={[A]:[...Array(100).keys()].sort(()=>Math.random()-.5),[B]:[...Array(100).keys()].sort(()=>Math.random()-.5)};
 let n=0;while(P[A].G.get(id).status==='play'&&n++<300){const g=P[A].G.get(id);const who=g.turn;if(!who||g.await){flush({shuffle:1,dup:1,echo:1});continue}
   const need=Math.min(3,shotsLeft[who].length);const sv=[];for(let q=0;q<need;q++)sv.push(shotsLeft[who].pop());P[who].G._send(id,'sh',sv);flush({shuffle:1,dup:1,echo:1});}
 a=P[A].G.get(id);b=P[B].G.get(id);ok(a.status==='done'&&b.status==='done','game over after '+n+' turns');
 ok(a.end.w===b.end.w&&a.end.why==='fleet'&&b.end.why==='fleet','agree, no cheat flagged: '+a.end.why);
 ok(!a.cheat&&!b.cheat&&a.revealed2!==undefined,'reveal done '+!!a.revealed2+' '+!!b.revealed2);
 // out of turn shot rejected
 ok(P[A].G._send(id,'sh',[5,6,7])===false,'no shots after game');}
// battleship cheating: defender lies about a hit (reports miss on a ship cell)
{const id=newGame('sea');
 for(const p of[A,B]){const G=P[p].G,gg=G.get(id);gg.me.board=Sea.random();gg.me.salt='fedcba9876543210'.repeat(2);G._send(id,'rdy',{h:G._sha(Sea.pack(gg.me.board,gg.me.salt))});}
 flush();
 // Make B (the non-host maybe) tamper: after the game, B's revealed board changed -> mismatch. Simulate by editing B's stored board before the final reveal.
 const g0=P[A].G.get(id);const shooter=g0.turn,def=shooter===A?B:A;
 const defBoard=P[def].G.get(id).me.board;const cells=defBoard.map((v,i)=>v>=0?i:-1).filter(x=>x>=0);
 // shooter sinks everything, defender answers honestly except tamper reveal
 let n=0;const miss=[...Array(100).keys()].filter(i=>defBoard[i]<0);
 const mine=[...cells];
 // defender needs turns too: they shoot anything
 const dshots=[...Array(100).keys()];
 const dg=P[def].G.get(id);
 // tamper: defender swaps its stored board AFTER commit
 P[def].store.g[id].me.board=Sea.random();P[def].G.get; // force reload
 // reload store into G by re-init is not possible; so test tamper via raw checks instead
}
console.log('battleship done');
