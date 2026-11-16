// Shared, mode-agnostic UI helpers: card rendering, banners, overlays, sfx,
// and the peek/swap visual flourishes. Used by both local-game.js (vs AI /
// pass & play) and multiplayer.js (online rooms).

const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const SUITS = ['♠','♥','♦','♣'];
const RED = new Set(['♥','♦']);
function cv(r){if(r==='A')return 1;if(r==='K')return 0;if(r==='J')return 11;if(r==='Q')return 12;if(r==='JOKER')return-2;return+r;}
function isSpec(r){return['7','8','9','10','J','Q','K'].includes(r);}
function specDesc(r){return{7:'Look at one of your own cards',8:'Look at one of your own cards',9:"Look at one opponent's card",10:"Look at one opponent's card",J:"Skip the next player's turn",Q:'Swap one of your cards with an opponent card, unseen',K:'Look at your card, then swap it with an opponent card'}[r]||'';}
const POWERS={
  7:{icon:'👁',name:'Peek',desc:'Look at one of your own cards'},
  8:{icon:'👁',name:'Peek',desc:'Look at one of your own cards'},
  9:{icon:'🔍',name:'Spy',desc:"Look at one opponent's card"},
  10:{icon:'🔍',name:'Spy',desc:"Look at one opponent's card"},
  J:{icon:'⏭',name:'Skip',desc:"Skip the next player's turn"},
  Q:{icon:'🔀',name:'Blind swap',desc:"Swap one of your cards with an opponent's, unseen"},
  K:{icon:'👑',name:'Seen swap',desc:"Look at your card, then swap it with an opponent's"},
};
// Big, clear choices while you hold a drawn card (rendered into the action bar).
// o: {card, fromDiscard, onDiscard, onPower}
function drawnActions(o){
  let box=document.createElement('div');box.className='drawn-acts';
  let pw=!o.fromDiscard&&POWERS[o.card.rank];
  if(pw){
    let b=document.createElement('button');b.className='big-act power';
    b.innerHTML=`<span class="ba-icon">${pw.icon}</span><span class="ba-txt"><b>Use ${esc(o.card.rank)} · ${pw.name}</b><small>${pw.desc}</small></span>`;
    b.onclick=o.onPower;box.appendChild(b);
  }
  let row=document.createElement('div');row.className='ba-row';
  let sw=document.createElement('button');sw.className='big-act swap';
  sw.innerHTML='<span class="ba-icon">⇅</span><span class="ba-txt"><b>Keep it</b><small>Tap a card in your hand to swap</small></span>';
  sw.onclick=()=>{let h=document.getElementById('ycards');if(h){h.classList.remove('nudge');void h.offsetWidth;h.classList.add('nudge');}};
  row.appendChild(sw);
  if(!o.fromDiscard){
    let d=document.createElement('button');d.className='big-act discard';
    d.innerHTML='<span class="ba-icon">🗑</span><span class="ba-txt"><b>Discard</b><small>Throw it away'+(pw?' (no power)':'')+'</small></span>';
    d.onclick=o.onDiscard;row.appendChild(d);
  }
  box.appendChild(row);
  return box;
}
// Discard pile fanned out: the last few cards peek out under the top one so
// everyone can see what was recently thrown away.
function buildDiscardPile(recent,canTake,onTake,matchedTop){
  let wrap=document.createElement('div');wrap.className='disc-stack';
  let n=recent.length;
  recent.slice(0,-1).forEach((c,k)=>{
    let depth=n-1-k;
    let u=mkCard(c,true);u.classList.add('under');
    let rot=(depth%2?-1:1)*(6+depth*4);
    u.style.transform=`translate(${(depth%2?-1:1)*depth*7}px,${-depth*3}px) rotate(${rot}deg)`;
    wrap.appendChild(u);
  });
  let top=mkCard(recent[n-1],true,{clickable:canTake});
  top.id='disc-top';
  if(canTake)top.onclick=onTake;
  if(matchedTop){let m=document.createElement('div');m.className='matched-tag';m.textContent='MATCHED';m.title='Already matched — wait for a new discard';top.appendChild(m);}
  wrap.appendChild(top);
  return wrap;
}
// "History" button under the pile + the list it opens.
const HOW={discard:{i:'↓',t:'threw away'},swap:{i:'⇅',t:'swapped out'},power:{i:'✨',t:'used the power of'},match:{i:'🎯',t:'matched with'}};
function historyButton(count,getEntries){
  let el=document.getElementById('disc-cnt');
  el.innerHTML='';
  let b=document.createElement('button');b.className='hist-btn';b.innerHTML=`📜 History · ${count}`;
  b.title='See the last cards thrown on the pile';
  b.onclick=()=>showHistory(getEntries());
  el.appendChild(b);
}
// entries newest first: {name, rank, suit, how, you}
function showHistory(entries){
  let rows=entries.length?entries.map((e,k)=>{
    let h=HOW[e.how]||HOW.discard;
    let cls=e.rank==='JOKER'?'jk':(RED.has(e.suit)?'rd':'');
    return `<div class="hrow" style="animation-delay:${k*40}ms"><span class="hico">${h.i}</span><span class="htxt"><b>${esc(e.you?'You':e.name)}</b> ${h.t}</span><span class="mini ${cls}">${e.rank==='JOKER'?'🃏':esc(e.rank)+esc(e.suit)}</span></div>`;
  }).join(''):'<div class="dim-note">Nothing has been thrown on the pile yet this round.</div>';
  showOv('Discard pile',`<div class="hlist">${rows}</div><div class="dim-note">Newest first · last 12 cards</div>`,[{t:'Close',c:'ab pri',fn:closeOv}],{wide:true});
}

