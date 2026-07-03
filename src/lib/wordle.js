// ============================================================
// wordle.js (lib) — Pure daily-puzzle logic: the deterministic
// word of the day, guess scoring (with correct duplicate-letter
// handling — the classically tricky bit), and rewards.
// ============================================================

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// The ANSWER pool: curated common words — things your friends will say
// "ohhh" about, not crossword filler. The word of the day comes from here.
export const ANSWERS = [
  'about','above','abuse','actor','adapt','admit','adopt','after','again','agent',
  'agree','ahead','alarm','album','alert','alien','alike','alive','allow','alone',
  'along','amber','anger','angle','angry','ankle','apart','apple','apply','arena',
  'argue','arise','armor','aroma','array','arrow','aside','asset','audio','avoid',
  'awake','award','aware','badge','baker','basic','batch','beach','beard','beast',
  'began','begin','being','belly','below','bench','berry','birth','black','blade',
  'blame','blank','blast','blaze','bleed','blend','bless','blind','block','blood',
  'bloom','board','boast','bonus','boost','booth','bound','brain','brand','brave',
  'bread','break','breed','brick','bride','brief','bring','broad','broke','brook',
  'brown','brush','build','built','bunch','burst','buyer','cabin','cable','candy',
  'cargo','carry','catch','cause','chain','chair','chalk','charm','chart','chase',
  'cheap','check','cheek','cheer','chess','chest','chief','child','chill','choir',
  'chose','claim','clash','class','clean','clear','clerk','click','cliff','climb',
  'clock','close','cloth','cloud','coach','coast','cocoa','colon','color','comet',
  'comic','coral','couch','could','count','court','cover','crack','craft','crane',
  'crash','crawl','crazy','cream','crime','crisp','cross','crowd','crown','crumb',
  'crush','curve','cycle','daily','dairy','dance','dealt','death','debut','decay',
  'decor','delay','delta','dense','depth','devil','diary','dirty','ditch','dizzy',
  'dodge','doing','donor','doubt','dough','dozen','draft','drain','drama','dream',
  'dress','drift','drill','drink','drive','drove','drums','dusty','dwell','eager',
  'eagle','early','earth','eight','elbow','elder','elect','elite','empty','enemy',
  'enjoy','enter','entry','equal','error','event','every','exact','exist','extra',
  'fable','faint','fairy','faith','false','fancy','fatal','fault','favor','feast',
  'fever','fiber','field','fifty','fight','final','first','flame','flash','fleet',
  'flesh','float','flock','flood','floor','flour','fluid','flush','flute','focus',
  'force','forge','forth','forty','forum','found','frame','fraud','fresh','front',
  'frost','fruit','fully','funny','ghost','giant','given','glass','globe','glory',
  'glove','going','goose','grace','grade','grain','grand','grant','grape','grasp',
  'grass','grave','great','greed','green','greet','grief','grill','grind','groan',
  'group','grove','growl','grown','guard','guess','guest','guide','habit','happy',
  'harsh','haunt','heard','heart','heavy','hello','hence','hobby','honey','honor',
  'horse','hotel','house','human','humor','hurry','ideal','image','imply','index',
  'inner','input','irony','issue','ivory','jelly','jewel','joint','jolly','judge',
  'juice','knife','knock','known','label','labor','large','laser','later','laugh',
  'layer','learn','lease','least','leave','legal','lemon','level','light','limit',
  'linen','liver','lobby','local','lodge','logic','loose','lower','loyal','lucky',
  'lunar','lunch','lyric','magic','major','maker','mango','maple','march','marry',
  'match','mayor','meant','medal','media','melon','mercy','merge','merit','merry',
  'metal','meter','midst','might','minor','minus','mixed','model','money','month',
  'moral','motor','mound','mount','mouse','mouth','movie','music','naive','nasty',
  'naval','nerve','never','newly','night','noble','noise','north','notch','noted',
  'novel','nurse','occur','ocean','offer','often','olive','onion','opera','orbit',
  'order','organ','other','ought','ounce','outer','owner','oxide','ozone','paint',
  'panel','panic','paper','party','pasta','patch','pause','peace','peach','pearl',
  'pedal','penny','phase','phone','photo','piano','piece','pilot','pinch','pitch',
  'pixel','pizza','place','plain','plane','plant','plate','plaza','pluck','point',
  'polar','porch','pouch','pound','power','press','price','pride','prime','print',
  'prize','proof','proud','prove','pulse','punch','pupil','purse','queen','query',
  'quest','quick','quiet','quilt','quite','quota','quote','radar','radio','raise',
  'rally','ranch','range','rapid','ratio','reach','ready','realm','rebel','refer',
  'reign','relax','relay','reply','rhyme','rider','ridge','rifle','right','rigid',
  'risky','rival','river','roast','robin','robot','rocky','rough','round','route',
  'royal','rural','salad','sauce','scale','scare','scarf','scene','scent','scoop',
  'scope','score','scout','scrap','seize','sense','serve','seven','shade','shaft',
  'shake','shall','shame','shape','share','shark','sharp','sheep','sheet','shelf',
  'shell','shift','shine','shiny','shirt','shock','shore','short','shout','shown',
  'sight','silly','since','siren','sixty','skill','skirt','skull','slate','sleep',
  'slice','slide','slope','small','smart','smell','smile','smoke','snack','snake',
  'sneak','solar','solid','solve','sorry','sound','south','space','spare','spark',
  'speak','speed','spell','spend','spice','spike','spine','spoke','spoon','sport',
  'spray','squad','stack','staff','stage','stain','stair','stake','stamp','stand',
  'stare','start','state','steak','steal','steam','steel','steep','steer','stick',
  'stiff','still','stock','stone','stood','store','storm','story','stove','strap',
  'straw','strip','stuck','study','stuff','style','sugar','suite','sunny','super',
  'surge','swamp','swear','sweat','sweep','sweet','swift','swing','sword','syrup',
  'table','taken','taste','teach','teeth','tempo','tenth','thank','theft','theme',
  'there','thick','thief','thing','think','third','thorn','those','three','throw',
  'thumb','tiger','tight','timer','title','toast','today','token','tooth','topic',
  'torch','total','touch','tough','tower','toxic','trace','track','trade','trail',
  'train','trait','trash','treat','trend','trial','tribe','trick','troop','truck',
  'truly','trunk','trust','truth','tulip','tumor','tutor','twice','twist','uncle',
  'under','union','unite','unity','until','upper','upset','urban','usage','usual',
  'vague','valid','value','vapor','vault','venue','video','vigor','villa','vinyl',
  'virus','visit','vital','vivid','vocal','voice','voter','wagon','waist','waste',
  'watch','water','weary','weigh','weird','whale','wheat','wheel','where','which',
  'while','white','whole','widow','width','witch','woman','world','worry','worse',
  'worst','worth','would','wound','woven','wrist','write','wrong','wrote','yacht',
  'yeast','yield','young','youth','zebra',
];

