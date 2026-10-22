/**
 * All student onboarding copy, in one place so the tool walkthroughs and the Help page can't drift.
 * Only say what the screen itself doesn't. Grade 7 reading level: short sentences, no jargon.
 */

/** The six study tools, keyed by the tab that opens them. */
export type ToolKey =
  | 'tool_resources'
  | 'tool_flashcards'
  | 'tool_free_recall'
  | 'tool_feynman'
  | 'tool_adaptive_test'
  | 'tool_analytics';

/** Walkthroughs that run the first time a result exists (results replace the controls they'd follow). */
export type ResultKey =
  | 'tool_flashcards_study'
  | 'tool_free_recall_result'
  | 'tool_feynman_result';

/**
 * Keys are identities stored in onboarding_seen.step_key: never rename one. Bump `tour_v1` to re-show
 * a rewritten tour. Mirrored by OnboardingStepKeySchema in server/types/api.ts; edit both.
 */
export type OnboardingKey = 'tour_v1' | ToolKey | ResultKey;

export const ONBOARDING_KEYS: readonly OnboardingKey[] = [
  'tour_v1',
  'tool_resources',
  'tool_flashcards',
  'tool_free_recall',
  'tool_feynman',
  'tool_adaptive_test',
  'tool_analytics',
  'tool_flashcards_study',
  'tool_free_recall_result',
  'tool_feynman_result',
];

// The first-run tour

export interface TourStep {
  /** The `data-tour` value to spotlight, or null for a centred card. Steps with no anchor in the DOM are skipped. */
  anchor: string | null;
  title: string;
  body: string;
  /** Show example content in the card while this step is showing (only for cards empty on a new account). */
  demo?: boolean;
  /**
   * Hold the mobile menu open during this step. True for every sidebar-anchored step: the drawer
   * hides by transform, so the skip rule wouldn't catch it. No-op on desktop.
   */
  needsNav?: boolean;
}

/** The first-run tour: the sidebar, then the four dashboard cards. Written against the empty dashboard a new student sees. */
export const TOUR_STEPS: readonly TourStep[] = [
  {
    anchor: null,
    title: 'Welcome to LearnSync',
    body:
      'Your account is brand new, so nothing here belongs to you yet. Every number on this page starts empty and fills in as you study.\n\n' +
      'This quick look around takes about a minute. You can skip it now and play it again later from How to use, at the bottom of the menu.',
  },
  {
    anchor: 'nav',
    title: 'Five places, and that is all',
    body:
      'These five buttons are the whole app. Nothing is hidden anywhere else.\n\n' +
      'Dashboard is this page. It shows your progress in every subject at once. Spaces is where you actually study. Games turns your lessons into three games. Profile is your account and password. How to use is this tour, written down.\n\n' +
      'You will spend nearly all your time in Spaces. On a phone these five live behind the ☰ button at the top left — tap it any time to get back here.',
    needsNav: true,
  },
  {
    anchor: 'nav-spaces',
    title: 'Where your lessons live',
    body:
      'A Study Space holds one subject. One for Science, one for Filipino, and so on.\n\n' +
      'You never put lessons in yourself. As soon as you make a space, the lessons your teacher shared for your grade are already inside it. Anything they share later shows up for you too.\n\n' +
      'Each space has six tools in it: the lesson to read, flashcards, two writing exercises, tests, and your progress.',
    needsNav: true,
  },
  {
    anchor: 'dash-spaces',
    title: 'Your first move',
    body:
      'Your spaces will be listed here, each with a bar showing how far along you are.\n\n' +
      'Press this button to make your first one. You pick a name and a subject. The subject cannot be changed later, so pick the one you really want.\n\n' +
      'Until you do this, the rest of the app has nothing to work with.',
  },
  {
    anchor: 'dash-mastery',
    title: 'How much you actually know',
    body:
      'The big number is the app’s guess at how much of your lessons you still remember.\n\n' +
      'Only two things change it: rating a flashcard, and answering a test question. Games, Free Recall and Feynman do not. They help you learn, but they do not measure you.\n\n' +
      'It is a guess, not a grade from a teacher, so it can go down as well as up. The word under it (Foundational, Intermediate or Advanced) is the level you are at. The app uses that level to decide how hard your next test will be.',
    demo: true,
  },
  {
    anchor: 'dash-streak',
    title: 'One day, one activity',
    body:
      'Your streak counts how many days in a row you studied. Not hours, and not how much you did.\n\n' +
      'Anything keeps it going: one flashcard, one game, even one question to the study assistant. The day changes at midnight, Philippine time.\n\n' +
      'Miss a day and it drops back to zero. Any badges you already earned stay yours for good.',
    demo: true,
  },
  {
    anchor: 'dash-badges',
    title: 'Badges you keep',
    body:
      'Badges are small rewards you keep forever. There are fourteen to collect.\n\n' +
      'Some are for streaks: three, five and seven days in a row. Some are for doing something the first time. Some are for learning a lot of concepts. You get your first one as soon as you study anything.\n\n' +
      'The number in the corner is how many you have. See all badges shows the full list, including the ones you have not got yet and how close you are.',
    demo: true,
  },
  {
    anchor: 'dash-recent',
    title: 'Where you left off',
    body:
      'The last few things you did, newest at the top. Which test you took, which game you played, which lesson you wrote about.\n\n' +
      'It is here so you can carry on where you stopped instead of searching through your spaces. Each line says the subject, so once you have a few spaces going you can see what you touched last.',
    demo: true,
  },
  {
    anchor: 'nav-games',
    title: 'The same lessons, as games',
    body:
      'Three games made from the lessons in your own spaces: Term Matching, Crossword and Timed Trivia.\n\n' +
      'The questions come from your teacher’s lessons, not from the internet, so playing is real review. The app also sets how hard they are from what you already know, and picks more of the concepts you are weakest at.\n\n' +
      'Playing never changes your mastery number. Games are for practice, so you can try things without it counting against you.',
    needsNav: true,
  },
  {
    anchor: 'nav-help',
    title: 'If you get stuck',
    body:
      'Everything in this tour is written down here, one section at a time, with short steps for each tool.\n\n' +
      'There is a button at the top to play this tour again whenever you want.\n\n' +
      'And if you are ever stuck on something the page does not explain, or you cannot get into your account, this page tells you who to ask.',
    needsNav: true,
  },
];