// Power badge shown on the drawn card itself.
function powerBadge(cardEl,rank,fromDiscard){
  if(fromDiscard||!POWERS[rank])return;
  let b=document.createElement('div');b.className='pw-badge';b.textContent=POWERS[rank].icon+' '+POWERS[rank].name;
  cardEl.appendChild(b);
}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
const SUIT_NAMES={'♠':'spades','♥':'hearts','♦':'diamonds','♣':'clubs','★':''};
function cardName(c){if(!c||!c.rank||c.rank==='?')return'face-down card';if(c.rank==='JOKER')return'Joker';return c.rank+' of '+SUIT_NAMES[c.suit];}

// ── persisted settings ──
const Settings=(function(){
  let d={sound:true,memoryAid:false,turnTimer:true};
  try{Object.assign(d,JSON.parse(localStorage.getItem('cabo_settings')||'{}'));}catch(e){}
  return{get:k=>d[k],set:(k,v)=>{d[k]=v;try{localStorage.setItem('cabo_settings',JSON.stringify(d));}catch(e){}}};
})();
const REDUCED_MOTION=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// How long the "memorize your cards" window lasts at the start of a hand.
const MEMORIZE_MS=4000;
// Seconds per turn for human players (online uses the same value server-side).
const TURN_SECONDS=45;
function specLbl(r){return{7:'Peek Own',8:'Peek Own',9:'Peek Opp',10:'Peek Opp',J:'Skip Turn',Q:'Blind Swap',K:'Seen Swap'}[r]||'';}

function mkCard(c,faceUp,opts={}){
  let{clickable=false,hl='',sel=false,knownG=false}=opts;
  let el=document.createElement('div');
  let cls='card ';
  if(!faceUp) cls+='back';
  else{let isJ=c.rank==='JOKER',isR=RED.has(c.suit);cls+='face '+(isJ?'joker':(isR?'red':'blk'));}
  if(clickable) cls+=' clickable';
  if(sel) cls+=' sel';
  if(hl==='swap') cls+=' hl-swap';
  if(hl==='peek') cls+=' hl-peek';
  if(hl==='discard') cls+=' hl-discard';
  if(knownG&&!sel&&!hl) cls+=' known-g';
  el.className=cls.trim();
  if(!faceUp) el.innerHTML='<div class="blogo">C</div>';
  else el.innerHTML=`<div class="cc tl">${c.rank}<br>${c.suit}</div><div class="cv">${c.rank}</div><div class="cs">${c.suit}</div><div class="cc br">${c.rank}<br>${c.suit}</div>`;
  el.setAttribute('aria-label',faceUp?cardName(c):'face-down card');
  if(clickable){
    el.setAttribute('role','button');el.tabIndex=0;
    el.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&el.onclick){e.preventDefault();el.onclick();}});
  }
  return el;
}
function mkBtn(t,c,fn){let b=document.createElement('button');b.className=c;b.textContent=t;b.onclick=fn;return b;}

