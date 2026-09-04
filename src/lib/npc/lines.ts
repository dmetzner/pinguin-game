/**
 * Everything an islander can say. All of it written by us, none of it typed by anybody.
 *
 * **This is the half of invariant 4 that people get backwards, so it is worth saying plainly at the
 * top of the file that holds the words.** `docs/DECISIONS/0004` bans free text *between players*: a
 * name over a head, seen by children, chosen by an adult who found the room. A line in this file is
 * not that. It is authored content, reviewed once, identical on every device, and it can no more
 * carry a stranger's message than the word "Rathausplatz" on a sign can. So: **NPCs get words,
 * players get emotes** (`lib/emote.ts`), and the arrow never points the other way. If a future
 * feature needs an islander to repeat something a player supplied, it is the wrong feature.
 *
 * The register, matched to `names.ts` rather than invented here: sounds over meanings, jokes that
 * need no explaining, and nothing that talks down. An eight-year-old notices being talked down to
 * faster than an adult does. The house rule that falls out of it — every line is at most two short
 * sentences, because the bubble is over a game and a child who has to stop and read has stopped
 * playing.
 *
 * Two pools, and the split is the design:
 *
 *  * **`ZONE_LINES`** — about a PLACE, and shared by whoever is standing in it. This is where a child
 *    learns what a Royal is without a tutorial screen: the rules arrive from a penguin on the square,
 *    in the second before they walk into the game. Shared rather than per-character because the rules
 *    of the classic round do not change with who explains them.
 *  * **`OWN_LINES`** — about a PENGUIN. Jokes, small talk, half a story. This is what makes the eight
 *    of them people rather than signposts, and it is what a child comes back for.
 *
 * `talk.ts` alternates the two, starting with the place. Both halves matter and neither is enough:
 * only zone lines is a museum audio guide, only own lines is eight strangers who never mention the
 * enormous mountain they are standing on.
 *
 * Pure data. No clock, no randomness, no state — the choosing happens in `talk.ts`.
 */
import { EIS_FOR_FINISHING, EIS_FOR_WINNING } from '../eis';
import type { EmoteId } from '../emote';
import { priceOf } from '../igloo';
import type { IslanderId } from './cast';

/**
 * What the first room costs, DERIVED rather than typed into a sentence.
 *
 * `igloo.ts` prices the ladder as a whole number of WINS — `(n + 2)²` of them — precisely so a child
 * can plan against it without arithmetic, and a line here that said "40 Eis" would still say it on
 * the afternoon somebody moves either payout constant. So the neighbour quotes both halves from the
 * same two functions the build button does, and cannot be made to lie by a change somewhere else.
 *
 * Only the FIRST rung is ever named out loud. A neighbour who priced the tower for a child who has
 * not bought a room yet would be describing a shop they cannot reach — and the price a player is
 * standing in front of belongs on the build screen, which knows which rung they are on.
 */
const FIRST_ROOM_EIS = priceOf(0);
const FIRST_ROOM_WINS = FIRST_ROOM_EIS / (EIS_FOR_FINISHING + EIS_FOR_WINNING);

/**
 * What there is to say about each place, keyed by `IslandZone.id`.
 *
 * Every game zone's pool answers the question a child is about to have — what is this game, and what
 * is the one thing that will kill me — because the door sign has room for a name and one line and
 * this is where the rest of it goes. `lines.test.ts` holds every pool to a minimum size, since a
 * pool of two is a penguin that repeats itself in the time it takes to walk past.
 */
