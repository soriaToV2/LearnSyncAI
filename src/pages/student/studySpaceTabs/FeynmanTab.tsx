import { useMemo, useState, useEffect, useRef } from 'react';
import {
  Award, AlertCircle, CheckCircle2, MessageSquare, Lightbulb,
  XCircle, AlertTriangle, PenTool, History, ChevronLeft
} from 'lucide-react';
import Spinner from '../../../components/ui/Spinner';
import MultiSelectDropdown from '../../../components/ui/MultiSelectDropdown';
import SingleSelectDropdown from '../../../components/ui/SingleSelectDropdown';
import { api } from '../../../lib/api';
import {
  CARD, LABEL, SECTION,
  CognitiveTabShell, VerdictBanner, FeedbackCard, Collapsible, AttemptsList,
  AttemptMaterial, materialLabel,
  scoreTone, toneText,
  type AttemptSummary, type ViewMode,
  NoMaterialsNotice,
} from './cognitiveShared';
import { useBadges } from '../../../context/BadgeContext';
import { useOnboarding } from '../../../context/OnboardingContext';
import { masteryApi, masteryPercent } from '../../../lib/mastery';
import type { ConceptMastery, MaterialMasteryDetail } from '../../../lib/mastery';
import { byConceptPriority, byMaterialPriority } from '../../../lib/recommend';
import type { StudyIntent } from '../../../lib/studySpace';

interface FeynmanTabProps {
  availableResources: { id: string; title: string }[];
  spaceId: string;
  /**
   * A recommendation's destination. This is the ONE tool that can use
   * `conceptId` — `FeynmanEvaluationSchema` takes `explanations[].concept_id`,
   * so a concept is already the unit of work here.
   */
  preselect: StudyIntent | null;
  onPreselectConsumed: () => void;
}

/**
 * Selection is keyed on `id`, never on `term`.
 *
 * Extraction guarantees one row per term, but the picker must not depend on that
 * to behave: keying on display text meant two same-named concepts collided as
 * React keys, ticked together, and only the first could ever be resolved back to
 * a record.
 */
interface Concept {
  id: string;
  term: string;
}

/** The paper specifies one audience — a 10-year-old child. */
type Audience = '10yr_old';
const AUDIENCE: Audience = '10yr_old';

type Verdict = 'correct' | 'needs_improvement' | 'incorrect';

interface ConceptResult {
  concept_id: string;
  term: string;
  accuracy_score: number;
  simplicity_score: number;
  verdict: Verdict;
  jargon_found: string[];
  feedback: string;
  /** Optional — logs written before analogy verification shipped have neither. */
  analogy_used?: boolean;
  analogy_quote?: string;
  analogy_idea: string;
}

interface FeynmanFeedback {
  audience: Audience;
  accuracy_score: number;
  simplicity_score: number;
  overall_feedback: string;
  jargon_found: string[];
  concepts: ConceptResult[];
}

interface CognitiveLog {
  id: string;
  mode: string;
  user_input: string;
  similarity_score: number;
  ai_feedback: string;
  /**
   * Which material this was graded against. Optional because attempts logged
   * before the column was populated have none — and because a deleted material
   * leaves the id behind unresolvable, which `materialLabel()` handles.
   */
  material_ids?: string[];
  created_at: string;
}

/** `ai_feedback` is stored as a JSON string — parse defensively. */
function parseFeedback(raw: string): FeynmanFeedback | null {
  try {
    const parsed = JSON.parse(raw) as FeynmanFeedback;
    if (!Array.isArray(parsed?.concepts)) return null;
    return parsed;
  } catch {
    return null;
  }
}

const MIN_EXPLANATION_LENGTH = 10;

const VERDICT_STYLES: Record<Verdict, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  correct: { label: 'Correct', className: 'text-emerald-400 bg-emerald-400/10', Icon: CheckCircle2 },
  needs_improvement: { label: 'Needs Improvement', className: 'text-amber-400 bg-amber-400/10', Icon: AlertTriangle },
  incorrect: { label: 'Incorrect', className: 'text-red-400 bg-red-400/10', Icon: XCircle },
};

/** Plain sentence under the verdict, keyed off the accuracy band. */
function verdictDescription(accuracy: number, conceptCount: number): string {
  const scope = conceptCount === 1 ? 'this concept' : `these ${conceptCount} concepts`;
  if (accuracy >= 80) return `What you said about ${scope} matches the lesson.`;
  if (accuracy >= 30) return `You are on the right track with ${scope}, but something important is missing.`;
  return `Something in your explanation of ${scope} does not match the lesson.`;
}