// ── seat status (under each player's name) ──
// While a player is on turn: spinner + "Thinking…/Deciding…" + a progress bar
// (a countdown when a deadline is known, otherwise an indeterminate sweep).
// Otherwise: their last move, so you can see what just happened.
function seatStatus(o){
  let el=document.createElement('div');el.className='seat-status';
  if(o.active){
    el.classList.add('busy');
    el.innerHTML=`<div class="ss-row"><span class="spin"></span><span>${esc(o.label)}</span></div><div class="ss-bar"><i></i></div>`;
    let bar=el.querySelector('i');
    if(o.deadline&&o.totalMs){
      let left=Math.max(0,o.deadline-Date.now());
      bar.style.width=(100*left/o.totalMs)+'%';
      requestAnimationFrame(()=>requestAnimationFrame(()=>{bar.style.transition=`width ${left}ms linear`;bar.style.width='0%';}));
    }else bar.classList.add('sweep');
  }else if(o.text){
    el.classList.add('done');
    el.innerHTML=`<div class="ss-row"><span class="tick">✓</span><span>${esc(o.text)}</span></div>`;
  }
  return el;
}
// 2×2 hand: cards 1–2 sit in the back row (nearest the owner), 3–4 in the
// front row facing the table. Opponents are at the top, so their back row is
// the top row (natural order); your hand is at the bottom, so it's flipped.
function placeSlot(wrap,idx,bottomSeat){if(bottomSeat)wrap.style.order=idx<2?1:0;}
// Your turn has started: pulse your hand, buzz phones, soft chime.
function yourTurnCue(){
  let hz=document.querySelector('.hz');
  if(hz){hz.classList.remove('your-turn');void hz.offsetWidth;hz.classList.add('your-turn');}
  try{if(Settings.get('sound')&&navigator.vibrate)navigator.vibrate(35);}catch(e){}
  sfx('turn');
}

// ── flash effects ──
function flashPeekBlur(cardElId, card, label, rerenderFn){
  let cardEl=document.getElementById(cardElId);
  if(!cardEl) return;
  let blurCard=mkCard(card||{rank:'?',suit:''},false,{});
  blurCard.classList.add('peek-blurred');
  blurCard.id=cardElId;
  blurCard.style.position='relative';
  let lbl=document.createElement('div');
  lbl.className='peek-label';
  lbl.innerHTML='<div class="pk-eye">&#128065;</div>'+(label?'<div class="pk-name">'+label+'</div>':'');
  blurCard.appendChild(lbl);
  cardEl.replaceWith(blurCard);
  if(typeof FX!=='undefined'){FX.lift(blurCard);FX.ring(blurCard,'good');}
  sfx('peek');
  setTimeout(()=>rerenderFn(),1400);
}
function flashPeekReveal(cardElId, card, label, rerenderFn){
  let cardEl=document.getElementById(cardElId);
  if(!cardEl) return;
  let revCard=mkCard(card,true,{});
  revCard.classList.add('peek-revealed');
  revCard.id=cardElId;
  revCard.style.position='relative';
  let lbl=document.createElement('div');
  lbl.className='peek-label gold';
  lbl.innerHTML='<div class="pk-eye">&#128065;</div>'+(label?'<div class="pk-name">'+label+'</div>':'');
  revCard.appendChild(lbl);
  cardEl.replaceWith(revCard);
  if(typeof FX!=='undefined'){FX.lift(revCard);FX.burst(revCard,'',10);}
  sfx('reveal');
  setTimeout(()=>rerenderFn(),2000);
}
function flashSwapGlow(cardElId){
  let cardEl=document.getElementById(cardElId);
  if(!cardEl) return;
  cardEl.classList.add('ai-swap-flash');
  setTimeout(()=>{if(cardEl.parentNode)cardEl.classList.remove('ai-swap-flash');},600);
}

// ── SFX ── (synth engine lives in audio.js)
function sfx(type){if(typeof Sound!=='undefined')Sound.play(type);}