// Example content, shown only while a tour step is on its card

/**
 * The one place the app shows data a student didn't produce. It exists only while its tour step is
 * on screen, carries an EXAMPLE chip, and never persists. Badges are real catalogue entries.
 */
export const DEMO_MASTERY = {
  /** Mid-intermediate: clearly progress, clearly not finished. */
  overall: 0.62,
  concepts_assessed: 18,
  concepts_total: 29,
} as const;

export const DEMO_STREAK_DAYS = 5;

export const DEMO_BADGE_NAMES: readonly string[] = [
  'streak_3',
  'first_flashcard',
  'mastery_1',
];

/** Shape-compatible with `ActivityItem`, minus the ids nothing renders. */
export const DEMO_RECENT: readonly { kind: 'test' | 'free_recall' | 'game'; text: string; when: string }[] = [
  { kind: 'test', text: 'Scored 80% on a test in Science', when: '2 hours ago' },
  { kind: 'free_recall', text: 'Wrote a free recall in Science', when: 'Yesterday' },
  { kind: 'game', text: 'Played Term Matching in Filipino', when: 'Yesterday' },
];

// Study-tool intros

export interface ToolIntro {
  title: string;
  body: string;
}

/** What each tool is, in a sentence or two. Used as the first walkthrough step and in Help. */
export const TOOL_INTROS: Record<ToolKey, ToolIntro> = {
  tool_resources: {
    title: 'Your teacher’s lessons live here',
    body:
      'Pick a lesson from the list on the left and it opens on the right, just as your teacher uploaded it.\n\n' +
      'A lesson that says “Being prepared” is still being read by the app. Wait a minute and it will be ready. One that says “Not available” could not be opened at all, so your teacher needs to upload it again.',
  },
  tool_flashcards: {
    title: 'Cards that come back when you need them',
    body:
      'Flashcards test you on one idea at a time. A deck is a folder you make and name. The cards inside are made from a lesson, and the answer on the back is always your teacher’s exact words.\n\n' +
      'You never write cards yourself. You pick a lesson, and every important word in it becomes one card.',
  },
  tool_free_recall: {
    title: 'Write it down without looking',
    body:
      'This is the hardest thing in the app and the most useful. You close your notes and write down everything you can remember about a lesson.\n\n' +
      'The app then checks what you wrote against the ideas in that lesson and shows you which ones you missed. Trying hard to remember without looking is what really builds memory. Reading your notes again feels easier but works much less well.',
  },
  tool_feynman: {
    title: 'Explain it to a ten-year-old',
    body:
      'Named after a scientist who said you only really understand something if you can explain it simply.\n\n' +
      'You pick an idea and explain it in your own words, as if you were teaching a ten-year-old. The app checks two things: whether you got it right, and whether you kept it simple.',
  },
  tool_adaptive_test: {
    title: 'A test built from one lesson',
    body:
      'A real test, made from one lesson, with one question for every idea in it. Nothing gets asked twice in the same test.\n\n' +
      'How hard it is depends on what you already know. The more you have learned in that lesson, the harder the questions. That is why a test can feel harder than your last one even when you are getting better.',
  },
  tool_analytics: {
    title: 'What the numbers mean',
    body:
      'Your progress in this space, lesson by lesson and idea by idea.\n\n' +
      'It only shows a number for ideas you have actually been asked about in a flashcard or a test. An idea with no bar has not come up yet. That is not the same as getting zero on it, and it is why the totals look small at first.',
  },
};

