/* ────────────────────────────────────────────────────────────────
   MARVEL ARCHIVE — built-in trivia shared by the simulation core
   and the interface. Plain text only: the UI renders the strings
   directly, and the demo provider wraps them in markdown.
   ──────────────────────────────────────────────────────────────── */

export interface MarvelTrivia {
  id: string;
  subject: string;
  fact: string;
  keywords: string[];
}

export const MARVEL_TRIVIA: MarvelTrivia[] = [
  {
    id: 'ultron-origin',
    subject: 'Ultron',
    fact: 'First appeared in Avengers #54 in 1968, created by Roy Thomas and John Buscema; the full reveal followed in Avengers #55.',
    keywords: ['ultron', 'avengers #54', 'roy thomas', 'buscema'],
  },
  {
    id: 'jarvis-origin',
    subject: 'J.A.R.V.I.S.',
    fact: "In the comics the name belongs to Edwin Jarvis, the Avengers' human butler. The MCU turned him into Tony Stark's AI, whose voice and Mind Stone framework later become Vision.",
    keywords: ['jarvis', 'edwin jarvis', 'butler'],
  },
  {
    id: 'vision-origin',
    subject: 'Vision',
    fact: 'In the comics, Ultron built Vision from the android body of the original Human Torch. The MCU version is assembled from J.A.R.V.I.S., the Mind Stone and a vibranium body.',
    keywords: ['vision', 'who made vision', 'who created vision', 'mind stone', 'human torch'],
  },
  {
    id: 'infinity-stones',
    subject: 'Infinity Stones',
    fact: 'The six stones are Space, Mind, Reality, Power, Time and Soul. Comics readers first knew them as the Soul Gems before the modern Infinity Stones naming took hold.',
    keywords: ['infinity stone', 'infinity stones', 'soul gem', 'mind stone', 'infinity gauntlet'],
  },
  {
    id: 'vibranium',
    subject: 'Vibranium',
    fact: "The fictional metal is strongest in Wakanda. Captain America's shield is a vibranium-steel alloy, and Wakanda sits on the world's largest known deposit.",
    keywords: ['vibranium', 'wakanda', 'shield', 'captain america'],
  },
  {
    id: 'mjolnir',
    subject: 'Mjolnir',
    fact: "Forged from uru metal in the heart of a dying star. Odin's worthiness enchantment is why only the worthy can lift it.",
    keywords: ['mjolnir', 'thor', 'uru', 'worthy'],
  },
  {
    id: 'iron-man-debut',
    subject: 'Iron Man',
    fact: 'Debuted in Tales of Suspense #39 in 1963, created by Stan Lee, Larry Lieber, Don Heck and Jack Kirby.',
    keywords: ['iron man', 'tony stark', 'stark', 'tales of suspense'],
  },
  {
    id: 'shield-acronym',
    subject: 'S.H.I.E.L.D.',
    fact: 'Originally the Supreme Headquarters, International Espionage and Law-Enforcement Division. Later retcons expanded it to Strategic Homeland Intervention, Enforcement and Logistics Division.',
    keywords: ['s.h.i.e.l.d', 'shield', 'hydra', 'espionage'],
  },
  {
    id: 'avengers-mansion',
    subject: 'Avengers Mansion',
    fact: 'The team’s first headquarters was Avengers Mansion at 890 Fifth Avenue in Manhattan, staffed by Jarvis and protected by some very expensive automation.',
    keywords: ['avengers mansion', '890 fifth', 'headquarters', 'jarvis'],
  },
  {
    id: 'avengers-first-issue',
    subject: 'The Avengers #1',
    fact: 'Published in 1963, the founding lineup was Iron Man, Thor, Ant-Man, Wasp and Hulk. Captain America joined in issue #4.',
    keywords: ['avengers #1', 'founding', 'ant-man', 'wasp', 'hulk'],
  },
  {
    id: 'the-snap',
    subject: 'The Snap',
    fact: 'The Infinity Gauntlet #1 in 1991 introduced the comic-book snap. In the MCU, Thanos erased half of all life in Avengers: Infinity War (2018).',
    keywords: ['thanos', 'snap', 'infinity war', 'infinity gauntlet'],
  },
  {
    id: 'black-panther-debut',
    subject: 'Black Panther',
    fact: 'Debuted in Fantastic Four #52 in 1966, created by Stan Lee and Jack Kirby, and is widely credited as the first Black superhero in mainstream American comics.',
    keywords: ['black panther', 'fantastic four', 'wakanda', 't’challa'],
  },
  {
    id: 'spider-man-debut',
    subject: 'Spider-Man',
    fact: 'Debuted in Amazing Fantasy #15 in 1962. Stan Lee and Steve Ditko created him after a publisher rejected the idea of a teenage hero.',
    keywords: ['spider-man', 'spiderman', 'peter parker', 'amazing fantasy'],
  },
  {
    id: 'hulk-debut',
    subject: 'The Hulk',
    fact: 'Debuted in The Incredible Hulk #1 in 1962. His alter ego is Dr. Robert Bruce Banner, though the 1970s TV series popularized the middle name David.',
    keywords: ['hulk', 'bruce banner', 'incredible hulk'],
  },
  {
    id: 'hawkeye-debut',
    subject: 'Hawkeye',
    fact: 'Debuted in Tales of Suspense #57 in 1964 and began as an antagonist before joining the Avengers.',
    keywords: ['hawkeye', 'clint barton'],
  },
  {
    id: 'black-widow-debut',
    subject: 'Black Widow',
    fact: 'Debuted in Tales of Suspense #52 in 1964, also starting as an antagonist before defecting to the Avengers.',
    keywords: ['black widow', 'natasha romanoff'],
  },
  {
    id: 'i-am-iron-man',
    subject: '“I am Iron Man”',
    fact: 'Robert Downey Jr. improvised the line at the end of the 2008 film; the script originally had Tony Stark denying he was Iron Man.',
    keywords: ['i am iron man', 'improvised', 'robert downey', '2008'],
  },
  {
    id: 'doctor-strange-debut',
    subject: 'Doctor Strange',
    fact: 'Debuted in Strange Tales #110 in 1963, created by Stan Lee and Steve Ditko.',
    keywords: ['doctor strange', 'strange tales', 'stephen strange'],
  },
  {
    id: 'loki-debut',
    subject: 'Loki',
    fact: 'Debuted in Journey into Mystery #85 in 1962, created by Stan Lee, Larry Lieber and Jack Kirby.',
    keywords: ['loki', 'journey into mystery'],
  },
  {
    id: 'x-men-debut',
    subject: 'X-Men',
    fact: 'Debuted in X-Men #1 in 1963, created by Stan Lee and Jack Kirby.',
    keywords: ['x-men', 'xmen', 'mutants', 'professor x'],
  },
  {
    id: 'deadpool-debut',
    subject: 'Deadpool',
    fact: 'Debuted in New Mutants #98 in 1991, created by Rob Liefeld and Fabian Nicieza.',
    keywords: ['deadpool', 'wade wilson', 'new mutants'],
  },
];