// ── overlay / banner ──
function showOv(title,body,btns,opts={}){
  document.getElementById('ov').classList.toggle('solid',!!opts.solid);
  document.getElementById('ov').classList.toggle('wide',!!opts.wide);
  document.getElementById('ovt').textContent=title;
  document.getElementById('ovb').innerHTML=body;
  let bb=document.getElementById('ovbtns');bb.innerHTML='';
  btns.forEach(x=>{let b=document.createElement('button');b.className=x.c;b.textContent=x.t;b.onclick=x.fn;bb.appendChild(b);});
  document.getElementById('ov').classList.add('show');
}
function closeOv(){document.getElementById('ov').classList.remove('show','solid','wide');}

// Round / game result screen shared by local and online play.
// d: {names, roundScores, totals, winners, caboBy, caboLost, resets, gameOver, you, hands, target}
function showRoundResult(d,btns){
  const target=d.target||100;
  const n=d.names.length;
  const minTot=Math.min(...d.totals);
  // rank by this round's score (or by total when the game is over)
  const key=i=>d.gameOver?d.totals[i]:d.roundScores[i]+(d.caboLost&&i===d.caboBy?5:0);
  let order=d.names.map((_,i)=>i).sort((a,b)=>key(a)-key(b));
  let winSet=d.gameOver?order.filter(i=>d.totals[i]===minTot):d.winners;
  let youWon=winSet.includes(d.you);
  let winNames=winSet.map(i=>i===d.you?'You':d.names[i]);
  let heroTitle=youWon
    ?(winSet.length>1?'You tied for the win!':(d.gameOver?'You win the game!':'You win the round!'))
    :`${winNames.join(' & ')} ${winSet.length>1?'tie':'wins'} ${d.gameOver?'the game':'the round'}`;
  let heroSub=d.gameOver
    ?`Final score ${d.totals[winSet[0]]} — lowest total after someone passed ${target}.`
    :`Lowest hand: ${d.roundScores[winSet[0]]} point${d.roundScores[winSet[0]]===1?'':'s'}.`;
  let medal=['🥇','🥈','🥉','4th'];
  let place=0,prev=null;
  let rows=order.map((i,k)=>{
    if(key(i)!==prev){place=k;prev=key(i);}
    let isWin=winSet.includes(i);
    let tags='';
    if(i===d.you)tags+='<span class="rt you">YOU</span>';
    if(i===d.caboBy)tags+=`<span class="rt cabo">CABO${d.caboLost?' ✗':' ✓'}</span>`;
    let hand=(d.hands&&d.hands[i]||[]).map(c=>`<span class="mini ${c.rank==='JOKER'?'jk':RED.has(c.suit)?'rd':''}">${c.rank==='JOKER'?'🃏':esc(c.rank)+esc(c.suit)}</span>`).join('');
    let pen=d.caboLost&&i===d.caboBy?'<span class="rpen">+5</span>':'';
    let pct=Math.min(100,100*d.totals[i]/target);
    let danger=d.totals[i]>=target*0.8?' danger':'';
    return `<div class="rrow${isWin?' win':''}${i===d.you?' me':''}" style="animation-delay:${k*120}ms">
      <div class="rpos">${isWin?'👑':(medal[place]||(place+1)+'th')}</div>
      <div class="rmain">
        <div class="rname">${esc(i===d.you?'You':d.names[i])}${tags}</div>
        <div class="rhand">${hand}</div>
        <div class="rtot"><div class="rbar${danger}"><i style="width:${pct}%"></i></div><span>${d.totals[i]} / ${target}</span></div>
      </div>
      <div class="rscore"><b>${d.roundScores[i]}</b>${pen}<small>${d.gameOver?'last hand':'this round'}</small></div>
    </div>`;
  }).join('');
  let notes='';
  if(d.caboLost)notes+=`<div class="ov-note bad">${esc(d.caboBy===d.you?'You':d.names[d.caboBy])} called Cabo but didn't have the lowest hand — +5 penalty.</div>`;
  else if(d.caboBy>=0&&d.caboBy!==undefined&&d.caboBy!==-1)notes+=`<div class="ov-note good">${esc(d.caboBy===d.you?'You':d.names[d.caboBy])} called Cabo and made it!</div>`;
  (d.resets||[]).forEach(nm=>{notes+=`<div class="ov-note good">${esc(nm)} hit exactly ${target} — reset to 50!</div>`;});
  showOv(d.gameOver?'Game Over':'Round Over',
    `<div class="hero${youWon?' won':''}"><div class="hero-ic">${youWon?'🏆':'👑'}</div><div><div class="hero-t">${esc(heroTitle)}</div><div class="hero-s">${esc(heroSub)}</div></div></div>`+
    notes+`<div class="rlist">${rows}</div>`+
    (d.gameOver?'':`<div class="dim-note">Scores add up each round. Past ${target} ends the game — lowest total wins.</div>`),btns,{wide:true});
  sfx(youWon?'win':'lose');
  if(youWon&&!REDUCED_MOTION)confetti();
}
function confetti(){
  let box=document.getElementById('ov');
  for(let i=0;i<40;i++){
    let c=document.createElement('div');c.className='confetti';
    c.style.left=Math.random()*100+'%';
    c.style.background=['#d4a843','#f0c060','#4ade80','#60a5fa','#f87171'][i%5];
    c.style.animationDelay=(Math.random()*.5)+'s';
    c.style.animationDuration=(1.6+Math.random())+'s';
    box.appendChild(c);
    setTimeout(()=>c.remove(),3200);
  }
}

