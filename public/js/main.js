// Top-level wiring: screen switching, menu inputs, and routing the shared
// in-game buttons (Call Cabo / Scores / Menu) to whichever mode is active.
const Screens = {
  all: ['setup', 'mp-room', 'game', 'tutorial'],
  show(name) {
    // visibility is a class so CSS can pick the layout (flex, or grid on wide screens)
    this.all.forEach((id) => document.getElementById(id).classList.toggle('on', id === name));
    if (name !== 'game' && typeof FX !== 'undefined') { FX.hideMarker(); FX.clear(); }
  },
};

let ActiveGame = Local; // Local or MP — whichever is currently driving #game

// Home screen panels: 'home' (mode cards), 'solo' / 'pass' (local setup), 'online'.
function showPanel(which) {
  const local = which === 'solo' || which === 'pass';
  document.getElementById('home-panel').style.display = which === 'home' ? '' : 'none';
  document.getElementById('local-panel').style.display = local ? 'block' : 'none';
  document.getElementById('online-panel').style.display = which === 'online' ? 'block' : 'none';
  if (local) {
    Local.setMode(which);
    document.getElementById('local-title').textContent = which === 'solo' ? 'Play vs Computer' : 'Pass & Play';
    document.getElementById('np-lbl').textContent = which === 'solo' ? 'PLAYERS (YOU + AI)' : 'PLAYERS ON THIS DEVICE';
    document.getElementById('diff-row').style.display = which === 'solo' ? '' : 'none';
  }
  if (which === 'online') { MP.ensureSocket(); MP.refreshRoomsList(); }
  const setup = document.getElementById('setup');
  if (setup) setup.scrollTop = 0;
}

document.addEventListener('DOMContentLoaded', () => {
  // home: pick a way to play → its setup panel; Back returns home
  document.querySelectorAll('.mode-card').forEach((btn) => btn.addEventListener('click', () => showPanel(btn.dataset.go)));
  document.querySelectorAll('[data-back]').forEach((btn) => btn.addEventListener('click', () => showPanel('home')));
  // Rules sheet: available on the home screen, in every setup panel, and in-game
  document.querySelectorAll('[data-rules]').forEach((el) => el.addEventListener('click', () =>
    openRules({ inGame: !!el.closest('#game') })));

  // local setup segmented controls
  document.querySelectorAll('#local-panel .seg .sb').forEach((btn) => {
    btn.addEventListener('click', () => {
      const seg = btn.dataset.seg, val = btn.dataset.val;
      Local.setSeg(seg, isNaN(val) ? val : +val, btn);
    });
  });
  document.getElementById('deal-btn').addEventListener('click', () => { ActiveGame = Local; Local.startGame(); });
  // How to Play: lessons + guided practice round. Pulses until finished once.
  const howto = document.getElementById('howto-btn');
  if (!Settings.get('tutDone')) howto.classList.add('fresh');
  howto.addEventListener('click', () => { howto.classList.remove('fresh'); Tutorial.open(); });

  // online setup
  document.querySelectorAll('#mp-np-seg .sb').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#mp-np-seg .sb').forEach((b) => b.classList.remove('on'));
      btn.classList.add('on');
      MP.setMaxPlayers(+btn.dataset.mpnp);
    });
  });
  MP.setMaxPlayers(3);
  document.getElementById('mp-create-btn').addEventListener('click', () => {
    const name = document.getElementById('mp-name').value.trim() || 'Player';
    ActiveGame = MP;
    MP.createRoom(name);
  });
  document.getElementById('mp-join-btn').addEventListener('click', () => {
    const name = document.getElementById('mp-name').value.trim() || 'Player';
    const code = document.getElementById('mp-code').value.trim();
    if (!code) return;
    ActiveGame = MP;
    MP.joinRoom(code, name);
  });

  // multiplayer waiting room
  document.getElementById('mp-start-btn').addEventListener('click', () => MP.startGame());
  document.getElementById('mp-invite-btn').addEventListener('click', () => MP.copyInvite());
  document.getElementById('mp-leave-btn').addEventListener('click', () => MP.leaveRoom());

  // shared in-game controls
  document.getElementById('cabo-btn').addEventListener('click', () => ActiveGame.callCabo());
  document.getElementById('scores-btn').addEventListener('click', () => ActiveGame.toggleScores());
  document.getElementById('menu-btn').addEventListener('click', () => ActiveGame.openMenu());
  // Sound: music + effects popover (top bar in-game, corner button on menus)
  ['sound-btn', 'audio-fab'].forEach((id) => {
    const b = document.getElementById(id);
    b.addEventListener('click', () => openAudioPanel(b));
  });
  updateSoundBtn();

  // remember names between visits
  const savedName = Settings.get('name');
  if (savedName) { document.getElementById('pname').value = savedName; document.getElementById('mp-name').value = savedName; }
  document.getElementById('mp-name').addEventListener('change', (e) => Settings.set('name', e.target.value.trim()));

  // invite links: ?room=CODE opens the Online tab with the code filled in
  const inviteCode = new URLSearchParams(location.search).get('room');
  if (inviteCode && !sessionStorage.getItem('cabo_mp_session')) {
    showPanel('online');
    document.getElementById('mp-code').value = inviteCode.toUpperCase().slice(0, 4);
    document.getElementById('mp-name').focus();
  }

  Screens.show('setup');
  // ?learn (or #learn) opens How to Play directly — handy for sharing.
  const qs = new URLSearchParams(location.search);
  if (qs.has('learn') || location.hash === '#learn') Tutorial.open(qs.get('learn') === 'practice' ? 'practice' : undefined);
  // Only open a socket eagerly if we have a saved room to rejoin (e.g. after
  // a refresh mid-game) — otherwise wait until the user picks Online mode,
  // so local play never depends on the multiplayer backend being reachable.
  if (sessionStorage.getItem('cabo_mp_session')) {
    ActiveGame = MP;
    MP.ensureSocket();
  }
});
