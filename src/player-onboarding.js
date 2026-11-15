const CONFIRMED_KEY = 'human-exe-confirmed-player-v1';
const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

/** Require a named player before play. A browser remembers a profile, never a face. */
export function requirePlayerIdentity({ players, dialog, onReady = () => {}, onSwitch = () => location.reload(), sessionStorage }) {
  let confirmed;
  try { sessionStorage ??= globalThis.sessionStorage; confirmed = sessionStorage?.getItem(CONFIRMED_KEY); } catch { /* The name still persists if session storage is disabled. */ }
  if (players.isIdentified && confirmed === players.profile.id) {
    onReady(players.profile);
    return Promise.resolve(players.profile);
  }

  return new Promise(resolve => {
    const closeGuard = event => event.preventDefault();
    dialog.addEventListener('cancel', closeGuard);
    const done = (profile, switched = false) => {
      try { sessionStorage?.setItem(CONFIRMED_KEY, profile.id); } catch { /* Confirm again on a future visit. */ }
      dialog.removeEventListener('cancel', closeGuard);
      dialog.close();
      onReady(profile);
      resolve(profile);
      if (switched) onSwitch(profile);
    };
    const fail = error => {
      const feedback = dialog.querySelector('#player-onboarding-feedback');
      feedback.textContent = error instanceof DOMException || /storage|quota|access|denied/i.test(error?.message ?? '')
        ? 'Your player could not be saved. Allow this site to store data, then try again. Your existing records have not been changed.'
        : error?.message ?? 'Could not save this player. Please try again.';
    };

    let profiles;
    try { profiles = players.list(); }
    catch {
      dialog.innerHTML = '<header><h2 id="player-title">Player storage unavailable</h2></header><p>Your saved players could not be opened. Allow this site to store data and reload to keep reports with the correct player.</p><button type="button" class="primary-button" id="player-onboarding-retry">Try again</button><p id="player-onboarding-feedback" role="alert"></p>';
      dialog.querySelector('#player-onboarding-retry').onclick = () => location.reload();
      if (!dialog.open) dialog.showModal();
      return;
    }

    const remembered = players.remembered;
    const otherProfiles = profiles.filter(profile => profile.named === true || profile.name !== 'Local player');
    const unclaimed = !players.isIdentified && players.profile.id === 'local-player' && players.profile.named !== true && players.profile.name === 'Local player';
    dialog.innerHTML = `
      <header><h2 id="player-title">${remembered ? `Welcome back, ${escape(remembered.name)}` : 'Who is playing?'}</h2></header>
      <p>${remembered ? 'This browser remembers your player. Continue as yourself, or choose another player below.' : 'Enter your name before your first mission. Your check-ins, preferences and mission reports will be saved with your player.'}</p>
      ${remembered ? `<button type="button" class="primary-button player-continue" id="player-onboarding-continue">Continue as ${escape(remembered.name)}</button>` : ''}
      ${otherProfiles.length ? `<form id="player-onboarding-select"><label for="player-onboarding-id">Choose a saved player</label><div class="player-form-row"><select id="player-onboarding-id" name="profile" required><option value="">Choose your name</option>${otherProfiles.map(profile => `<option value="${escape(profile.id)}">${escape(profile.name)}</option>`).join('')}</select><button type="submit" class="outline-button">Use this player</button></div></form>` : ''}
      <form id="player-onboarding-new"><label for="player-onboarding-name">${unclaimed ? 'Your name' : 'First time here? Enter your name'}</label><div class="player-form-row"><input id="player-onboarding-name" name="name" autocomplete="nickname" maxlength="32" required placeholder="Player name"><button type="submit" class="primary-button" id="player-onboarding-submit">${unclaimed ? 'Save & continue' : 'Add player'}</button></div></form>
      <p class="player-storage-note">${unclaimed ? 'Existing Local player records stay with this name. ' : ''}Profiles are saved in this browser on this device. Keep using the same browser and address to find them again.</p>
      <p id="player-onboarding-feedback" role="alert" aria-live="polite"></p>`;

    dialog.querySelector('#player-onboarding-continue')?.addEventListener('click', () => done(remembered));
    dialog.querySelector('#player-onboarding-select')?.addEventListener('submit', event => {
      event.preventDefault();
      try {
        const selected = players.select(new FormData(event.currentTarget).get('profile'));
        done(selected, selected.id !== players.profile.id);
      } catch (error) { fail(error); }
    });
    dialog.querySelector('#player-onboarding-new').addEventListener('submit', event => {
      event.preventDefault();
      try {
        const name = new FormData(event.currentTarget).get('name');
        const profile = unclaimed ? players.rename(name) : players.create(name);
        done(profile, profile.id !== players.profile.id);
      } catch (error) { fail(error); }
    });
    if (!dialog.open) dialog.showModal();
    if (!remembered && !otherProfiles.length) dialog.querySelector('#player-onboarding-name').focus();
  });
}