// In-game settings toggles (shown inside the Menu overlay).
function settingsHTML(){
  return (typeof audioControlsHTML==='function'?audioControlsHTML():'')+
    `<div class="set-row"><span>Memory aid <small>(keep your known cards face-up)</small></span><button class="ab tog" data-set="memoryAid">${Settings.get('memoryAid')?'On':'Off'}</button></div>`+
    `<div class="set-row"><span>Turn timer <small>(${TURN_SECONDS}s per turn vs AI / pass &amp; play — always on online)</small></span><button class="ab tog" data-set="turnTimer">${Settings.get('turnTimer')?'On':'Off'}</button></div>`;
}
function bindSettings(rerender){
  if(typeof bindAudioControls==='function')bindAudioControls(document.getElementById('ovb'));
  document.querySelectorAll('#ovb [data-set]').forEach(b=>{
    b.onclick=()=>{let k=b.dataset.set;Settings.set(k,!Settings.get(k));b.textContent=Settings.get(k)?'On':'Off';updateSoundBtn();rerender&&rerender();};
  });
}
function updateSoundBtn(){
  const m=Settings.get('music'),fx=Settings.get('sound');
  const ic=m?'🎵':fx?'🔊':'🔇',lbl=`Sound settings (music ${m?'on':'off'}, effects ${fx?'on':'off'})`;
  ['sound-btn','audio-fab'].forEach(id=>{let b=document.getElementById(id);if(b){b.querySelector('.ic')?b.querySelector('.ic').textContent=ic:b.textContent=ic;b.setAttribute('aria-label',lbl);b.classList.toggle('muted',!m&&!fx);}});
}

// Banners queue up instead of overwriting each other, so quick sequences
// (e.g. an AI skip followed by a Cabo call) are all readable.
let bnrQ=[],bnrBusy=false;
function bnr(msg,type='info'){
  if(type==='cabo')caboFlash();
  const last=bnrQ[bnrQ.length-1];
  if(last&&last.msg===msg)return;
  bnrQ.push({msg,type});
  if(bnrQ.length>4)bnrQ.shift();
  if(!bnrBusy)nextBnr();
}
function nextBnr(){
  let old=document.querySelector('.bnr');if(old)old.remove();
  const item=bnrQ.shift();
  if(!item){bnrBusy=false;return;}
  bnrBusy=true;
  let b=document.createElement('div');b.className='bnr '+item.type;b.textContent=item.msg;
  b.setAttribute('role','status');
  document.getElementById('game').appendChild(b);
  setTimeout(nextBnr,bnrQ.length?1500:2400);
}
function caboFlash(){
  if(REDUCED_MOTION)return;
  let f=document.createElement('div');f.className='cabo-flash';f.innerHTML='<span>CABO!</span>';
  document.getElementById('game').appendChild(f);
  document.getElementById('game').classList.add('shake');
  setTimeout(()=>{f.remove();document.getElementById('game').classList.remove('shake');},1300);
}

