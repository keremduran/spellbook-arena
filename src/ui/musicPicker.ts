import { sfx } from '../game/audio';
import { MUSIC_STYLES, type MusicStyle } from '../game/music';
import { el } from './dom';

/**
 * Music style chooser. Tapping a style plays it right away (a preview at skirmish level) so
 * you can hear the options; "Off" stops the music.
 */
export function musicPicker(preview = true) {
  const current = () => (sfx.musicOn ? sfx.style : 'off');
  const options: [MusicStyle | 'off', string, string][] = [...MUSIC_STYLES.map((m) => [m.id, m.label, m.desc] as [MusicStyle, string, string]), ['off', 'Off', 'No music']];
  const buttons = options.map(([id, label, desc]) =>
    el('button', { class: id === current() ? 'on' : '', title: desc, onclick: () => {
      sfx.unlock();
      if (id === 'off') {
        sfx.setMusic(false);
        sfx.stopMusic();
      } else {
        if (!sfx.musicOn) sfx.setMusic(true);
        sfx.setStyle(id);
        if (preview) sfx.setIntensity(1);
        sfx.startMusic();
      }
      buttons.forEach((b, i) => b.classList.toggle('on', options[i][0] === id));
    } }, [label]),
  );
  return el('div.seg.music-seg', {}, buttons);
}