export const ZONE_LINES: Readonly<Record<string, readonly string[]>> = {
	// Rathausplatz → Royal. Thirty penguins and breaking ice: the two facts that decide the round.
	square: [
		'Hier treffen sich dreißig Pinguine. Dreißig! Ich hab sie mal gezählt und bin eingeschlafen.',
		'Beim Royal brechen die Schollen. Nicht alle — aber irgendwann deine.',
		'Wenn das Eis knirscht, hast du drei Sekunden. Danach wird es nass.',
		'Du hast zwei Sprünge: einen vom Eis und einen mitten in der Luft. Der zweite rettet mehr, als man denkt.',
		'Wer am Ende noch steht, gewinnt. Klingt einfach. Ist es nicht.',
		'Bleib nicht in der Mitte stehen. Da stehen alle. Deshalb kippt sie da.'
	],
	// Eisarena → Klassisch. The smallest game, and the only one where shoving is the whole point.
	arena: [
		'Vier Pinguine, eine Scholle, und die wird immer kleiner. Mehr Regeln gibt es nicht.',
		'Schubsen ist erlaubt! Aber Achtung: wer schubst, rutscht selber mit.',
		'Schneebälle sind gemein. Ich mag Schneebälle.',
		'Am Rand ist es am gefährlichsten. Und am spannendsten.',
		'Loslassen bremst nicht. Auf Eis rutschst du einfach weiter. Das vergisst jeder einmal.',
		'Ich hab hier neulich gewonnen. Also fast. Ich war Zweite von zwei.'
	],
	// Der Berg → Rutschpartie. A race, on your belly, with nobody allowed to touch you.
	mountain: [
		'Von hier oben siehst du das ganze Meer. Und ganz unten das Ziel. Sehr weit unten.',
		'Runter geht es auf dem Bauch. Lenken mit dem Daumen, Buckel mit Hüpf.',
		'Hier schubst niemand. Beim ersten Mal lagen sofort alle im Wasser.',
		'Wer zuerst unten ist, gewinnt. Bremsen ist keine Taktik.',
		'Die Gondel fährt nur nach oben. Runter rutschst du selber.',
		'Die Buckel kommen plötzlich. Spring drüber, dann fliegst du ein Stück.'
	],
	// Robbenhöhle → Flucht. The one rule worth knowing is that running always beats standing.
	cave: [
		'Pssst. Da unten schläft die Robbe. Meistens.',
		'Die Robbe ist langsamer als du. Ehrlich! Sie holt nur die, die stehen bleiben.',
		'Ich geh da nicht rein. Ich halte Wache. Von hier. Von ganz weit weg.',
		'Wenn du die weiße Spur im Wasser siehst, ist sie schon hinter dir.',
		'Lauf bis zum Strand, dann kann nichts mehr passieren. Der Strand ist… ziemlich weit.',
		'Zwischen den Eisplatten sind Löcher. Die sind da, damit du springst.'
	],
	// Mein Iglu — the player's OWN front door, and the only zone with no game behind it.
	//
	// Two things shape every line here. It is a DOORSTEP, so nobody standing on it is advertising a
	// round; a line that promised one would be a lie, because `Door.kind` is 'home' and the button
	// says "Bauen". And the igloo engineer's own report is that the whole feature is invisible —
	// nothing on the island tells a child that spending is a thing you can do — so this pool is one of
	// the two places that can fix it, and the warmer one. Hence a price said out loud, once, in both
	// the units a child has: Eis, and wins.
	//
	// Nothing here promises furniture. Inside there is a bed and nothing else, and Deko is a later
	// story: a neighbour enthusing about a sofa that does not exist is the same broken promise as a
	// door with no game behind it.
	igloo: [
		'Da wohnst du also! Ich schau öfter mal vorbei. Nicht rein — nur so, von außen.',
		`Größer wohnen kostet ${FIRST_ROOM_EIS} Eis. Das sind ${FIRST_ROOM_WINS} Siege — ein Nachmittag.`,
		'Das Eis, das du in den Spielen sammelst, kannst du hier verbauen. Wusstest du das?',
		'Ganz oben kann mal ein Turm hin. Dann siehst du bis zum Berg. Später!',
		'Drinnen ist bis jetzt ein Bett. Ein sehr gutes Bett, wohlgemerkt.',
		'Meins ist kleiner. Ich sag das ganz ohne Neid. Fast ganz ohne.'
	],
	// Der Laden. A place before it is a screen (story 10d), and the copy says so honestly.
	shop: [
		'Mützen! Ich hab Mützen. Bald. Der Laden macht bald auf.',
		'Eis sammelst du beim Spielen. Auch beim Verlieren — ein bisschen.',
		'Eine Krone macht dich nicht schneller. Aber sie macht dich zur Königin.',
		'Alles hier ist Deko. Nichts davon macht dich stärker. Das ist Absicht.',
		'Guck ruhig durchs Fenster. Drin ist noch nichts, aber das Fenster ist schön.'
	]
};

/**
 * Who each of them is, in four or five lines.
 *
 * Deliberately unfinished stories and jokes with the punchline missing: a child who walks away and
 * comes back gets the next one, and a character who says everything the first time is a character
 * nobody visits twice. Nothing here mentions any penguin BY NAME, including their own — the names are
 * drawn from the generator (`cast.ts`) and a line that spelled one out would be the first hand-typed
 * name in the game.
 */