// ── movement animations ──
// Capture an element's position before a re-render, then slide the new
// element from that position into place after the re-render.
function rectOf(id){let el=typeof id==='string'?document.getElementById(id):id;return el?el.getBoundingClientRect():null;}
function flyFrom(el,from,opts={}){
  if(typeof el==='string')el=document.getElementById(el);
  if(!el||!from||REDUCED_MOTION||!el.animate)return;
  let to=el.getBoundingClientRect();
  let dx=from.left-to.left,dy=from.top-to.top;
  if(Math.abs(dx)<2&&Math.abs(dy)<2)return;
  let flip=opts.flip?' rotateY(90deg)':'';
  if(el.id==='disc-top')flip+=' rotate(-200deg)';
  el.animate([
    {transform:`translate(${dx}px,${dy}px) scale(1.06)${flip}`,zIndex:50,boxShadow:'0 14px 30px rgba(0,0,0,.6)'},
    {transform:'translate(0,0) scale(1)',zIndex:50}
  ],{duration:opts.duration||420,delay:opts.delay||0,easing:'cubic-bezier(.2,.75,.3,1)',fill:'backwards'});
}
// Staggered deal-in for every card on the table at the start of a hand.
function dealAnimation(){
  if(REDUCED_MOTION)return;
  let from=rectOf('deck-el');
  if(!from)return;
  let cards=[...document.querySelectorAll('#opps .card, #ycards .card')];
  cards.forEach((el,i)=>flyFrom(el,from,{delay:i*55,duration:380}));
  sfx('deal');
}
// Flip every card face-up one after another at the end of a hand.
function revealAnimation(){
  if(REDUCED_MOTION)return 0;
  let cards=[...document.querySelectorAll('#opps .card, #ycards .card')];
  cards.forEach((el,i)=>{el.style.animationDelay=(i*90)+'ms';el.classList.add('reveal-flip');});
  return cards.length*90+500;
}
function setMsg(h){document.getElementById('amsg').innerHTML=h;}

