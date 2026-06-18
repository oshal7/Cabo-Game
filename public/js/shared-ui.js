// Shared, mode-agnostic UI helpers: card rendering, banners, overlays, sfx,
// and the peek/swap visual flourishes. Used by both local-game.js (vs AI /
// pass & play) and multiplayer.js (online rooms).

const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const SUITS = ['♠','♥','♦','♣'];
const RED = new Set(['♥','♦']);
function cv(r){if(r==='A')return 1;if(r==='K')return 0;if(r==='J')return 11;if(r==='Q')return 12;if(r==='JOKER')return-2;return+r;}
function isSpec(r){return['7','8','9','10','J','Q','K'].includes(r);}
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
  setTimeout(()=>rerenderFn(),1400);
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
function showOv(title,body,btns){
  document.getElementById('ovt').textContent=title;
  document.getElementById('ovb').innerHTML=body;
  let bb=document.getElementById('ovbtns');bb.innerHTML='';
  btns.forEach(x=>{let b=document.createElement('button');b.className=x.c;b.textContent=x.t;b.onclick=x.fn;bb.appendChild(b);});
  document.getElementById('ov').classList.add('show');
}
function closeOv(){document.getElementById('ov').classList.remove('show');}

let bnrT=null;
function bnr(msg,type='info'){
  let old=document.querySelector('.bnr');if(old)old.remove();
  let b=document.createElement('div');b.className='bnr '+type;b.textContent=msg;
  document.getElementById('game').appendChild(b);
  if(bnrT)clearTimeout(bnrT);
  bnrT=setTimeout(()=>{if(b.parentNode)b.remove();},2600);
}
function setMsg(h){document.getElementById('amsg').innerHTML=h;}
