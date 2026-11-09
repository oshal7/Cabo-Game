// Shared, mode-agnostic UI helpers: card rendering, banners, overlays, sfx,
// and the peek/swap visual flourishes. Used by both local-game.js (vs AI /
// pass & play) and multiplayer.js (online rooms).

const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const SUITS = ['♠','♥','♦','♣'];
const RED = new Set(['♥','♦']);
function cv(r){if(r==='A')return 1;if(r==='K')return 0;if(r==='J')return 11;if(r==='Q')return 12;if(r==='JOKER')return-2;return+r;}
function isSpec(r){return['7','8','9','10','J','Q','K'].includes(r);}
function specDesc(r){return{7:'Look at one of your own cards',8:'Look at one of your own cards',9:"Look at one opponent's card",10:"Look at one opponent's card",J:"Skip the next player's turn",Q:'Swap one of your cards with an opponent card, unseen',K:'Look at your card, then swap it with an opponent card'}[r]||'';}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
const SUIT_NAMES={'♠':'spades','♥':'hearts','♦':'diamonds','♣':'clubs','★':''};
function cardName(c){if(!c||!c.rank||c.rank==='?')return'face-down card';if(c.rank==='JOKER')return'Joker';return c.rank+' of '+SUIT_NAMES[c.suit];}

// ── persisted settings ──
const Settings=(function(){
  let d={sound:true,memoryAid:false};
  try{Object.assign(d,JSON.parse(localStorage.getItem('cabo_settings')||'{}'));}catch(e){}
  return{get:k=>d[k],set:(k,v)=>{d[k]=v;try{localStorage.setItem('cabo_settings',JSON.stringify(d));}catch(e){}}};
})();
const REDUCED_MOTION=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// How long the "memorize your cards" window lasts at the start of a hand.
const MEMORIZE_MS=4000;
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
  sfx('reveal');
  setTimeout(()=>rerenderFn(),2000);
}
function flashSwapGlow(cardElId){
  let cardEl=document.getElementById(cardElId);
  if(!cardEl) return;
  cardEl.classList.add('ai-swap-flash');
  setTimeout(()=>{if(cardEl.parentNode)cardEl.classList.remove('ai-swap-flash');},600);
}

// ── SFX ──
let AC=null;
function getAC(){if(!AC)try{AC=new AudioContext();}catch(e){}return AC;}
function sfx(type){
  if(!Settings.get('sound'))return;
  try{
    let ac=getAC();if(!ac)return;
    if(ac.state==='suspended')ac.resume();
    let o=ac.createOscillator(),g=ac.createGain();
    o.connect(g);g.connect(ac.destination);
    let t=ac.currentTime;
    if(type==='draw'){o.frequency.setValueAtTime(440,t);o.frequency.linearRampToValueAtTime(520,t+.07);g.gain.setValueAtTime(.08,t);g.gain.linearRampToValueAtTime(0,t+.12);o.start(t);o.stop(t+.13);}
    else if(type==='discard'){o.frequency.setValueAtTime(380,t);o.frequency.linearRampToValueAtTime(260,t+.1);g.gain.setValueAtTime(.07,t);g.gain.linearRampToValueAtTime(0,t+.15);o.start(t);o.stop(t+.16);}
    else if(type==='swap'){o.type='triangle';o.frequency.setValueAtTime(600,t);o.frequency.linearRampToValueAtTime(900,t+.08);g.gain.setValueAtTime(.06,t);g.gain.linearRampToValueAtTime(0,t+.18);o.start(t);o.stop(t+.19);}
    else if(type==='peek'){o.type='sine';o.frequency.setValueAtTime(800,t);o.frequency.linearRampToValueAtTime(1100,t+.1);g.gain.setValueAtTime(.05,t);g.gain.linearRampToValueAtTime(0,t+.2);o.start(t);o.stop(t+.21);}
    else if(type==='cabo'){for(let i=0;i<3;i++){let oo=ac.createOscillator(),gg=ac.createGain();oo.connect(gg);gg.connect(ac.destination);let tt=t+i*.1;oo.frequency.setValueAtTime(523+i*130,tt);gg.gain.setValueAtTime(.1,tt);gg.gain.linearRampToValueAtTime(0,tt+.15);oo.start(tt);oo.stop(tt+.16);}}
    else if(type==='match'){o.type='triangle';o.frequency.setValueAtTime(660,t);o.frequency.linearRampToValueAtTime(880,t+.12);g.gain.setValueAtTime(.09,t);g.gain.linearRampToValueAtTime(0,t+.25);o.start(t);o.stop(t+.26);}
    else if(type==='reveal'){o.type='sine';o.frequency.setValueAtTime(440,t);o.frequency.linearRampToValueAtTime(660,t+.2);g.gain.setValueAtTime(.08,t);g.gain.linearRampToValueAtTime(0,t+.4);o.start(t);o.stop(t+.41);}
    else if(type==='special'){o.type='sawtooth';o.frequency.setValueAtTime(500,t);o.frequency.linearRampToValueAtTime(300,t+.15);g.gain.setValueAtTime(.05,t);g.gain.linearRampToValueAtTime(0,t+.2);o.start(t);o.stop(t+.21);}
  }catch(e){}
}