export const OWN_LINES: Readonly<Record<IslanderId, readonly string[]>> = {
	racer: [
		'Ich hab heute schon vier Runden gespielt. Vier! Kommst du mit?',
		'Aufwärmen ist wichtig. Ich wärme mich seit heute Morgen auf.',
		'Verlieren ist okay. Nochmal verlieren ist auch okay. Aufhören nicht.',
		'Rennen kann ich super. Bremsen üb ich noch.'
	],
	gondolier: [
		'Ich fahr die Gondel seit hundert Jahren. Also seit letztem Winter.',
		'Oben ist es kalt und windig. Genau richtig.',
		'Einmal ist mir die Mütze runtergefallen. Die liegt jetzt unten im Ziel.',
		'Festhalten! Ich sag das immer. Es hört nie jemand.'
	],
	lookout: [
		'Hast du das gehört? … Nein? Gut. Ich auch nicht.',
		'Ich bin nicht ängstlich. Ich bin sehr, sehr vorsichtig.',
		'Meine Schwester war da unten. Sie kam zurück. Aber sie erzählt nichts.',
		'Wenn ich renne, renne ich zum Laden. Da gibt es keine Robben.'
	],
	shopkeeper: [
		'Ich sortiere schon mal die Mützen. Nach Farbe. Dann nochmal nach Lieblingsfarbe.',
		'Kommst du wieder? Sag Ja. Dann sag ich auch Ja.',
		'Ein Pinguin mit Krone ist immer noch ein Pinguin. Aber mit Krone!',
		'Der schönste Hut ist der, den sonst keiner hat. Sagt mein Onkel. Der hat zwei.'
	],
	neighbour: [
		'Guten Tag, Nachbar! Oder Nachbarin. Eins von beidem stimmt bestimmt.',
		'Ich hab dein Haus von hier aus gezählt. Einmal. Es ist eins.',
		'Spar dein Eis. Also, gib es aus — aber für was Schönes.',
		'Wenn du baust, hör ich das. Ich hör alles. Ich wohn ja direkt daneben.'
	],
	professor: [
		'Wusstest du: eine Scholle kippt dahin, wo die meisten stehen. Physik!',
		'Ich schreibe ein Buch über Schollen. Es hat bis jetzt eine Seite.',
		'Wenn du den Daumen loslässt, bremst du nicht. Du rutschst weiter. Das überrascht alle.',
		'Frag mich was richtig Schweres. … Nein, doch nicht.'
	],
	joker: [
		'Warum haben Pinguine keine Taschen? Weil sowieso nichts reinpasst. Hihi.',
		'Ich hatte einen Witz über Eis. Der ist leider geschmolzen.',
		'Klopf klopf. — Wer ist da? — Eine Welle. Zu spät, sie ist schon weg.',
		'Mein bester Witz dauert zwei Stunden. Willst du? … Dachte ich mir.'
	],
	granny: [
		'Früher war die Scholle größer. Oder ich war kleiner. Eins von beidem.',
		'Ich hab mal einen Wal gesehen. Er hat gewinkt. Also ungefähr.',
		'Setz dich ruhig… ach nein, hier gibt es keine Bank. Dann stehen wir eben.',
		'Als ich klein war, gab es nur ein Spiel. Und das war dasselbe.'
	],
	chick: [
		'Ich darf noch nicht auf den Berg. Nächstes Jahr! Vielleicht.',
		'Ich kann schon hüpfen. Guck mal! … Hast du geguckt?',
		'Bist du neu hier? Ich auch. Seit ganz lange.',
		'Meine Mama sagt, ich soll nicht ans Wasser. Ich bin ein Pinguin!'
	]
};

/**
 * What an islander says back when the player emotes at them.
 *
 * The reason this exists rather than being a nice-to-have: an emote a nobody answers is a button that
 * makes a picture. An emote somebody answers is a CONVERSATION, and it is the only conversation this
 * game will ever allow — the player picks from six, the island replies in words we wrote. That is the
 * whole shape of invariant 4 working as intended rather than merely being obeyed, and it is why the
 * reply pool is here beside the talk and not bolted onto the picker.
 *
 * `grumpy` is answered warmly on purpose. A child who says "Grr!" has usually just been shoved into
 * the sea, and the island being kind about it is worth more than the island being funny about it.
 */
export const EMOTE_REPLIES: Readonly<Record<EmoteId, readonly string[]>> = {
	wave: ['Hallo auch!', 'Hallihallo!', 'Ich winke zurück. Siehst du? So winke ich.'],
	heart: [
		'Oh! Das ist lieb.',
		'Ich hab dich auch gern. Also, als Insel-Kumpel.',
		'Jetzt wird mir ganz warm. Bei dem Wetter!'
	],
	laugh: [
		'Hihi. Was war denn so lustig?',
		'Lachen ist gesund. Sagt der Professor.',
		'Ansteckend! Jetzt muss ich auch.'
	],
	grumpy: [
		'Ohje. Wer hat dich denn geärgert?',
		'Einmal tief durchatmen. Hilft immer.',
		'Grrr zurück! … okay, das war albern.'
	],
	dance: [
		'Tanz weiter, ich guck zu!',
		'Das kann ich auch. Nur nicht so gut.',
		'Musik hab ich leider keine. Denk dir welche.'
	],
	oops: [
		'Alles heil?',
		'Passiert den Besten. Und mir sowieso.',
		'Aufstehen, Mütze richten, weitermachen.'
	]
};
