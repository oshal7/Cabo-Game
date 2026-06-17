// Top-level wiring: screen switching, menu inputs, and routing the shared
// in-game buttons (Call Cabo / Scores / Menu) to whichever mode is active.
const Screens = {
  all: ['setup', 'mp-room', 'game'],
  show(name) {
    this.all.forEach((id) => { document.getElementById(id).style.display = id === name ? 'flex' : 'none'; });
  },
};

let ActiveGame = Local; // Local or MP — whichever is currently driving #game

document.addEventListener('DOMContentLoaded', () => {
  // play mode tabs
  document.querySelectorAll('#playmode-seg .sb').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#playmode-seg .sb').forEach((b) => b.classList.remove('on'));
      btn.classList.add('on');
      const mode = btn.dataset.playmode;
      document.getElementById('local-panel').style.display = mode === 'local' ? 'block' : 'none';
      document.getElementById('online-panel').style.display = mode === 'online' ? 'block' : 'none';
      if (mode === 'online') { MP.ensureSocket(); MP.refreshRoomsList(); }
    });
  });

  // local setup segmented controls
  document.querySelectorAll('#local-panel .seg .sb').forEach((btn) => {
    btn.addEventListener('click', () => {
      const seg = btn.dataset.seg, val = btn.dataset.val;
      Local.setSeg(seg, isNaN(val) ? val : +val, btn);
    });
  });
  document.getElementById('deal-btn').addEventListener('click', () => { ActiveGame = Local; Local.startGame(); });
  document.getElementById('rules-toggle').addEventListener('click', () => {
    const drop = document.getElementById('rules-drop');
    drop.classList.toggle('open');
    document.getElementById('rules-toggle').textContent = drop.classList.contains('open') ? '▾ Hide Rules' : '▸ Show Rules';
  });

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
  document.getElementById('mp-leave-btn').addEventListener('click', () => MP.leaveRoom());

  // shared in-game controls
  document.getElementById('cabo-btn').addEventListener('click', () => ActiveGame.callCabo());
  document.getElementById('scores-btn').addEventListener('click', () => ActiveGame.toggleScores());
  document.getElementById('menu-btn').addEventListener('click', () => ActiveGame.openMenu());

  Screens.show('setup');
  MP.ensureSocket();
});