// ── overlay / banner ──
function showOv(title,body,btns,opts={}){
  document.getElementById('ov').classList.toggle('solid',!!opts.solid);
  document.getElementById('ovt').textContent=title;
  document.getElementById('ovb').innerHTML=body;
  let bb=document.getElementById('ovbtns');bb.innerHTML='';
  btns.forEach(x=>{let b=document.createElement('button');b.className=x.c;b.textContent=x.t;b.onclick=x.fn;bb.appendChild(b);});
  document.getElementById('ov').classList.add('show');
}
function closeOv(){document.getElementById('ov').classList.remove('show','solid');}

// Round / game result table shared by local and online play.
// d: {names, roundScores, totals, winners, caboBy, caboLost, resets, gameOver, you}
function showRoundResult(d,btns){
  let order=d.names.map((_,i)=>i);
  if(d.gameOver)order.sort((a,b)=>d.totals[a]-d.totals[b]);
  let rows=order.map(i=>{
    let pen=d.caboLost&&i===d.caboBy?' <span class="pen">+5</span>':'';
    let win=d.gameOver?d.totals[i]===Math.min(...d.totals):d.winners.includes(i);
    return `<tr class="${win?'win':''}${i===d.you?' me':''}"><td>${esc(d.names[i])}${i===d.caboBy?' ★':''}</td><td class="scc">${d.roundScores[i]}${pen}</td><td class="scc tot">${d.totals[i]}</td></tr>`;
  }).join('');
  let notes='';
  if(d.caboLost)notes+=`<div class="ov-note bad">${esc(d.names[d.caboBy])} called Cabo but didn't win — +5 penalty!</div>`;
  (d.resets||[]).forEach(n=>{notes+=`<div class="ov-note good">${esc(n)} hit exactly 100 — reset to 50!</div>`;});
  let winNames=d.gameOver
    ?d.names.filter((_,i)=>d.totals[i]===Math.min(...d.totals))
    :d.winners.map(i=>d.names[i]);
  let head=d.gameOver?'Champion':(winNames.length>1?'Tied winners':'Winner');
  let youWon=d.gameOver?d.totals[d.you]===Math.min(...d.totals):d.winners.includes(d.you);
  showOv(d.gameOver?'Game Over':'Round Over',
    `${notes}<table class="sct"><thead><tr><th style="text-align:left">Player</th><th>Round</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table>`+
    `<div class="ov-win">${head}: <b>${winNames.map(esc).join(', ')}</b></div>`+
    (d.gameOver?'':'<div class="dim-note">Game ends when someone goes past 100. Lowest total wins.</div>'),btns);
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
  return `<div class="set-row"><span>Sound</span><button class="ab tog" data-set="sound">${Settings.get('sound')?'On':'Off'}</button></div>`+
    `<div class="set-row"><span>Memory aid <small>(keep your known cards face-up)</small></span><button class="ab tog" data-set="memoryAid">${Settings.get('memoryAid')?'On':'Off'}</button></div>`;
}
function bindSettings(rerender){
  document.querySelectorAll('#ovb [data-set]').forEach(b=>{
    b.onclick=()=>{let k=b.dataset.set;Settings.set(k,!Settings.get(k));b.textContent=Settings.get(k)?'On':'Off';updateSoundBtn();rerender&&rerender();};
  });
}
function updateSoundBtn(){let b=document.getElementById('sound-btn');if(b){b.textContent=Settings.get('sound')?'🔊':'🔇';b.setAttribute('aria-label',Settings.get('sound')?'Mute sound':'Unmute sound');}}

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
  sfx('draw');
}
// Flip every card face-up one after another at the end of a hand.
function revealAnimation(){
  if(REDUCED_MOTION)return 0;
  let cards=[...document.querySelectorAll('#opps .card, #ycards .card')];
  cards.forEach((el,i)=>{el.style.animationDelay=(i*90)+'ms';el.classList.add('reveal-flip');});
  return cards.length*90+500;
}
function setMsg(h){document.getElementById('amsg').innerHTML=h;}
