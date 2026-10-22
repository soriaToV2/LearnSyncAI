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
  /** A recommendation's destination. The only tool that uses concept ids. */
  preselect: StudyIntent | null;
  onPreselectConsumed: () => void;
}

/** Selection is keyed on `id`, never `term`, so same-named concepts stay distinct. */
interface Concept {
  id: string;
  term: string;
}

/** The paper specifies one audience: a 10-year-old. */
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
  /** Optional: older logs predate analogy verification. */
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
  /** The material graded against. Optional (older rows); a deleted material is handled by materialLabel(). */
  material_ids?: string[];
  created_at: string;
}

/** `ai_feedback` is a JSON string; parse defensively. */
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

/** The sentence under the verdict, by accuracy band. */
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
  /** Exactly one material. */
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null);

  // Concept fetching
  const [availableConcepts, setAvailableConcepts] = useState<Concept[]>([]);
  const [selectedConceptIds, setSelectedConceptIds] = useState<string[]>([]);
  const [isFetchingConcepts, setIsFetchingConcepts] = useState(false);
  /** How many recommended concepts this lesson no longer has (re-uploads delete concepts); shown as a note. */
  const [preselectMissing, setPreselectMissing] = useState(0);

  /**
   * Mastery for every concept in the space, used only to order the pickers (read-only; this tab never
   * writes mastery). Fetched per mount, not cached. On failure the pickers fall back to document order.
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

  /** Weakest lesson first, then not started, then strongest (see rankOf()). */
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
    // Keyed on material id: titles can repeat.
    return rows.map((r) => ({
      value: r.id,
      label: r.title,
      hint: r.assessed_concept_count > 0 ? `${masteryPercent(r.m_doc)}%` : 'not started',
    }));
  }, [availableResources, materialMastery]);

  /**
   * Concept picker, weakest-worth-explaining first via rankOf(). Never a plain mastery sort: unassessed
   * concepts (0.10) would outrank every struggling one. The % hint lets students tell "weak" from "new".
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

  // Composer state; explanations are keyed by concept_id.
  const [explanations, setExplanations] = useState<Record<string, string>>({});
  const [isEvaluating, setIsEvaluating] = useState(false);
  // Double-submit guard (see handleEvaluate).
  const inFlightRef = useRef(false);
  const [evalError, setEvalError] = useState<string | null>(null);
  /** The intent for the concept fetch, kept out of its deps and cleared once acted on (or it would re-apply later). */
  const preselectRef = useRef<StudyIntent | null>(preselect);

  /* Declared before the effects that read it. Never assigns null; consumers clear it. */
  useEffect(() => {
    if (preselect) preselectRef.current = preselect;
  }, [preselect]);

  // Two selections: `resultLogId` (just submitted, shown in Study) and `historyLogId` (clicked in History).
  const [historyLogs, setHistoryLogs] = useState<CognitiveLog[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const { celebrate } = useBadges();
  const [resultLogId, setResultLogId] = useState<string | null>(null);
  const [historyLogId, setHistoryLogId] = useState<string | null>(null);

  /* Deferred until a result exists: teaches that the two marks are independent axes. */
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

  // The API takes an array (older rows hold several); new submissions send one.
  const selectedMaterialIds = selectedMaterialId ? [selectedMaterialId] : [];

  // Resolve by id; resolving by term dropped duplicates.
  const selectedConcepts = selectedConceptIds
    .map(id => availableConcepts.find(c => c.id === id))
    .filter((c): c is Concept => Boolean(c));

  // Load history on mount
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

  // Open on the recommended lesson, validated against availableResources (an unknown id would show the
  // placeholder while state says otherwise). The concept is applied inside the fetch below.
  useEffect(() => {
    if (!preselect) return;
    const canOpen =
      preselect.materialId !== null &&
      availableResources.some((r) => r.id === preselect.materialId);
    if (canOpen) setSelectedMaterialId(preselect.materialId);

    // Hand the intent to the concept fetch only if there's a concept and a lesson; otherwise consume it now.
    if (!canOpen || preselect.conceptIds.length === 0) {
      preselectRef.current = null;
      onPreselectConsumed();
    }
  }, [preselect, availableResources, onPreselectConsumed]);

  // Reload concepts on material change and clear selections and explanations (they belong to the old lesson).
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

        // Apply the preselected concept here, inside this effect: a separate effect would race the clearing
        // above. Check membership first; missing concepts get a visible note.
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
   * Submit what was written, not everything ticked: a recommendation can preselect a whole lesson.
   * The server allows any count; the count is shown on and beside the button.
   */
  const readyConcepts = selectedConcepts.filter(
    c => (explanations[c.id] || '').trim().length >= MIN_EXPLANATION_LENGTH
  );
  const skippedCount = selectedConcepts.length - readyConcepts.length;
  const canEvaluate =
    selectedMaterialIds.length > 0 && readyConcepts.length > 0 && !isEvaluating;

  const handleEvaluate = async () => {
    if (!canEvaluate) return;

    // Synchronous latch, not redundant with `disabled` (state lags), or a double-click submits twice and
    // both requests miss the memo.
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

      // Shape the response like a log entry so it renders through the same path as past attempts.
      const newLog: CognitiveLog = {
        id: log_id,
        mode: 'feynman',
        user_input: userInput,
        similarity_score: feedback.accuracy_score / 100,
        ai_feedback: JSON.stringify(feedback),
        // The client already knows the material.
        material_ids: selectedMaterialIds,
        created_at,
      };

      setHistoryLogs(prev => [newLog, ...prev]);
      // Stay in Study; the result replaces the composer.
      setResultLogId(newLog.id);
      setShowAnswer(false);
      setExplanations({});
      setSelectedConceptIds([]);
      // Both server paths log activity, so a resubmission can award a streak badge.
      celebrate();
    } catch (err) {
      console.error('[Feynman] Evaluation failed:', err);
      const raw = err instanceof Error ? err.message : '';
      // Never show a raw upstream payload.
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
      // Material first (it makes the score interpretable), then the count.
      meta: [
        materialLabel(log.material_ids, availableResources),
        f ? `${f.concepts.length} concept${f.concepts.length === 1 ? '' : 's'}` : null,
      ].filter(Boolean).join(' · ') || undefined,
    };
  });

  // The result view, shared by Study (after submitting) and History.
  const resultView = (log: CognitiveLog, feedback: FeynmanFeedback, showWriteAnother: boolean) => {
    const activeFeedback = feedback;
    const activeLog = log;
    return (
            /* Keyed on the attempt id so the entrance replays when switching attempts. */
            <div key={activeLog.id} className="space-y-5 animate-tab-in">
              {/* Lesson name before the score: History can hold attempts across lessons. */}
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

                        {/* Analogy verification. Older logs lack analogy_used and show only the suggestion. */}
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

  /** A stored attempt whose feedback JSON couldn't be parsed. */
  const unreadableView = (
            <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 py-20">
              <AlertCircle className="w-10 h-10 mb-4 opacity-20" />
              <p className="font-sans text-sm">This attempt's feedback could not be read.</p>
            </div>
  );

  // No lessons at all: show NoMaterialsNotice rather than an empty dropdown.
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

              {/* Explains the ordering, so percentages don't read as scores and "new" doesn't read as zero. */}
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
                {/* States what will be sent, not a to-do list. */}
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
        // px-2 is required: overflow-y-auto also clips x, which sliced off the dropdowns' borders and shadows.
        <div className="max-w-3xl mx-auto h-full overflow-y-auto no-scrollbar pb-10 px-2">
          {activeLog && activeFeedback
            ? resultView(activeLog, activeFeedback, true)
            : activeLog
              ? unreadableView
              : composer}
        </div>
      ) : (
        /* One pane at a time below lg (see FreeRecallTab). */
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

          {/* Same horizontal-clip rule as the study pane. */}
          <div
            className={`flex-1 min-h-0 overflow-y-auto no-scrollbar pb-10 px-2 ${
              historyLogId ? 'block' : 'hidden lg:block'
            }`}
          >
            {/* Outside the branches, so it's there for the unreadable case too. */}
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
