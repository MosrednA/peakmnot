// Names and chat lines in the room: whatever was typed, made safe to show and polite. The page only ever shows them
// as text (textContent), so this isn't what stops HTML; it keeps the room readable and friendly. The words are the
// score server's (server/names.py), English and Dutch.

const NAME_LENGTH = 16, CHAT_LENGTH = 140;
// short words only count as a whole word ("Bass" is fine); long ones anywhere
const WORDS = new Set(['ass', 'cum', 'dick', 'cock', 'fag', 'sex', 'tit', 'tits', 'kut', 'lul', 'pik', 'hoer', 'slet',
  'teef', 'neuk', 'nazi', 'rape', 'twat', 'slut', 'penis', 'eikel', 'anus', 'tering', 'flikker', 'pedo']);
const ANYWHERE = ['fuck', 'shit', 'cunt', 'nigger', 'nigga', 'faggot', 'retard', 'whore', 'bitch', 'pussy', 'asshole',
  'wanker', 'kanker', 'tyfus', 'klootzak', 'hitler', 'mongool', 'godver', 'neuken', 'vagina', 'porno', 'bastard'];
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'i', '+': 't' };

const plain = s => s.toLowerCase().replace(/[0134578@$!|+]/g, ch => LEET[ch]);
const rude = word => {
  const w = plain(word).replace(/[^\p{L}]/gu, '');
  return WORDS.has(w) || ANYWHERE.some(bad => w.includes(bad));
};

// The text as it may be shown: no control or invisible characters, accents yes but no zalgo, one space between
// words, and at most `length` characters.
function tidy(raw, length) {
  const text = String(raw ?? '').normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cn}\u2028\u2029]/gu, ' ')
    .replace(/(\p{M}{2})\p{M}+/gu, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(text).slice(0, length).join('').trim();
}

const number = () => 1000 + Math.floor(Math.random() * 9000);

// A player's name: tidied, letters, digits, emoji and a little punctuation only, and polite, or a can's number.
export function cleanName(raw) {
  const kept = String(raw ?? '').replace(/[^\p{L}\p{M}\p{N}\p{Extended_Pictographic}\u200d\ufe0f .,\-_'!?#&+()*~:@]/gu, '');
  const name = tidy(kept, NAME_LENGTH);
  if (!name) return `Can #${number()}`;
  if (rude(name) || name.split(/[\s.,\-_]+/).some(rude)) return `Mystery Can #${number()}`;
  return name;
}

// A chat line: tidied, rude words fizzed out. Empty if nothing's left.
export function cleanChat(raw) {
  return tidy(raw, CHAT_LENGTH).split(' ').map(word => (rude(word) ? '*fizz*' : word)).join(' ');
}