// Per-tool walkthroughs

/**
 * Spotlight walkthroughs run the first time each tool opens. Step one is the TOOL_INTROS sentence
 * verbatim. Every anchor after the first may be absent (e.g. no lessons yet), so no step assumes the
 * previous one ran. Results are taught by separate walkthroughs.
 */
export const TOOL_TOURS: Record<ToolKey, readonly TourStep[]> = {
  tool_resources: [
    { anchor: 'res-list', title: TOOL_INTROS.tool_resources.title, body: TOOL_INTROS.tool_resources.body },
    {
      anchor: 'res-viewer',
      title: 'The lesson itself',
      body:
        'Whatever you pick on the left opens here. You can scroll it and zoom in, like any document.\n\n' +
        'Nothing you do while reading is recorded. Reading is not tracked. Only flashcards and tests change your progress.',
    },
    {
      anchor: 'res-chat-fab',
      title: 'Ask about this lesson',
      body:
        'This opens a study assistant you can ask questions in your own words.\n\n' +
        'It has only read the lesson you picked on the left, so it will politely say no to anything else. That is on purpose. It means it cannot make up an answer from outside your lessons.\n\n' +
        'Pick a lesson first or it has nothing to talk about. There are also quick buttons for Summarize, Explain Simply, Quiz Me and Key Terms.',
    },
  ],
  tool_flashcards: [
    { anchor: 'fc-header', title: TOOL_INTROS.tool_flashcards.title, body: TOOL_INTROS.tool_flashcards.body },
    {
      anchor: 'fc-new-deck',
      title: 'Start with a deck',
      body:
        'Make a deck first and give it a name, like “Science Quarter 2”. It starts out empty.\n\n' +
        'Then press Add Cards, pick a lesson, and the app makes one card for every important word in it. A deck can hold more than one lesson, so a whole subject can live in one place.',
    },
    {
      anchor: 'fc-decks',
      title: 'Your decks',
      body:
        'Each deck tells you how many cards it has and how many are ready for you today.\n\n' +
        'Press Review and it only asks the cards that are ready. That is the point: you spend your time on what you are about to forget, instead of what you already know well.',
    },
  ],
  tool_free_recall: [
    { anchor: 'fr-material', title: TOOL_INTROS.tool_free_recall.title, body: TOOL_INTROS.tool_free_recall.body },
    {
      anchor: 'fr-input',
      title: 'Type it from memory',
      body:
        'Write everything you remember here, in full sentences and in your own words. Do not open your notes. The struggle to remember is the part that works.\n\n' +
        'Just naming an idea is not enough. Writing “the network layer” on its own gets you nothing. Saying what the network layer does will count.',
    },
    {
      anchor: 'fr-submit',
      title: 'Then press this',
      body:
        'Press this when you are done. It takes a few seconds, then your score and feedback take the place of this box.\n\n' +
        'You will get a list of the ideas you did not mention, and a note if anything you wrote does not match the lesson.',
    },
  ],
  tool_feynman: [
    { anchor: 'fey-material', title: TOOL_INTROS.tool_feynman.title, body: TOOL_INTROS.tool_feynman.body },
    {
      anchor: 'fey-concepts',
      title: 'Pick what to explain',
      body:
        'Pick a lesson first, then tick the ideas you want to explain. A writing box appears for each one you tick.\n\n' +
        'Start with two or three. Explaining one thing well is worth much more than rushing through ten.',
    },
    {
      anchor: 'fey-submit',
      title: 'Then press this',
      body:
        'Press this once every box is filled in.\n\n' +
        'You get two marks back and they work separately. You can be completely right and still get a low simplicity mark if you copied the textbook instead of using your own words.',
    },
  ],
  tool_adaptive_test: [
    { anchor: 'at-new-test', title: TOOL_INTROS.tool_adaptive_test.title, body: TOOL_INTROS.tool_adaptive_test.body },
    {
      anchor: 'at-stats',
      title: 'How you are doing',
      body: 'Your totals for every test you have taken in this space: how many you have done, your average score, and how many questions you have answered in total.',
    },
    {
      anchor: 'at-past-tests',
      title: 'Every test you have taken',
      body:
        'Every test you finish is kept here for good.\n\n' +
        'Open one to see each question again next to the right answer. Looking back at the ones you got wrong is usually far more useful than the score itself.',
    },
  ],
  tool_analytics: [
    { anchor: 'an-header', title: TOOL_INTROS.tool_analytics.title, body: TOOL_INTROS.tool_analytics.body },
    {
      anchor: 'an-summary',
      title: 'Your totals for this space',
      body:
        'How much of this space you have covered so far.\n\n' +
        'A dash instead of a number means nothing has been measured yet. The app is not saying you got zero. It is saying it has not asked you anything yet.',
    },
    {
      anchor: 'an-lessons',
      title: 'Lesson by lesson',
      body:
        'Every lesson in this space, with how much of it you remember.\n\n' +
        'Open one to see it idea by idea. That is how you find the exact parts to go back to, instead of reading a whole lesson you mostly know already.',
    },
  ],
};

