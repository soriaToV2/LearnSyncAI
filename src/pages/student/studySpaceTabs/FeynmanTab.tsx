import { useState, useEffect, useRef } from 'react';
import {
  Award, RefreshCw, AlertCircle, CheckCircle2, MessageSquare, Lightbulb,
  XCircle, AlertTriangle, PenTool, History,
} from 'lucide-react';
import MultiSelectDropdown from '../../../components/ui/MultiSelectDropdown';
import SingleSelectDropdown from '../../../components/ui/SingleSelectDropdown';
import { api } from '../../../lib/api';
import {
  CARD, LABEL, SECTION,
  CognitiveTabShell, VerdictBanner, FeedbackCard, Collapsible, AttemptsList,
  AttemptMaterial, materialLabel,
  scoreTone, toneText,
  type AttemptSummary, type ViewMode,
} from './cognitiveShared';
import { useBadges } from '../../../context/BadgeContext';

interface FeynmanTabProps {
  availableResources: { id: string; title: string }[];
  spaceId: string;
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

export default function FeynmanTab({ availableResources, spaceId }: FeynmanTabProps) {
  // Keyed on material id, not title — two materials may share a title.
  const resourceOptions = availableResources.map(r => ({ value: r.id, label: r.title }));

  const [viewMode, setViewMode] = useState<ViewMode>('study');
  /** Exactly one material. A submission is graded against one lesson. */
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null);

  // Concept Fetching State
  const [availableConcepts, setAvailableConcepts] = useState<Concept[]>([]);
  const [selectedConceptIds, setSelectedConceptIds] = useState<string[]>([]);
  const [isFetchingConcepts, setIsFetchingConcepts] = useState(false);

  // Composer state — explanations are keyed by concept_id, which is what the API grades against.
  const [explanations, setExplanations] = useState<Record<string, string>>({});
  const [isEvaluating, setIsEvaluating] = useState(false);
  // Guards against a double-click submitting twice; see handleEvaluate.
  const inFlightRef = useRef(false);
  const [evalError, setEvalError] = useState<string | null>(null);

  // Two separate selections, deliberately. `resultLogId` is the attempt you
  // just submitted and is shown inside Study, so submitting never moves you
  // somewhere else. `historyLogId` is whatever you clicked in the History
  // list. Sharing one variable would make the two views fight over it.
  const [historyLogs, setHistoryLogs] = useState<CognitiveLog[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const { celebrate } = useBadges();
  const [resultLogId, setResultLogId] = useState<string | null>(null);
  const [historyLogId, setHistoryLogId] = useState<string | null>(null);
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

  // Reload concepts whenever the material changes. Concept selections and the
  // explanations written against them belong to the old material, so both are
  // cleared — keeping them would submit ids that are not in the chosen lesson.
  useEffect(() => {
    async function fetchConcepts() {
      setSelectedConceptIds([]);
      setExplanations({});

      if (!selectedMaterialId) {
        setAvailableConcepts([]);
        return;
      }

      setIsFetchingConcepts(true);
      try {
        const res = await api.post<Concept[]>('/materials/concepts/batch', {
          material_ids: [selectedMaterialId],
        });
        setAvailableConcepts(res.data || []);
      } catch (error) {
        console.error('[Feynman] Failed to fetch batch concepts', error);
      } finally {
        setIsFetchingConcepts(false);
      }
    }

    fetchConcepts();
  }, [selectedMaterialId]);

  const handleConceptChange = (newSelectedIds: string[]) => {
    setSelectedConceptIds(newSelectedIds);
    setEvalError(null);
  };

  const wordCount = selectedConcepts
    .map(c => explanations[c.id] || '')
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length;

  // Every selected concept needs a real explanation before we can submit.
  const incompleteConcepts = selectedConcepts.filter(
    c => (explanations[c.id] || '').trim().length < MIN_EXPLANATION_LENGTH
  );
  const canEvaluate =
    selectedMaterialIds.length > 0 &&
    selectedConcepts.length > 0 &&
    incompleteConcepts.length === 0 &&
    !isEvaluating;

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
          explanations: selectedConcepts.map(c => ({
            concept_id: c.id,
            explanation: explanations[c.id].trim(),
          })),
        }
      );

      const { log_id, created_at, ...feedback } = res.data;

      const userInput = selectedConcepts
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
            <div className="space-y-5 animate-in fade-in duration-300">
              {/* Named before the score: the concepts graded below belong to
                  one lesson, and History can hold attempts across several. */}
              <AttemptMaterial label={materialLabel(activeLog.material_ids, availableResources)} />
              <VerdictBanner
                score={activeFeedback.accuracy_score}
                tone={scoreTone(activeFeedback.accuracy_score)}
                verdictLabel={VERDICT_STYLES[overallVerdict(activeFeedback.accuracy_score)].label}
                description={verdictDescription(activeFeedback.accuracy_score, activeFeedback.concepts.length)}
                secondary={{ label: 'Simplicity', value: activeFeedback.simplicity_score }}
              />

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
                    className="w-full sm:w-auto px-6 py-2.5 bg-white text-black hover:bg-slate-200 rounded-xl font-sans text-sm font-semibold transition-all flex items-center justify-center gap-2"
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

  const composer = (
            <div className="animate-in fade-in">
              <div className="flex flex-wrap items-end gap-x-6 gap-y-4 mb-6">
                <div className="flex flex-col gap-1.5">
                  <span className={LABEL}>Material</span>
                  <SingleSelectDropdown
                    selectedValue={selectedMaterialId}
                    onChange={setSelectedMaterialId}
                    options={resourceOptions}
                    placeholder="Select a material..."
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className={`${LABEL} flex items-center gap-1.5`}>
                    Concepts {isFetchingConcepts && <RefreshCw className="w-3 h-3 animate-spin" />}
                  </span>
                  <MultiSelectDropdown
                    selectedValues={selectedConceptIds}
                    onChange={handleConceptChange}
                    options={availableConcepts.map(c => ({ value: c.id, label: c.term }))}
                    placeholder="Select concepts..."
                    itemNoun="concept"
                  />
                </div>
              </div>

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
                <span className="font-sans text-xs text-slate-500 font-medium">
                  {wordCount} words
                  {selectedConcepts.length > 0 && incompleteConcepts.length > 0 && (
                    <span className="text-amber-400/80 ml-3">
                      {incompleteConcepts.length} concept{incompleteConcepts.length > 1 ? 's' : ''} still need{incompleteConcepts.length === 1 ? 's' : ''} an explanation
                    </span>
                  )}
                </span>
                <button
                  onClick={handleEvaluate}
                  disabled={!canEvaluate}
                  className="px-6 py-2.5 bg-white text-black hover:bg-slate-200 rounded-xl font-sans text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isEvaluating ? (
                    <><RefreshCw className="w-4 h-4 animate-spin" /> Evaluating...</>
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
        <div className="h-full flex flex-col sm:flex-row gap-6 animate-in fade-in">
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
          />

          {/* Same horizontal-clip rule as the study pane above. */}
          <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar pb-10 px-2">
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