// ── Rules sheet (home screen + in-game) ──
// One reference for every rule, split into short sections with a jump bar,
// plus tips for making decisions. Opening it never touches game state.
function rulesHTML(){
  const m=(r,s)=>`<span class="mini ${r==='JOKER'?'jk':RED.has(s)?'rd':''}">${r==='JOKER'?'🃏':r+s}</span>`;
  const sec=(id,ic,title,body)=>`<section class="rs-sec" id="rs-${id}"><h3><span>${ic}</span>${title}</h3>${body}</section>`;
  return [
    sec('goal','🎯','The goal',`<p>Have the <b>lowest total</b> of card points when the round ends. You won't see most of your cards, so remember what you've peeked at.</p>`),
    sec('values','🃏','Card values',`<div class="rs-vals">
      <div>${m('JOKER','★')}<b class="g">−2</b></div><div>${m('K','♠')}<b class="g">0</b></div><div>${m('A','♥')}<b class="g">1</b></div>
      <div>${m('2','♣')}…${m('10','♦')}<b>face</b></div><div>${m('J','♣')}<b class="r">11</b></div><div>${m('Q','♥')}<b class="r">12</b></div></div>`),
    sec('start','👀','Start of a round',`<p>Everyone gets <b>4 cards face down</b> in a 2×2 grid. You peek at your <b>2 nearest cards</b> for a few seconds — then they're hidden and you play from memory.</p><p class="rs-dim">Menu → Memory aid keeps your known cards visible if you prefer.</p>`),
    sec('turn','🔄','Your turn',`<ol>
      <li><b>Draw</b> the top card of the deck, <i>or</i> take the top card of the discard pile.</li>
      <li><b>Keep it</b> — tap a card in your hand to swap; your old card goes face up on the discard pile.</li>
      <li><i>Or</i> <b>discard it</b> (deck draws only). A card taken from the discard pile <b>must</b> be swapped in.</li></ol>`),
    sec('powers','✨','Power cards',`<p>When you draw <b>7 – K from the deck</b>, you may discard it to use its power. Discard-pile cards and matched cards have <b>no power</b>.</p>
      <div class="rs-pw"><div>${m('7','♠')}${m('8','♥')}<span><b>👁 Peek</b> — look at one of your cards</span></div>
      <div>${m('9','♣')}${m('10','♦')}<span><b>🔍 Spy</b> — look at one opponent card</span></div>
      <div>${m('J','♠')}<span><b>⏭ Skip</b> — next player misses a turn</span></div>
      <div>${m('Q','♦')}<span><b>🔀 Blind swap</b> — swap one of yours with an opponent's, no looking</span></div>
      <div>${m('K','♣')}<span><b>👑 Seen swap</b> — look at one of yours, then swap it with an opponent's</span></div></div>`),
    sec('match','⇣','Matching',`<p>At the <b>start of your turn, before drawing</b>, tap <b>Match</b> and throw a card with the <b>same rank</b> as the discard top.</p>
      <ul><li><b>Right:</b> it leaves your hand — one fewer card.</li><li><b>Wrong:</b> the card is shown to everyone, stays in your hand, and you take a <b>penalty card</b>.</li><li><b>One match per turn</b>, and each discarded card can be matched by only one player.</li></ul>`),
    sec('cabo','📣','Calling Cabo',`<p>Once everyone has had a turn, you can call <b>CABO</b> at the start of your turn instead of playing. Everyone else gets <b>one final turn</b>, then all cards are revealed.</p>
      <ul><li>Lowest hand wins the round (ties share it).</li><li>If you called Cabo and someone is <b>lower than you</b>: <b>+5 penalty</b>.</li></ul>`),
    sec('score','🏁','Scoring & winning',`<ul><li>Your hand's points are added to your <b>total</b> each round.</li><li>When anyone goes <b>past 100</b>, the game ends — <b>lowest total wins</b>.</li><li>Land on <b>exactly 100</b> and you reset to <b>50</b>.</li><li>If the deck runs out, the discard pile is reshuffled.</li></ul>`),
    sec('timer','⏱','Turn timer',`<p>Each turn has <b>45 seconds</b> (watch the ring). If it runs out, the game draws and discards for you. In local games you can switch the timer off in the Menu.</p>`),
    sec('tips','💡','Decision tips',`<ul>
      <li><b>Drew a 0–4?</b> Usually keep it — swap out your highest known card, or an unknown one.</li>
      <li><b>Drew a 9+ with no use?</b> Discard it.</li>
      <li><b>Lots of unknown cards?</b> Use 7/8 peeks — knowledge wins rounds.</li>
      <li><b>Know an opponent has a K or Joker?</b> A Queen or King swap can steal it.</li>
      <li><b>Watch the discard pile</b> — every matching rank you hold is a free card to dump.</li>
      <li><b>Call Cabo</b> when you're fairly sure your total is about <b>5 or less</b>, or clearly below what others likely hold.</li></ul>`),
  ].join('');
}
function openRules(opts={}){
  let el=document.getElementById('rules-sheet');
  if(!el)return;
  const jumps=[['goal','Goal'],['values','Values'],['turn','Turn'],['powers','Powers'],['match','Match'],['cabo','Cabo'],['score','Scoring'],['tips','Tips']];
  el.innerHTML=`<div class="rs-panel">
    <div class="rs-head"><div class="rs-title">📖 Rules</div><button class="rs-x" aria-label="Close rules">✕</button></div>
    <div class="rs-jump">${jumps.map(([id,t])=>`<button data-j="${id}">${t}</button>`).join('')}</div>
    <div class="rs-body">${rulesHTML()}</div>
    <div class="rs-foot">${opts.inGame?'':'<button class="ab sec" id="rs-lessons">▶ Watch the lessons</button>'}<button class="ab pri" id="rs-done">${opts.inGame?'Back to game':'Got it'}</button></div>
  </div>`;
  const body=el.querySelector('.rs-body');
  el.querySelectorAll('[data-j]').forEach(b=>b.onclick=()=>{
    const t=body.querySelector('#rs-'+b.dataset.j);
    if(t)body.scrollTo({top:t.offsetTop-body.offsetTop-4,behavior:REDUCED_MOTION?'auto':'smooth'});
  });
  el.querySelector('.rs-x').onclick=closeRules;
  el.querySelector('#rs-done').onclick=closeRules;
  const les=el.querySelector('#rs-lessons');
  if(les)les.onclick=()=>{closeRules();if(typeof Tutorial!=='undefined')Tutorial.open();};
  el.onclick=e=>{if(e.target===el)closeRules();};
  el.classList.add('show');
  el.querySelector('.rs-x').focus();
}
function closeRules(){let el=document.getElementById('rules-sheet');if(el)el.classList.remove('show');}
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeRules();});