/**
 * Run the first time a result appears; two steps at most. They cover the most misread facts: low Free
 * Recall percentages are normal, Feynman's two marks are independent, ratings are scheduling, not grades.
 */
export const RESULT_TOURS: Record<ResultKey, readonly TourStep[]> = {
  tool_free_recall_result: [
    {
      anchor: 'fr-score',
      title: 'What this percentage means',
      body:
        'This is a coverage score. It is how many of the lesson’s ideas you wrote about, out of all the ideas the app found in it. It is not a mark out of 100.\n\n' +
        'A lesson gets split into a lot of small ideas, often twenty or thirty. So writing about eight or nine of them is a normal, decent try. Around 30% on your first go is a good result, not a fail.',
    },
    {
      anchor: 'fr-missed',
      title: 'Two things to know about it',
      body:
        'First, never compare this number with a score on a different lesson. A longer lesson has more ideas in it, so the same quality of memory gives you a smaller percentage. Only compare it with your own earlier try on the same lesson. The app does that for you and tells you if you got better.\n\n' +
        'Second, open this list to see exactly which ideas you left out. That is your review list for next time, and it is the most useful thing on this screen.',
    },
  ],
  tool_feynman_result: [
    {
      anchor: 'fey-scores',
      title: 'Two separate marks',
      body:
        'These two marks measure different things and move on their own.\n\n' +
        'Accuracy is whether what you said matches the lesson. Simplicity is whether a ten-year-old could have followed it. A clear, confident explanation of the wrong thing gets a high mark on one and a low mark on the other. Copying the textbook word for word does the opposite.\n\n' +
        'Below this, each idea you explained is marked on its own with a note on what to fix.',
    },
  ],
  tool_flashcards_study: [
    {
      anchor: 'fc-card',
      title: 'Read, then flip',
      body:
        'Read the front and try to answer in your head before you flip it. That moment of trying is what makes flashcards work. Flipping straight away turns it into reading, which does far less for you.\n\n' +
        'Press the card or hit the space bar to flip it. The back is your teacher’s own words, exactly as they wrote them.',
    },
    {
      anchor: 'fc-rating',
      title: 'Be honest here',
      body:
        'This is not a grade. It decides when you will see the card again. Hard brings it back tomorrow, Medium in three days, Easy in seven.\n\n' +
        'Answer honestly. Pressing Easy on something you actually guessed just hides that card from you for a week.\n\n' +
        'These three buttons are also the only thing besides tests that changes your mastery number. An honest Hard is worth more to you than an Easy that flatters you.',
    },
  ],
};

/** Every walkthrough, keyed by the step key that records it. */
export const TOURS: Partial<Record<OnboardingKey, readonly TourStep[]>> = {
  tour_v1: TOUR_STEPS,
  ...TOOL_TOURS,
  ...RESULT_TOURS,
};

// The Help page

