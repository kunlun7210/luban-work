const alphabets = {
  number: '0123456789',
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
};
const originalSymbols = `!@#$%^&*()_+-=[]{}|;':",./<>?`;
const limitedSymbols = '@！';
const lookalikes = new Set('0Oo1IlL|2Zz5Ss6Gg8B9q');

function boundedInteger(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function secureIndex(size) {
  const bytes = new Uint8Array(256);
  const limit = 256 - 256 % size;
  let position = bytes.length;
  return () => {
    let sample;
    do {
      if (position === bytes.length) {
        globalThis.crypto.getRandomValues(bytes);
        position = 0;
      }
      sample = bytes[position++];
    } while (sample >= limit);
    return sample % size;
  };
}

export function generatePasswords(options) {
  const selected = Object.entries(alphabets)
    .filter(([name]) => options[name])
    .map(([, alphabet]) => alphabet);
  if (options.allSymbols) selected.push(originalSymbols);
  else if (options.symbol) selected.push(limitedSymbols);
  const groups = selected.map(alphabet =>
    [...alphabet].filter(character => !options.excludeAmbiguous || !lookalikes.has(character)));
  if (groups.length === 0) return '';

  const length = boundedInteger(Math.min(Number(options.length), 32), 4, 32, 16);
  const quantity = boundedInteger(options.quantity, 1, 10, 10);
  const alphabet = [];
  for (const [groupIndex, characters] of groups.entries()) {
    for (const character of characters) alphabet.push({ character, group: 1 << groupIndex });
  }
  const draw = secureIndex(alphabet.length);
  const allGroups = (1 << groups.length) - 1;

  function password() {
    for (;;) {
      let result = '';
      let usedGroups = 0;
      for (let i = 0; i < length; i++) {
        const { character, group } = alphabet[draw()];
        result += character;
        usedGroups |= group;
      }
      if (usedGroups === allGroups) return result;
    }
  }

  return Array.from({ length: quantity }, password).join('\n');
}
