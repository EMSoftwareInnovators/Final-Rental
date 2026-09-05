/* Stage 13: filesystem saves, migration, and recovery -- through the real
 * desktop app, across real relaunches.
 *
 * Launches the Electron build under a throwaway --user-data-dir so the save
 * files land somewhere this script can read and corrupt, then relaunches
 * against the same directory to prove: saves are real JSON files on disk; a
 * quit-and-continue resumes; a legacy localStorage value migrates once and only
 * once; a corrupted primary is recovered from its backup; and a domain with no
 * readable copy resets to defaults with a calm notice and without touching any
 * other domain.
 *
 * Headless: xvfb-run -a node tools/desktopsave.mjs
 */
import { _electron as electron } from 'playwright-core';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let fails = 0;
const check = (label, ok, extra = '') => {
  if (!ok) fails++;
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
};

const userData = mkdtempSync(path.join(tmpdir(), 'fr-ud-'));
const savesDir = path.join(userData, 'saves');
const saveFile = (base) => path.join(savesDir, `${base}.json`);

async function launch() {
  const app = await electron.launch({
    args: ['.', '--no-sandbox', `--user-data-dir=${userData}`],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => !!window.__game, null, { timeout: 10000 });
  await page.evaluate(() => { window.__game.sound.muted = true; });
  return { app, page };
}

/* ---------- 1. saves are real files; a quit resumes ---------- */
{
  let { app, page } = await launch();
  const backend = await page.evaluate(() => window.__storage.backend);
  check('the desktop build uses the filesystem storage backend', backend === 'desktop', backend);

  // Start a Story campaign and work a night boundary so campaign.json is
  // written (twice, so a backup exists too).
  await page.evaluate(() => {
    const g = window.__game;
    g.newStory();
    g.grade = { letter: 'A', score: 160 };
    g.stats = { served: 9, stormedOut: 0, cashLoose: 0 };
    g.advanceNight();          // now on night 2, campaign.json written again
  });
  const nightBefore = await page.evaluate(() => window.__game.nightNo);
  await app.close();

  check('a Story campaign is written to campaign.json on disk', existsSync(saveFile('campaign')),
    existsSync(saveFile('campaign')) ? 'present' : 'MISSING');
  check('and a last-known-good backup exists after the second write', existsSync(saveFile('campaign.backup')));

  // Relaunch and Continue: same night resumes from the file.
  ({ app, page } = await launch());
  const resumed = await page.evaluate(() => {
    const g = window.__game;
    const has = window.__campaign.hasCampaignSave();
    g.continueStory();
    return { has, night: g.nightNo };
  });
  check('a relaunch offers Continue and resumes the saved night',
    resumed.has && resumed.night === nightBefore, `night ${resumed.night} (was ${nightBefore})`);
  await app.close();
}

/* ---------- 2. legacy localStorage migrates once, then idempotent ---------- */
{
  const ud2 = mkdtempSync(path.join(tmpdir(), 'fr-mig-'));
  const saves2 = path.join(ud2, 'saves');
  const file2 = (b) => path.join(saves2, `${b}.json`);
  const launch2 = async () => {
    const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${ud2}`], env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' } });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => !!window.__game, null, { timeout: 10000 });
    await page.evaluate(() => { window.__game.sound.muted = true; });
    return { app, page };
  };

  // Launch once with NO save files, and plant legacy values straight into the
  // renderer's localStorage -- exactly what an earlier localStorage-era desktop
  // build would have left behind.
  let { app, page } = await launch2();
  await page.evaluate(() => {
    localStorage.setItem('finalrental.campaign', JSON.stringify({ version: 3, mode: 'STORY', seed: 9, currentNight: 7, started: true, completed: false, history: { grades: [], scores: [] }, cooldown: { calmUntil: 0, standDownNight: 0 }, stats: { arrests: 0, customersServed: 0, walkouts: 0, cashDiscrepancy: 0 }, storyFlags: {}, customerStates: {}, environmentFlags: {}, cases: [] }));
    localStorage.setItem('finalrental.profile', JSON.stringify({ version: 1, story: { completed: true, completions: 1, endingsSeen: ['ARREST'], firstCompletedAt: '2026-01-01T00:00:00.000Z', lastCompletedAt: '2026-01-01T00:00:00.000Z', legacyImported: false, records: {} }, overtime: { records: {}, bestRun: null } }));
  });
  check('before migration, there is no campaign.json yet', !existsSync(file2('campaign')));
  await app.close();

  // Relaunch: hydrate should migrate the legacy values to files, silently.
  ({ app, page } = await launch2());
  const migrated = await page.evaluate(() => ({
    state: window.__game.state,
    night: window.__campaign.loadCampaign() ? window.__campaign.loadCampaign().currentNight : null,
    completions: window.__game.profile.story.completions,
    unlocked: window.__profile.overtimeUnlocked(window.__game.profile),
  }));
  check('a legacy campaign migrates to campaign.json on the next launch', existsSync(file2('campaign')) && migrated.night === 7, `night ${migrated.night}`);
  check('a legacy profile migrates too, unlocking Overtime', migrated.completions === 1 && migrated.unlocked);
  check('migration is silent (no recovery panel)', migrated.state !== 'NOTICE', migrated.state);
  await app.close();

  // A third launch must NOT re-migrate or double the completion count.
  ({ app, page } = await launch2());
  const again = await page.evaluate(() => window.__game.profile.story.completions);
  check('a further launch does not re-migrate or double the completion count', again === 1, `completions ${again}`);
  await app.close();
  rmSync(ud2, { recursive: true, force: true });
}

/* ---------- 3. a corrupt primary is recovered from its backup ---------- */
{
  // The userData from test 1 has campaign.json + campaign.backup.json. Scribble
  // on the primary and relaunch: the game should recover and say so, calmly.
  writeFileSync(saveFile('campaign'), '{ this is not valid json ][');
  const { app, page } = await launch();
  const rec = await page.evaluate(() => ({
    state: window.__game.state,
    head: (document.querySelector('#panel-body h2') || {}).textContent || '',
    hasCampaign: window.__campaign.hasCampaignSave(),
  }));
  check('a corrupt campaign is recovered from backup and the game still has it',
    rec.hasCampaign, `state ${rec.state}`);
  check('and the player is told, calmly, that a save was recovered',
    rec.state === 'NOTICE' && /RECOVERED/.test(rec.head), `"${rec.head}"`);
  // The corrupt file was preserved, not deleted.
  const fs = await import('node:fs');
  check('the corrupt file is preserved for diagnosis',
    fs.readdirSync(savesDir).some((f) => /campaign\.corrupt-/.test(f)));
  await app.close();
}

/* ---------- 4. both copies unreadable -> reset THIS domain only ---------- */
{
  // Give the profile a real file first so we can prove it survives a campaign reset.
  let { app, page } = await launch();
  await page.evaluate(() => {
    const P = window.__profile;
    window.__game.profile = P.freshProfile();
    P.recordStoryCompletion(window.__game.profile, { history: { grades: ['A'], scores: [160] }, stats: { arrests: 2, customersServed: 40, walkouts: 1 }, storyFlags: { endingId: 'ARREST' } });
    P.saveProfile(window.__game.profile);
  });
  await app.close();
  check('the profile has its own file on disk', existsSync(saveFile('profile')));

  // Now break BOTH campaign copies.
  writeFileSync(saveFile('campaign'), 'garbage-primary');
  writeFileSync(saveFile('campaign.backup'), 'garbage-backup');
  ({ app, page } = await launch());
  const reset = await page.evaluate(() => ({
    state: window.__game.state,
    head: (document.querySelector('#panel-body h2') || {}).textContent || '',
    hasCampaign: window.__campaign.hasCampaignSave(),
    profileCompletions: window.__game.profile.story.completions,
  }));
  check('a campaign with no readable copy resets to defaults', !reset.hasCampaign);
  check('and the player is told it was reset', reset.state === 'NOTICE' && /RESET/.test(reset.head), `"${reset.head}"`);
  check('but the UNRELATED profile is completely intact through the campaign reset',
    reset.profileCompletions === 1, `completions ${reset.profileCompletions}`);
  await app.close();
}

console.log(fails ? `\ndesktopsave FAILED (${fails})` : '\ndesktopsave clean');
rmSync(userData, { recursive: true, force: true });
process.exit(fails ? 1 : 0);