function overallVerdict(accuracy: number): Verdict {
  if (accuracy >= 80) return 'correct';
  if (accuracy >= 30) return 'needs_improvement';
  return 'incorrect';
}

export default function FeynmanTab({
  availableResources,
  spaceId,
  preselect,
  onPreselectConsumed,
}: FeynmanTabProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('study');
  /** Exactly one material. A submission is graded against one lesson. */
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null);

  // Concept Fetching State
  const [availableConcepts, setAvailableConcepts] = useState<Concept[]>([]);
  const [selectedConceptIds, setSelectedConceptIds] = useState<string[]>([]);
  const [isFetchingConcepts, setIsFetchingConcepts] = useState(false);
  /**
   * How many concepts a recommendation asked for that this lesson no longer
   * carries. Zero means nothing was dropped.
   *
   * ⚠️ A COUNT RATHER THAN A BOOLEAN, because a recommendation now arrives with
   * a LIST — the results screen hands over every concept the student missed — so
   * a partial match is the normal case and "some of these are gone" is the thing
   * worth saying. Reachable in ordinary use: re-uploading a material
   * cascade-deletes its concepts.
   *
   * It is the one dropped deep-link parameter that gets a visible note. A
   * missing MATERIAL leaves the picker in its own empty state, which explains
   * itself; missing concepts leave nothing on screen at all.
   */
  const [preselectMissing, setPreselectMissing] = useState(0);

  /**
   * Mastery for every concept in the space, keyed by concept id, plus the
   * per-lesson rows for the material picker.
   *
   * ⚠️ THIS TAB READ NO MASTERY AT ALL BEFORE THIS, AND PAPER p. 58 SAYS IT
   * SHOULD. That page groups Feynman with the games as a consumer of "existing
   * mastery estimates"; only the games actually were one, because
   * `cognitive.routes.ts` contains neither the word `mastery` nor `bkt`.
   * Ordering the pickers is what makes the claim true. It remains a READ — this
   * tab still never writes `bkt_mastery`, which has exactly two writers and a
   * two-value `bkt_source` enum to keep it that way.
   *
   * One request per mount, ~10.7 KB for 57 concepts, and deliberately not
   * cached: `<main key={activeTab}>` remounts the tab on entry, which is what
   * makes the numbers fresh on return from a test that just moved them.
   *
   * A failure is logged and swallowed. The picker then falls back to document
   * order, which is exactly what it did before this existed — a concept list
   * that refused to render because an analytics call failed would be the worse
   * trade.
   */
  const [conceptMastery, setConceptMastery] = useState<Map<string, ConceptMastery>>(() => new Map());
  const [materialMastery, setMaterialMastery] = useState<Map<string, MaterialMasteryDetail>>(
    () => new Map()
  );

  useEffect(() => {
    let cancelled = false;
    masteryApi
      .detail(spaceId)
      .then((d) => {
        if (cancelled) return;
        setMaterialMastery(new Map(d.by_material.map((m) => [m.material_id, m])));
        setConceptMastery(
          new Map(d.by_material.flatMap((m) => m.concepts.map((c) => [c.concept_id, c] as const)))
        );
      })
      .catch((err) => console.error('[Feynman] mastery load failed', err));
    return () => { cancelled = true; };
  }, [spaceId]);

  /** Weakest lesson first, then never-started, then strongest. See `rankOf()`. */
  const resourceOptions = useMemo(() => {
    const rows = availableResources.map((r) => {
      const m = materialMastery.get(r.id);
      return {
        id: r.id,
        title: r.title,
        m_doc: m?.m_doc ?? 0,
        assessed_concept_count: m?.assessed_concept_count ?? 0,
      };
    });
    rows.sort(byMaterialPriority);
    // Keyed on material id, not title — two materials may share a title.
    return rows.map((r) => ({
      value: r.id,
      label: r.title,
      hint: r.assessed_concept_count > 0 ? `${masteryPercent(r.m_doc)}%` : 'not started',
    }));
  }, [availableResources, materialMastery]);

  /**
   * The concept picker, weakest-worth-explaining first.
   *
   * ⚠️ THIS IS THE FEATURE'S SHARPEST CONSUMER OF `rankOf()`, AND THE ONE MOST
   * DANGEROUS TO "SIMPLIFY" INTO A PLAIN MASTERY SORT. BKT floors every assessed
   * posterior at P(T) = 0.20 while an unassessed concept sits at P(L₀) = 0.10, so
   * ascending raw mastery would open this list entirely on concepts nobody has
   * ever asked the student about. On a 57-concept lesson with six assessed, all
   * of the top rows would be `new`.
   *
   * `POST /materials/concepts/batch` returns document order (`created_at`) and
   * carries no mastery, so the join happens here rather than on the server —
   * that route's shape is unchanged and its single caller is still this tab.
   *
   * The `hint` is the whole reason the ordering is safe to show. A foundational
   * concept sorts to the top, and the ladder says Feynman should NOT lead at
   * that band — so the percentage beside each option is what lets the student
   * tell "I am weak here" from "I have not met this yet". The picker is a
   * picker; the recommender is the recommender. Do not reconcile them by
   * changing this sort.
   */
  const conceptOptions = useMemo(() => {
    const rows = availableConcepts.map((c) => {
      const m = conceptMastery.get(c.id);
      return {
        id: c.id,
        term: c.term,
        mastery: m?.mastery ?? 0,
        assessed: m?.assessed ?? false,
      };
    });
    rows.sort(byConceptPriority);
    return rows.map((c) => ({
      value: c.id,
      label: c.term,
      hint: c.assessed ? `${masteryPercent(c.mastery)}%` : 'new',
    }));
  }, [availableConcepts, conceptMastery]);

  // Composer state — explanations are keyed by concept_id, which is what the API grades against.
  const [explanations, setExplanations] = useState<Record<string, string>>({});
  const [isEvaluating, setIsEvaluating] = useState(false);
  // Guards against a double-click submitting twice; see handleEvaluate.
  const inFlightRef = useRef(false);
  const [evalError, setEvalError] = useState<string | null>(null);
  /**
   * The intent the concept fetch will act on, held out of that effect's deps.
   *
   * The fetch below is keyed on `selectedMaterialId` and must stay that way:
   * reading the live prop inside it would put `preselect` in its dependency list
   * and refetch every concept in the lesson the instant the intent is consumed.
   *
   * ⚠️ IT IS CLEARED THE MOMENT IT IS ACTED ON, and that is what keeps it from
   * becoming a second, stale source of truth. Left set, it would re-select its
   * concept the next time the student picked that same lesson by hand — the
   * re-application bug that `StudySpace` clears `pending` to avoid, reintroduced
   * one level down.
   */
  const preselectRef = useRef<StudyIntent | null>(preselect);

  /* Declared before the two effects that read it, so it is current by the time
     either runs. Never assigns null — clearing is the consumers' job. */
  useEffect(() => {
    if (preselect) preselectRef.current = preselect;
  }, [preselect]);

  // Two separate selections, deliberately. `resultLogId` is the attempt you
  // just submitted and is shown inside Study, so submitting never moves you
  // somewhere else. `historyLogId` is whatever you clicked in the History
  // list. Sharing one variable would make the two views fight over it.
  const [historyLogs, setHistoryLogs] = useState<CognitiveLog[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const { celebrate } = useBadges();
  const [resultLogId, setResultLogId] = useState<string | null>(null);
  const [historyLogId, setHistoryLogId] = useState<string | null>(null);

  /* Deferred for the same reason as Free Recall's — see the note there. Here it
     teaches that the two marks are independent axes rather than one score, which
     is invisible from the numbers alone. */
  const { startTour } = useOnboarding();
  useEffect(() => {
    if (viewMode !== 'study' || !resultLogId) return;
    const t = setTimeout(() => startTour('tool_feynman_result'), 700);
    return () => clearTimeout(t);
  }, [viewMode, resultLogId, startTour]);
  const [showAnswer, setShowAnswer] = useState(false);

  const activeLogId = viewMode === 'study' ? resultLogId : historyLogId;
  const activeLog = historyLogs.find(log => log.id === activeLogId);
  const activeFeedback = activeLog ? parseFeedback(activeLog.ai_feedback) : null;

  const switchView = (mode: ViewMode) => {
    setViewMode(mode);
    if (mode === 'history') setHistoryLogId(null);
    setShowAnswer(false);
  };

  // The API still takes an array — cognitive_logs.material_ids is UUID[] and older
  // attempts span several — but new submissions carry exactly one.
  const selectedMaterialIds = selectedMaterialId ? [selectedMaterialId] : [];

  // Resolve by id. Resolving by term used to silently drop every duplicate row
  // past the first, because `.find()` returns only the earliest match.
  const selectedConcepts = selectedConceptIds
    .map(id => availableConcepts.find(c => c.id === id))
    .filter((c): c is Concept => Boolean(c));

  // ── Load history on mount ─────────────────────────────────
  useEffect(() => {
    async function fetchHistory() {
      setIsLoadingHistory(true);
      try {
        const res = await api.get<CognitiveLog[]>(`/cognitive/history/${spaceId}?mode=feynman`);
        setHistoryLogs(res.data ?? []);
      } catch (err) {
        console.error('[Feynman] Failed to load history:', err);
      } finally {
        setIsLoadingHistory(false);
      }
    }
    fetchHistory();
  }, [spaceId]);

  /*
   * Open on the lesson a recommendation named.
   *
   * Validated against `availableResources`, not trusted: `SingleSelectDropdown`
   * resolves its selection with `options.find(o => o.value === selectedValue)`,
   * so an id the list does not carry would render the PLACEHOLDER while
   * `selectedMaterialId` is set — the student would be explaining a lesson the
   * picker is not showing.
   *
   * Sets `selectedMaterialId` only. The CONCEPT is applied below, inside the
   * fetch it depends on.
   */
  useEffect(() => {
    if (!preselect) return;
    const canOpen =
      preselect.materialId !== null &&
      availableResources.some((r) => r.id === preselect.materialId);
    if (canOpen) setSelectedMaterialId(preselect.materialId);

    /*
     * Hand the intent on to the concept fetch ONLY when there is a concept to
     * look for and a lesson to look in. In every other case consume it here —
     * an intent left un-consumed is one `StudySpace` still holds, so it would be
     * re-applied the next time this tab remounts and would overwrite a lesson
     * the student had since chosen by hand.
     */
    if (!canOpen || preselect.conceptIds.length === 0) {
      preselectRef.current = null;
      onPreselectConsumed();
    }
  }, [preselect, availableResources, onPreselectConsumed]);

  // Reload concepts whenever the material changes. Concept selections and the
  // explanations written against them belong to the old material, so both are
  // cleared — keeping them would submit ids that are not in the chosen lesson.
  useEffect(() => {
    async function fetchConcepts() {
      setSelectedConceptIds([]);
      setExplanations({});
      setPreselectMissing(0);

      if (!selectedMaterialId) {
        setAvailableConcepts([]);
        return;
      }

      setIsFetchingConcepts(true);
      try {
        const res = await api.post<Concept[]>('/materials/concepts/batch', {
          material_ids: [selectedMaterialId],
        });
        const concepts = res.data || [];
        setAvailableConcepts(concepts);

        /*
         * ⚠️ THE PRESELECTED CONCEPT IS APPLIED HERE, INSIDE THIS EFFECT, AND
         * NOT IN ONE OF ITS OWN. This effect clears `selectedConceptIds` on every
         * material change, so a separate effect would race the clearing and lose
         * whenever it ran first.
         *
         * Membership is checked rather than assumed for the same reason the
         * material is: `selectedConcepts` resolves by `.find`, so an id this
         * lesson does not carry renders ZERO textareas under a button reading
         * "1 concept selected", and `handleEvaluate` would post an id the server
         * rejects. Re-uploading a material cascade-deletes its concepts, so this
         * is reachable in ordinary use — and unlike a missing material it leaves
         * nothing on screen to explain itself, which is why it gets a note.
         */
        const wanted = preselectRef.current?.conceptIds ?? [];
        if (wanted.length > 0 && preselectRef.current?.materialId === selectedMaterialId) {
          const live = new Set(concepts.map((c) => c.id));
          const found = wanted.filter((id) => live.has(id));
          if (found.length > 0) setSelectedConceptIds(found);
          setPreselectMissing(wanted.length - found.length);
          preselectRef.current = null;
          onPreselectConsumed();
        }
      } catch (error) {
        console.error('[Feynman] Failed to fetch batch concepts', error);
      } finally {
        setIsFetchingConcepts(false);
      }
    }

    fetchConcepts();
    // `preselectRef` is a mount-time snapshot and `onPreselectConsumed` is
    // stable, so neither belongs in the dependency list — including the live
    // prop would refetch every concept the moment the intent is consumed.
  }, [selectedMaterialId, onPreselectConsumed]);

  const handleConceptChange = (newSelectedIds: string[]) => {
    setSelectedConceptIds(newSelectedIds);
    setEvalError(null);
  };

  const wordCount = selectedConcepts
    .map(c => explanations[c.id] || '')
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length;

  /**
   * ⚠️ SUBMIT WHAT WAS WRITTEN, NOT EVERYTHING THAT WAS TICKED.
   *
   * This used to require EVERY selected concept to be filled before the button
   * would enable, and posted all of them. That was tolerable while the student
   * ticked the concepts themselves; it became a dead end the moment a
   * recommendation could preselect a whole lesson's worth — the test results
   * screen hands over every concept the student missed, so a 34-concept lesson
   * left Evaluate permanently disabled unless they wrote 34 explanations or
   * unticked 30 by hand.
   *
   * Server-legal with no change: `FeynmanEvaluationSchema.explanations` is
   * `.min(1)` with no `.max()`. It also bounds a real failure — grading is one
   * Gemini call at `maxOutputTokens: 16384` with roughly one result object per
   * concept, and `generateJson()` throws outright on `finishReason: MAX_TOKENS`,
   * so sending only what was typed keeps the payload to what the student did.
   *
   * The count is stated on the button and beside it, so a partial submission is
   * never a surprise.
   */
  const readyConcepts = selectedConcepts.filter(
    c => (explanations[c.id] || '').trim().length >= MIN_EXPLANATION_LENGTH
  );
  const skippedCount = selectedConcepts.length - readyConcepts.length;
  const canEvaluate =
    selectedMaterialIds.length > 0 && readyConcepts.length > 0 && !isEvaluating;

  const handleEvaluate = async () => {
    if (!canEvaluate) return;

    // Synchronous latch, and NOT redundant with `canEvaluate` or the button's
    // `disabled`. Both read React state, which does not re-render until this
    // handler yields, so a double-click enters here twice with `isEvaluating`
    // still false and fires two identical submissions.
    //
    // That is not hypothetical: one answer was graded 0.95 and then 0.90 three
    // seconds later from byte-identical input. Both requests ran their memo
    // lookup before either had written its row, so both missed it and both
    // called the model — defeating the one mechanism guaranteeing that the same
    // explanation always earns the same mark.
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    setIsEvaluating(true);
    setEvalError(null);

    try {
      const res = await api.post<{ log_id: string; created_at: string } & FeynmanFeedback>(
        '/cognitive/feynman',
        {
          space_id: spaceId,
          material_ids: selectedMaterialIds,
          audience: AUDIENCE,
          explanations: readyConcepts.map(c => ({
            concept_id: c.id,
            explanation: explanations[c.id].trim(),
          })),
        }
      );

      const { log_id, created_at, ...feedback } = res.data;

      const userInput = readyConcepts
        .map(c => `Concept: ${c.term}\nExplanation: ${explanations[c.id].trim()}`)
        .join('\n\n');

      // Mirror the API shape into a log entry so the result renders from the
      // same code path as a past attempt — one layout, not two.
      const newLog: CognitiveLog = {
        id: log_id,
        mode: 'feynman',
        user_input: userInput,
        similarity_score: feedback.accuracy_score / 100,
        ai_feedback: JSON.stringify(feedback),
        // Not echoed by the POST response and it does not need to be — the
        // client chose the material a moment ago.
        material_ids: selectedMaterialIds,
        created_at,
      };

      setHistoryLogs(prev => [newLog, ...prev]);
      // Stays in Study — the result replaces the composer where the student
      // is already looking, rather than moving them into History.
      setResultLogId(newLog.id);
      setShowAnswer(false);
      setExplanations({});
      setSelectedConceptIds([]);
      // Both the fresh and the memo-hit server paths log activity, so a
      // resubmission can award a streak badge just as a first attempt can.
      celebrate();
    } catch (err) {
      console.error('[Feynman] Evaluation failed:', err);
      const raw = err instanceof Error ? err.message : '';
      // Never show a raw upstream payload to the student.
      const message = raw && !raw.trim().startsWith('{')
        ? raw
        : 'Failed to evaluate your explanation. Please try again.';
      setEvalError(message);
    } finally {
      inFlightRef.current = false;
      setIsEvaluating(false);
    }
  };

  const startNewAttempt = () => {
    setResultLogId(null);
    setEvalError(null);
  };

  const formatDate = (isoString: string) => {
    const d = new Date(isoString);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  const attempts: AttemptSummary[] = historyLogs.map(log => {
    const f = parseFeedback(log.ai_feedback);
    const accuracy = f?.accuracy_score ?? Math.round((log.similarity_score ?? 0) * 100);
    return {
      id: log.id,
      dateLabel: formatDate(log.created_at),
      scoreLabel: `${accuracy}/100`,
      scoreTone: scoreTone(accuracy),
      preview: log.user_input,
      // Material first, then how many concepts were explained. The material is
      // the part that makes the score interpretable; the count is detail.
      meta: [
        materialLabel(log.material_ids, availableResources),
        f ? `${f.concepts.length} concept${f.concepts.length === 1 ? '' : 's'}` : null,
      ].filter(Boolean).join(' · ') || undefined,
    };
  });

  // The result view, shared by both places it can appear: inside Study right
  // after submitting, and inside History when an attempt is selected.
  const resultView = (log: CognitiveLog, feedback: FeynmanFeedback, showWriteAnother: boolean) => {
    const activeFeedback = feedback;
    const activeLog = log;
    return (
            /* `key` on the attempt id — see the twin note in `FreeRecallTab`.
               Without it, switching between past explanations reuses the same
               DOM node and the entrance never re-fires. */
            <div key={activeLog.id} className="space-y-5 animate-tab-in">
              {/* Named before the score: the concepts graded below belong to
                  one lesson, and History can hold attempts across several. */}
              <AttemptMaterial label={materialLabel(activeLog.material_ids, availableResources)} />
              <div data-tour="fey-scores">
              <VerdictBanner
                score={activeFeedback.accuracy_score}
                tone={scoreTone(activeFeedback.accuracy_score)}
                verdictLabel={VERDICT_STYLES[overallVerdict(activeFeedback.accuracy_score)].label}
                description={verdictDescription(activeFeedback.accuracy_score, activeFeedback.concepts.length)}
                secondary={{ label: 'Simplicity', value: activeFeedback.simplicity_score }}
              />
              </div>

              {activeFeedback.overall_feedback && (
                <div className="space-y-3">
                  <h4 className={SECTION}>Feedback</h4>
                  <FeedbackCard
                    icon={<MessageSquare className="w-3.5 h-3.5" />}
                    label="Overall"
                    tone="text-primary-fixed-dim"
                  >
                    {activeFeedback.overall_feedback}
                  </FeedbackCard>
                </div>
              )}

              <div>
                <h4 className={`${SECTION} mb-3`}>Concept breakdown</h4>
                <div className="space-y-3">
                  {activeFeedback.concepts.map((c) => {
                    const verdict = VERDICT_STYLES[c.verdict];
                    const VerdictIcon = verdict.Icon;
                    return (
                      <div key={c.concept_id} className={`${CARD} p-5 space-y-4`}>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <span className="font-sans text-sm font-semibold text-white">{c.term}</span>
                          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full font-sans text-xs font-semibold ${verdict.className}`}>
                            <VerdictIcon className="w-3.5 h-3.5" />
                            {verdict.label}
                          </div>
                        </div>

                        <div className="flex gap-8">
                          <div>
                            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Accuracy</span>
                            <p className={`font-display text-lg font-bold ${toneText[scoreTone(c.accuracy_score)]}`}>{c.accuracy_score}</p>
                          </div>
                          <div>
                            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Simplicity</span>
                            <p className={`font-display text-lg font-bold ${toneText[scoreTone(c.simplicity_score)]}`}>{c.simplicity_score}</p>
                          </div>
                        </div>

                        {c.feedback && (
                          <p className="font-sans text-sm text-slate-400 leading-relaxed">{c.feedback}</p>
                        )}

                        {/* Analogy Verification — pipeline step 2. Older logs
                            predate this and carry no `analogy_used`; those fall
                            back to showing the suggestion on its own. */}
                        {c.analogy_used === undefined ? (
                          c.analogy_idea && (
                            <div className="bg-emerald-400/[0.06] p-4 rounded-xl">
                              <h5 className="font-sans text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-1.5 flex items-center gap-2">
                                <Lightbulb className="w-3.5 h-3.5" /> Analogy Idea
                              </h5>
                              <p className="font-sans text-sm text-slate-200 leading-relaxed">{c.analogy_idea}</p>
                            </div>
                          )
                        ) : (
                          <div className={`p-4 rounded-xl ${c.analogy_used ? 'bg-emerald-400/[0.06]' : 'bg-white/[0.03]'}`}>
                            <h5 className={`font-sans text-xs font-semibold uppercase tracking-wider mb-1.5 flex items-center gap-2 ${
                              c.analogy_used ? 'text-emerald-400' : 'text-slate-400'
                            }`}>
                              {c.analogy_used
                                ? <><CheckCircle2 className="w-3.5 h-3.5" /> Everyday comparison used</>
                                : <><Lightbulb className="w-3.5 h-3.5" /> No everyday comparison</>}
                            </h5>
                            {c.analogy_used && c.analogy_quote && (
                              <p className="font-sans text-sm text-slate-300 italic leading-relaxed border-l-2 border-emerald-400/30 pl-3 mb-2">
                                “{c.analogy_quote}”
                              </p>
                            )}
                            {c.analogy_idea && (
                              <p className="font-sans text-sm text-slate-200 leading-relaxed">{c.analogy_idea}</p>
                            )}
                          </div>
                        )}

                        {c.jargon_found.length > 0 && (
                          <div>
                            <span className="text-[10px] font-semibold text-amber-400/80 uppercase tracking-wider">
                              Words to explain more simply
                            </span>
                            <div className="flex flex-wrap gap-2 mt-2">
                              {c.jargon_found.map((word, i) => (
                                <span key={i} className="px-2.5 py-1 rounded-md bg-amber-500/10 text-amber-300 font-sans text-xs">
                                  {word}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <Collapsible
                title="Your explanation"
                open={showAnswer}
                onToggle={() => setShowAnswer(v => !v)}
              >
                <div className={`${CARD} p-5`}>
                  <p className="font-sans text-sm leading-loose text-slate-400 whitespace-pre-wrap">
                    {activeLog.user_input}
                  </p>
                </div>
              </Collapsible>

              {showWriteAnother && (
                <div className="pt-2">
                  <button
                    onClick={startNewAttempt}
                    className="w-full sm:w-auto px-6 py-2.5 bg-primary-fixed-dim text-black hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-surface focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded-xl font-sans text-sm font-semibold transition-all flex items-center justify-center gap-2"
                  >
                    <PenTool className="w-4 h-4" /> Explain another
                  </button>
                </div>
              )}
            </div>
    );
  };

  /** A stored attempt whose feedback JSON could not be parsed. */
  const unreadableView = (
            <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 py-20">
              <AlertCircle className="w-10 h-10 mb-4 opacity-20" />
              <p className="font-sans text-sm">This attempt's feedback could not be read.</p>
            </div>
  );

  // Guarded on there being any lesson at all: without this the material
  // dropdown simply renders empty and the tab explains nothing. See
  // `NoMaterialsNotice`.
  const composer = availableResources.length === 0 ? <NoMaterialsNotice /> : (
            <div className="fade-in">
              <div className="flex flex-wrap items-end gap-x-6 gap-y-4 mb-6">
                <div data-tour="fey-material" className="flex flex-col gap-1.5">
                  <span className={LABEL}>Material</span>
                  <SingleSelectDropdown
                    selectedValue={selectedMaterialId}
                    onChange={setSelectedMaterialId}
                    options={resourceOptions}
                    placeholder="Select a material..."
                  />
                </div>

                <div data-tour="fey-concepts" className="flex flex-col gap-1.5">
                  <span className={`${LABEL} flex items-center gap-1.5`}>
                    Concepts {isFetchingConcepts && <Spinner className="w-3 h-3" />}
                  </span>
                  <MultiSelectDropdown
                    selectedValues={selectedConceptIds}
                    onChange={handleConceptChange}
                    options={conceptOptions}
                    placeholder="Select concepts..."
                    itemNoun="concept"
                  />
                </div>
              </div>

              {/* The one line that makes the ordering readable. Without it the
                  percentages look like scores rather than a running order, and
                  "new" looks like a zero. */}
              {availableConcepts.length > 0 && (
                <p className="font-sans text-xs text-slate-500 -mt-3 mb-5">
                  The ideas you are weakest on are listed first. “new” means you have not been asked
                  about it yet.
                </p>
              )}

              {preselectMissing > 0 && (
                <p className="font-sans text-xs text-amber-400/80 -mt-3 mb-5">
                  {preselectMissing === 1
                    ? 'One idea is no longer in this lesson.'
                    : `${preselectMissing} ideas are no longer in this lesson.`}{' '}
                  Your teacher may have updated it — pick another above.
                </p>
              )}

              {selectedConcepts.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center text-slate-500 py-20">
                  <PenTool className="w-10 h-10 mb-4 opacity-20" />
                  <p className="font-sans text-sm max-w-md">
                    {selectedMaterialIds.length === 0
                      ? 'Select a learning material to load its concepts.'
                      : availableConcepts.length === 0 && !isFetchingConcepts
                        ? 'No concepts found. Make sure the material has finished processing.'
                        : 'Select one or more concepts above to start explaining them.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {selectedConcepts.map((concept, index) => (
                    <div key={concept.id} className={`${CARD} p-5`}>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary-fixed-dim shrink-0" />
                        <span className="font-sans text-sm font-semibold text-white">{concept.term}</span>
                      </div>
                      <textarea
                        value={explanations[concept.id] || ''}
                        onChange={(e) => setExplanations({ ...explanations, [concept.id]: e.target.value })}
                        placeholder="Explain as if teaching a 10-year-old. Use everyday analogies and avoid jargon..."
                        className="w-full bg-transparent border-none outline-none font-sans text-base text-slate-200 placeholder:text-slate-600 resize-none no-scrollbar min-h-[120px]"
                        autoFocus={index === 0}
                      />
                    </div>
                  ))}
                </div>
              )}

              {evalError && (
                <div className="flex items-start gap-2 text-red-400 bg-red-400/10 px-4 py-3 rounded-xl mt-4">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="font-sans text-sm">{evalError}</span>
                </div>
              )}

              <div className="py-4 mt-2 border-t border-white/5 flex flex-wrap items-center justify-between gap-4">
                {/* A statement of fact, not a blocker. It used to read "N still
                    need an explanation", which was a to-do list you could not
                    dismiss; what matters now is what is about to be sent. */}
                <span className="font-sans text-xs text-slate-500 font-medium">
                  {wordCount} words
                  {skippedCount > 0 && (
                    <span className="text-slate-400 ml-3">
                      Explaining {readyConcepts.length} of {selectedConcepts.length} — the rest are
                      skipped
                    </span>
                  )}
                </span>
                <button
                  data-tour="fey-submit"
                  onClick={handleEvaluate}
                  disabled={!canEvaluate}
                  className="px-6 py-2.5 bg-primary-fixed-dim text-black hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-surface focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded-xl font-sans text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isEvaluating ? (
                    <><Spinner className="w-4 h-4" /> Evaluating...</>
                  ) : readyConcepts.length > 1 ? (
                    `Evaluate ${readyConcepts.length} explanations`
                  ) : (
                    'Evaluate Explanation'
                  )}
                </button>
              </div>
            </div>
  );

  return (
    <CognitiveTabShell
      icon={<Award className="w-5 h-5 text-primary-fixed-dim" />}
      title="Feynman Technique"
      subtitle="Explain a concept simply, as if teaching a 10-year-old."
      viewMode={viewMode}
      onViewModeChange={switchView}
    >
      {viewMode === 'study' ? (
        // `px-2` is load-bearing, not spacing. `overflow-y-auto` makes CSS
        // compute `overflow-x` to `auto` as well, so this box clips horizontally
        // at its content edge. The material and concept dropdowns sit flush at
        // x=0, and their borders and shadows were being sliced off.
        <div className="max-w-3xl mx-auto h-full overflow-y-auto no-scrollbar pb-10 px-2">
          {activeLog && activeFeedback
            ? resultView(activeLog, activeFeedback, true)
            : activeLog
              ? unreadableView
              : composer}
        </div>
      ) : (
        /* One pane at a time below `lg`, for the nested-scroll reason spelled out
           in the twin comment in FreeRecallTab. `historyLogId` already carries the
           choice, so no extra state is involved. */
        <div className="h-full flex flex-col lg:flex-row gap-5 lg:gap-6 fade-in">
          <AttemptsList
            title="Past Explanations"
            attempts={attempts}
            activeId={historyLogId}
            isLoading={isLoadingHistory}
            emptyLabel="No past explanations yet."
            onSelect={(id) => {
              setHistoryLogId(id);
              setShowAnswer(false);
            }}
            className={historyLogId ? 'hidden lg:flex' : 'flex'}
          />

          {/* Same horizontal-clip rule as the study pane above. */}
          <div
            className={`flex-1 min-h-0 overflow-y-auto no-scrollbar pb-10 px-2 ${
              historyLogId ? 'block' : 'hidden lg:block'
            }`}
          >
            {/* Outside the branches below, so it is present on the unreadable
                case too — that is precisely when a student needs to get back. */}
            {historyLogId && (
              <button
                onClick={() => setHistoryLogId(null)}
                className="lg:hidden mb-4 inline-flex items-center gap-1.5 font-sans text-xs font-semibold uppercase tracking-widest text-slate-400 hover:text-white transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)]"
              >
                <ChevronLeft className="w-4 h-4" /> All explanations
              </button>
            )}
            {activeLog && activeFeedback ? (
              <div className="max-w-3xl">{resultView(activeLog, activeFeedback, false)}</div>
            ) : activeLog ? (
              unreadableView
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 py-20">
                <History className="w-10 h-10 mb-4 opacity-20" />
                <p className="font-sans text-sm">Select a past explanation to view your scores and feedback.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </CognitiveTabShell>
  );
}