export interface HelpSection {
  id: string;
  title: string;
  /** For the six tools this is the intro string above, verbatim. */
  intro: string;
  /** Short imperative steps. Kept to four or fewer; a longer list is not read. */
  how: readonly string[];
}

/** Tool sections reuse TOOL_INTROS verbatim; Study Spaces, Games and Streaks are written here only. */
export const HELP_SECTIONS: readonly HelpSection[] = [
  {
    id: 'spaces',
    title: 'Study Spaces',
    intro:
      'A Study Space is one subject, like Science or Filipino. It opens already holding the lessons your teacher shared for your grade. You do not upload anything yourself, and you cannot delete a lesson.',
    how: [
      'Go to Spaces and choose New Space.',
      'Give it a name and pick the subject. The subject cannot be changed afterwards.',
      'Open it. If your teacher shares something new later, the space tells you and you press Add.',
    ],
  },
  {
    id: 'resources',
    title: 'Learning Resources',
    intro: TOOL_INTROS.tool_resources.body,
    how: [
      'Pick a lesson from the list on the left to read it.',
      'A lesson marked Being prepared is not ready yet. Wait a minute.',
      'Press the sparkle button to ask the study assistant about the lesson you picked.',
    ],
  },
  {
    id: 'flashcards',
    title: 'Flashcards',
    intro: TOOL_INTROS.tool_flashcards.body,
    how: [
      'Make a deck, then choose Add Cards and pick a lesson.',
      'Press Review on a deck, read the front, then flip it. Review only asks the cards that are due today; when none are, the deck shows the day they come back.',
      'Rate yourself honestly. Hard brings the card back tomorrow, Medium in three days, Easy in seven.',
      'Open a deck and press Shuffle to mix up the order, so you learn the ideas and not the sequence.',
      'The menu beside it reorders the deck instead. Hardest first brings up the cards you found hard last time. A card only gets a rating when you review it on the day it is due, so a new deck has none yet and that order will not change anything.',
      'In the same place, Show in front lets you swap the sides. Put the Definition in front and you have to remember the word instead, which is harder and worth doing once you know a deck well. Each deck remembers its own setting.',
    ],
  },
  {
    id: 'free-recall',
    title: 'Free Recall',
    intro: TOOL_INTROS.tool_free_recall.body,
    how: [
      'Choose a lesson, then put your notes away.',
      'Type everything you can remember, in your own words.',
      'Press Evaluate Recall. Just naming an idea is not enough. Say what it does, or it will not count.',
    ],
  },
  {
    id: 'feynman',
    title: 'Feynman Technique',
    intro: TOOL_INTROS.tool_feynman.body,
    how: [
      'Choose a lesson, then tick the ideas you want to explain.',
      'Explain each one as if the person listening is ten years old.',
      'Everyday comparisons help. They are part of what the second mark rewards.',
    ],
  },
  {
    id: 'test-mode',
    title: 'Test Mode',
    intro: TOOL_INTROS.tool_adaptive_test.body,
    how: [
      'Choose a lesson, then choose which kinds of question you want.',
      'The app decides how many questions. There is one for every idea in the lesson.',
      'A question you skip counts as wrong, so answer it even if you are guessing.',
    ],
  },
  {
    id: 'analytics',
    title: 'Analytics',
    intro: TOOL_INTROS.tool_analytics.body,
    how: [
      'Only flashcards and tests move these numbers. Free Recall, Feynman and the games do not.',
      'Open a lesson in the list to see it idea by idea.',
      'Focus next shows your weakest ideas, but only ones you have actually been tested on.',
    ],
  },
  {
    id: 'games',
    title: 'Games',
    intro:
      'Three games: Term Matching, Crossword and Timed Trivia. They are built from the lessons in your own study space, not from random questions. They are for practice, so playing one never changes your mastery numbers.',
    how: [
      'Go to Games and pick one of the three.',
      'Choose a space and at least one lesson, then Build and Launch.',
      'The game is made fresh each time, so Play Again gives you a different one.',
    ],
  },
  {
    id: 'streaks',
    title: 'Streaks and badges',
    intro:
      'Your streak counts days, not hours. Studying anything at all keeps today’s streak alive: a flashcard, a test, a game, even a question to the study assistant. Badges are yours for good once you earn them, and breaking a streak never takes one away.',
    how: [
      'Do any one activity each day to keep the streak going.',
      'Your dashboard shows the badges you have. See all badges shows what is left to earn.',
    ],
  },
];
