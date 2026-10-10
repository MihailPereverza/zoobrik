export type Skill = 'recognize' | 'recall' | 'listen' | 'spell' | 'context' | 'apply';
export type Grade = 1 | 2 | 3 | 4;
export type Mode = 'intro' | 'learn' | 'review' | 'practice';
export type ExerciseStatus = 'draft' | 'ready' | 'off';
export type SkillPhase = 'new' | 'learning' | 'review' | 'relearning';
export type Stage = 'new' | 'learning' | 'review' | 'mastered' | 'suspended';

export interface SkillState {
  state: SkillPhase;
  s: number;
  d: number;
  due: string;
  last?: string;
  reps: number;
  lapses: number;
  step: number;
}

export interface ExerciseStats { shown: number; correct: number; avg_ms: number; last?: string }

export interface Progress {
  stage: Stage;
  introduced?: string;
  as_of?: string;
  totals: { answers: number; correct: number; lapses: number };
  skills: Partial<Record<Skill, SkillState>>;
  exercises: Record<string, ExerciseStats>;
  recent: string[];
  buried_until?: string;
  leech?: boolean;
  /** The card's single FSRS memory (Rule A); old per-skill `skills` stay only as history. */
  memory?: SkillState;
  /** Position on the deck's ladder of exercise formats. */
  rung?: number;
}

export interface Example { id: string; term: string; meaning: string; audio?: string }

export interface CardContent {
  term?: string;
  meaning?: string;
  alt?: string[];
  pos?: string;
  ipa?: string;
  audio?: string;
  note?: string;
  confusables?: string[];
  title?: string;
  formula?: string;
  theory?: string;
  examples?: Example[];
  /** Irregular forms of the term (went, gone) — still this word for Rule B. */
  forms?: string[];
}

export interface Exercise {
  id: string;
  template: string;
  skill?: Skill | Skill[];
  status: ExerciseStatus;
  from?: string;
  file?: string;
  params: Record<string, any>;
  cards?: Record<string, Skill>;
  view?: string;
  style?: string;
  check?: { type: string; expected?: string };
  /** 1 (easy) … 5 (traps); overrides the template's difficulty, so learning goes from easy to hard. */
  difficulty?: number;
  /** Locked until these cards are introduced (a contrast that belongs after them). */
  needs?: string[];
  /** Words that never lock this exercise. */
  allow?: string[];
}

export interface TemplateSource {
  id: string;
  scope: string;
  manifest: TemplateManifest;
  view: string;
  style: string;
  logic: string | null;
}

export interface TemplateManifest {
  id: string;
  name?: string;
  trains?: Skill[];
  reveals?: string[];
  asks?: string[];
  difficulty?: number;
  modes?: Mode[];
  check?: { type: string };
  params?: Record<string, { type: string; label?: string; required?: boolean }>;
  autoplay?: boolean;
}

/** One line of a listening transcript; words carry their own timing so the text can follow the audio. */
export interface Segment { start: number; end: number; speaker?: string; text: string; words: [string, number, number][] }

/** A listening card's clip: media file in the card folder, its timed transcript and where it comes from. */
export interface Listening {
  media: string;
  poster?: string;
  duration?: number;
  segments: Segment[];
  source?: { name: string; url?: string; license?: string; credit?: string };
}

export interface Card {
  id: string;
  tags?: string[];
  kind: 'word' | 'phrase' | 'idiom' | 'grammar' | 'listening';
  listening?: Listening;
  topic: string;
  path: string;
  content: CardContent;
  theory: string | null;
  exercises: Exercise[];
  templates: TemplateSource[];
  progress?: Progress;
}

export interface Topic {
  id: string;
  title: string;
  description?: string;
  kind?: 'vocab' | 'grammar' | 'listening';
  level?: string;
  requires?: string[];
  batch?: number;
  order?: string[];
  gate?: { min_stability?: string; skills?: Skill[] };
  cards: Card[];
  exercises: Exercise[];
  templates: TemplateSource[];
}

export interface DeckConfig {
  id?: string;
  name: string;
  description?: string;
  lang?: { target?: string; native?: string };
  version?: string;
  author?: string;
  source?: DeckSource;
  limits: { new_cards_per_day: number; reviews_per_day: number; max_backlog_ratio?: number };
  fsrs: {
    /** One number for the card's memory; an old per-skill map still works (its `recall` is used). */
    retention: number | Partial<Record<Skill, number>>;
    params?: number[] | null;
    learning_steps?: string[];
    relearning_steps?: string[];
    max_interval?: string;
    leech_threshold?: number;
    leech_action?: 'tag' | 'suspend';
    load_balance?: boolean;
    easy_days?: number[];
  };
  /** max_per_day: graded exercises per card per day (default 3). */
  cycle?: { cards?: number; min_gap?: number; max_exercises_per_card?: number; max_per_day?: number };
  /** Formats a card climbs, easiest first (default recognize → recall → context → listen → apply). */
  ladder?: Skill[];
  listening?: { min_coverage?: number };
}

export interface DeckSource { url: string; imported?: string; version?: string; media?: string }

export interface DeckData {
  /** Folder of the deck inside its library: '' for a deck at the repository root, 'decks/<id>/' otherwise. */
  root: string;
  deck: DeckConfig;
  /** Translations of words and set phrases used in exercises (glossary.yaml next to deck.yaml). */
  glossary?: Record<string, string>;
  /** Frequency list for the placement test (placement.yaml), most frequent first. */
  placement?: PlacementWord[];
  /** What the learner already knew before this deck (known.yaml, written by the placement test). */
  known?: KnownWords;
  /** Media files of the library (full paths); used to find the other voices of a recording. */
  media?: string[];
  topics: Topic[];
  templates: TemplateSource[];
  partials: Record<string, string>;
  baseCss: string;
}

export interface Answer {
  choice?: string;
  text?: string;
  texts?: string[];
  tokens?: string[];
  mistakes?: number;
  total?: number;
}

export interface CheckResult {
  correct: boolean;
  typo: boolean;
  expected: string;
  suggested: Grade;
  marks?: { gaps?: boolean[] };
}

export interface QueueItem {
  key: string;
  card: Card;
  exercise: Exercise;
  skills: Skill[];
  mode: Mode;
  topicCards?: Card[];
}

/** One entry of placement.yaml: a dictionary form, its translation and the irregular forms that are still this word. */
export interface PlacementWord { en: string; ru: string; forms?: string[] }

/** known.yaml: the learner's own vocabulary for this deck; per deck, synced like progress, never exported. */
export interface KnownWords { tested?: string; words: string[]; unknown?: string[] }