// Every acceptable guess: the dictionary-derived list UNION the answers
// (so an answer is always guessable even if the dictionary lacked it).
const guessesFile = readFileSync(
  join(__dirname, '..', 'data', 'wordle-guesses.txt'),
  'utf-8',
);
export const VALID_GUESSES = new Set([
  ...guessesFile.split('\n').map((w) => w.trim()).filter(Boolean),
  ...ANSWERS,
]);

// djb2 string hash — small, fast, deterministic.
function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * The word of the day for a given date string 'YYYY-MM-DD'. Deterministic:
 * the date IS the seed, so there's nothing to store or schedule, and the
 * whole world (well, server) shares one word per day.
 */
export function wordOfTheDay(dateStr) {
  return ANSWERS[hash(dateStr) % ANSWERS.length];
}

/**
 * Scores a guess against the answer. Returns an array of five marks:
 * 'g' (green, right letter right spot), 'y' (yellow, in the word
 * elsewhere), 'b' (black/gray, not in the word).
 *
 * The duplicate-letter rule everyone gets wrong: each answer letter can
 * only "pay for" one mark. Greens are claimed first; yellows then consume
 * what's LEFT. Guess SOLAR vs answer ROAST: the single A goes green at
 * one position only; a second A in the guess would be gray, not yellow.
 * Implemented as the classic two-pass with a letter-count budget.
 */
export function scoreGuess(guess, answer) {
  const g = guess.toLowerCase().split('');
  const a = answer.toLowerCase().split('');
  const marks = new Array(5).fill('b');

  // Budget of answer letters not yet consumed by a green.
  const remaining = {};

  // Pass 1: greens claim their letters first.
  for (let i = 0; i < 5; i++) {
    if (g[i] === a[i]) {
      marks[i] = 'g';
    } else {
      remaining[a[i]] = (remaining[a[i]] ?? 0) + 1;
    }
  }

  // Pass 2: yellows consume from what's left, left to right.
  for (let i = 0; i < 5; i++) {
    if (marks[i] === 'g') continue;
    if (remaining[g[i]] > 0) {
      marks[i] = 'y';
      remaining[g[i]] -= 1;
    }
  }

  return marks;
}

// Emoji tile per mark, for the boards and the public spoiler-free grid.
const TILES = { g: '🟩', y: '🟨', b: '⬛' };

/** One spoiler-free emoji row for a score array. */
export function tilesRow(marks) {
  return marks.map((m) => TILES[m]).join('');
}

/**
 * A row WITH letters for the player's private board, e.g.
 * "🟨 🟩 ⬛ ⬛ ⬛  `C R A N E`" reads poorly — instead we show tiles then
 * the guess in monospace under it. This helper returns both lines.
 */
export function boardRow(guess, marks) {
  const letters = guess.toUpperCase().split('').join(' ');
  return `${tilesRow(marks)}  \`${letters}\``;
}

// Monies paid by solve attempt (index 1-6). Faster = richer.
const REWARDS = [0, 200, 200, 150, 100, 75, 50];

/** The payout for solving on attempt N (1-6). */
export function wordleReward(attempts) {
  return REWARDS[attempts] ?? 0;
}
