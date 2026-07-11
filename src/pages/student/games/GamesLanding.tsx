import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Gamepad2,
  BrainCircuit,
  ArrowRight,
  Hourglass,
  HelpCircle,
  AlertCircle,
  FileText,
  Check,
  Loader2,
} from 'lucide-react';
import clsx from 'clsx';
import Modal from '../../../components/ui/Modal';
import { api } from '../../../lib/api';
import { getCourseDisplayInfo } from './gamesData';

type GameTypeUi = 'matching' | 'crossword' | 'trivia';

// Maps the UI game label to the backend game_type enum.
const GAME_TYPE_API: Record<GameTypeUi, 'term_matcher' | 'crossword' | 'timed_trivia'> = {
  matching: 'term_matcher',
  crossword: 'crossword',
  trivia: 'timed_trivia',
};

const GAME_TITLE: Record<GameTypeUi, string> = {
  matching: 'Term Matching',
  crossword: 'Crossword',
  trivia: 'Timed Trivia',
};

interface StudySpace {
  id: string;
  title: string;
  description?: string | null;
}

interface Material {
  id: string;
  title: string;
  parsed_status: string;
}

export default function GamesLanding() {
  const navigate = useNavigate();

  const [isBuildModalOpen, setIsBuildModalOpen] = useState(false);
  const [selectedGameType, setSelectedGameType] = useState<GameTypeUi | null>(null);

  const [spaces, setSpaces] = useState<StudySpace[]>([]);
  const [spacesLoading, setSpacesLoading] = useState(false);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string>('');

  const [materials, setMaterials] = useState<Material[]>([]);
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<string[]>([]);

  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  // Load the student's study spaces once the modal is first opened.
  useEffect(() => {
    if (!isBuildModalOpen || spaces.length > 0) return;

    let cancelled = false;
    setSpacesLoading(true);
    api
      .get<StudySpace[]>('/spaces')
      .then((res) => {
        if (cancelled) return;
        setSpaces(res.data ?? []);
        if (res.data?.[0]) setSelectedSpaceId(res.data[0].id);
      })
      .catch((err: unknown) => {
        if (!cancelled) setGenError(err instanceof Error ? err.message : 'Failed to load study spaces');
      })
      .finally(() => {
        if (!cancelled) setSpacesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isBuildModalOpen, spaces.length]);

  // Load materials whenever the selected space changes. Only parsed materials
  // have extracted concepts, so those are the only ones eligible for generation.
  useEffect(() => {
    if (!isBuildModalOpen || !selectedSpaceId) return;

    let cancelled = false;
    setMaterialsLoading(true);
    setGenError(null);
    api
      .get<Material[]>(`/materials/space/${selectedSpaceId}`)
      .then((res) => {
        if (cancelled) return;
        const completed = (res.data ?? []).filter((m) => m.parsed_status === 'completed');
        setMaterials(completed);
        setSelectedMaterialIds(completed.map((m) => m.id));
      })
      .catch((err: unknown) => {
        if (!cancelled) setGenError(err instanceof Error ? err.message : 'Failed to load materials');
      })
      .finally(() => {
        if (!cancelled) setMaterialsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isBuildModalOpen, selectedSpaceId]);

  const openBuildModal = (gameType: GameTypeUi) => {
    setSelectedGameType(gameType);
    setGenError(null);
    setIsBuildModalOpen(true);
  };

  const handleBuildAndLaunchGame = useCallback(async () => {
    if (!selectedGameType || !selectedSpaceId || selectedMaterialIds.length === 0) return;

    setGenerating(true);
    setGenError(null);
    try {
      const res = await api.post<{ id: string }>('/games/generate', {
        space_id: selectedSpaceId,
        material_ids: selectedMaterialIds,
        game_type: GAME_TYPE_API[selectedGameType],
      });
      setIsBuildModalOpen(false);
      navigate(`/student/games/${selectedGameType}?contentId=${res.data.id}`);
    } catch (err: unknown) {
      setGenError(err instanceof Error ? err.message : 'Failed to generate game content');
    } finally {
      setGenerating(false);
    }
  }, [selectedGameType, selectedSpaceId, selectedMaterialIds, navigate]);

  const toggleMaterial = (id: string) => {
    setSelectedMaterialIds((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  };

  const allSelected = materials.length > 0 && selectedMaterialIds.length === materials.length;

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Game 1: Term Matching */}
        <div className="glass-card rounded-2xl border border-white/5 hover:border-primary-fixed-dim/30 transition-all duration-300 p-6 flex flex-col justify-between group hover:shadow-lg hover:shadow-primary-fixed-dim/5 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-primary-fixed-dim/5 rounded-full blur-2xl group-hover:bg-primary-fixed-dim/10 transition-all duration-300 -mr-10 -mt-10 pointer-events-none" />
          <div className="relative z-10">
            <div className="w-12 h-12 rounded-xl bg-primary-fixed-dim/10 flex items-center justify-center border border-primary-fixed-dim/20 text-primary-fixed-dim mb-4 group-hover:scale-110 transition-transform">
              <BrainCircuit className="w-6 h-6" />
            </div>
            <h3 className="font-display text-xl font-bold text-white mb-2">Term Matching</h3>
            <p className="font-sans text-sm text-slate-400 leading-relaxed mb-6">
              Connect core course terms to their exact scientific definitions. Match them all with zero errors to win!
            </p>
          </div>
          <button
            onClick={() => openBuildModal('matching')}
            className="w-full py-3 rounded-xl bg-primary-fixed-dim/10 border border-primary-fixed-dim/30 text-primary-fixed-dim font-display font-semibold hover:bg-primary-fixed-dim hover:text-on-primary-fixed transition-all duration-300 flex items-center justify-center gap-2 active:scale-95"
          >
            Play Game <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        {/* Game 2: Crossword */}
        <div className="glass-card rounded-2xl border border-white/5 hover:border-amber-400/30 transition-all duration-300 p-6 flex flex-col justify-between group hover:shadow-lg hover:shadow-amber-400/5 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-amber-400/5 rounded-full blur-2xl group-hover:bg-amber-400/10 transition-all duration-300 -mr-10 -mt-10 pointer-events-none" />
          <div className="relative z-10">
            <div className="w-12 h-12 rounded-xl bg-amber-400/10 flex items-center justify-center border border-amber-400/20 text-amber-400 mb-4 group-hover:scale-110 transition-transform">
              <HelpCircle className="w-6 h-6" />
            </div>
            <h3 className="font-display text-xl font-bold text-white mb-2">Crossword</h3>
            <p className="font-sans text-sm text-slate-400 leading-relaxed mb-6">
              Solve course cross-clues inside an interactive grid. Read horizontal and vertical hints to identify core structures.
            </p>
          </div>
          <button
            onClick={() => openBuildModal('crossword')}
            className="w-full py-3 rounded-xl bg-amber-400/10 border border-amber-400/30 text-amber-400 font-display font-semibold hover:bg-amber-400 hover:text-black transition-all duration-300 flex items-center justify-center gap-2 active:scale-95"
          >
            Play Game <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        {/* Game 3: Timed Trivia */}
        <div className="glass-card rounded-2xl border border-white/5 hover:border-cyan-400/30 transition-all duration-300 p-6 flex flex-col justify-between group hover:shadow-lg hover:shadow-cyan-400/5 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-400/5 rounded-full blur-2xl group-hover:bg-cyan-400/10 transition-all duration-300 -mr-10 -mt-10 pointer-events-none" />
          <div className="relative z-10">
            <div className="w-12 h-12 rounded-xl bg-cyan-400/10 flex items-center justify-center border border-cyan-400/20 text-cyan-400 mb-4 group-hover:scale-110 transition-transform">
              <Hourglass className="w-6 h-6" />
            </div>
            <h3 className="font-display text-xl font-bold text-white mb-2">Timed Trivia</h3>
            <p className="font-sans text-sm text-slate-400 leading-relaxed mb-6">
              Test your knowledge under time pressure with rapid-fire questions covering course modules. Answer before the clock runs out!
            </p>
          </div>
          <button
            onClick={() => openBuildModal('trivia')}
            className="w-full py-3 rounded-xl bg-cyan-400/10 border border-cyan-400/30 text-cyan-400 font-display font-semibold hover:bg-cyan-400 hover:text-black transition-all duration-300 flex items-center justify-center gap-2 active:scale-95"
          >
            Play Game <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Game Build Modal */}
      <Modal
        isOpen={isBuildModalOpen && !!selectedGameType}
        onClose={() => !generating && setIsBuildModalOpen(false)}
        title={selectedGameType ? `Build ${GAME_TITLE[selectedGameType]} Game` : 'Build Game'}
        maxWidth="max-w-lg"
      >
        <div className="flex flex-col gap-6 max-h-[70vh] overflow-y-auto pr-1 no-scrollbar">
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary-fixed-dim/10 border border-primary-fixed-dim/20 flex items-center justify-center">
                <Gamepad2 className="w-5 h-5 text-primary-fixed-dim" />
              </div>
              <div>
                <p className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold">
                  Setup Game Content
                </p>
                <p className="font-sans text-xs text-slate-500">Connect reference materials to formulate custom game content.</p>
              </div>
            </div>
          </div>

          {/* Study Space Selector */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 font-sans block">
              Target Space (Select 1)
            </label>

            {spacesLoading ? (
              <div className="flex items-center gap-2 p-3 text-slate-500 font-sans text-sm">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading your study spaces…
              </div>
            ) : spaces.length === 0 ? (
              <div className="flex items-center gap-1.5 text-xs text-slate-400 bg-white/5 border border-white/10 p-3 rounded-xl">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>No study spaces found. Create one and upload materials first.</span>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2.5">
                {spaces.map((s) => {
                  const isSelected = selectedSpaceId === s.id;
                  const info = getCourseDisplayInfo({ id: s.id, title: s.title, category: '' });
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSelectedSpaceId(s.id)}
                      className={clsx(
                        'w-full flex items-center gap-3 p-3 rounded-xl border font-sans text-left transition-all active:scale-[0.99]',
                        isSelected
                          ? 'bg-primary-fixed-dim/10 border-primary-fixed-dim text-white shadow-[0_0_15px_rgba(0,218,243,0.15)]'
                          : 'bg-surface-container border-white/5 text-slate-300 hover:bg-white/5 hover:text-white'
                      )}
                    >
                      <div className={`p-2 rounded-lg ${info.bg}`}>
                        <info.icon className={`w-4 h-4 ${info.color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="block font-semibold text-sm truncate">{s.title}</span>
                        {s.description && (
                          <span className="block text-[10px] text-slate-500 truncate">{s.description}</span>
                        )}
                      </div>
                      {isSelected && (
                        <div className="w-5 h-5 rounded-full bg-primary-fixed-dim flex items-center justify-center text-black">
                          <Check className="w-3.5 h-3.5 font-bold" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Learning Materials Selector */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 font-sans">
                Learning Materials (Select Multiple)
              </label>
              {materials.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedMaterialIds(allSelected ? [] : materials.map((m) => m.id))}
                  className="text-[10px] font-sans font-bold text-primary-fixed-dim hover:underline"
                >
                  {allSelected ? 'Deselect All' : 'Select All'}
                </button>
              )}
            </div>

            <div className="bg-slate-950/50 border border-white/5 rounded-xl p-3 max-h-48 overflow-y-auto space-y-2.5">
              {materialsLoading ? (
                <div className="flex items-center gap-2 p-2 text-slate-500 font-sans text-xs">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading materials…
                </div>
              ) : materials.length === 0 ? (
                <div className="flex items-center gap-1.5 text-xs text-slate-500 p-2 font-sans">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>No processed materials in this space yet.</span>
                </div>
              ) : (
                materials.map((m) => {
                  const isChecked = selectedMaterialIds.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggleMaterial(m.id)}
                      className={clsx(
                        'w-full flex items-center gap-3 p-2.5 rounded-lg border font-sans text-xs text-left transition-all',
                        isChecked
                          ? 'bg-white/5 border-white/10 text-white'
                          : 'bg-transparent border-transparent text-slate-400 hover:bg-white/5 hover:text-white'
                      )}
                    >
                      <div className={clsx(
                        'w-4 h-4 rounded border flex items-center justify-center transition-colors shrink-0',
                        isChecked ? 'bg-primary-fixed-dim border-primary-fixed-dim text-black' : 'border-white/20 bg-white/5'
                      )}>
                        {isChecked && <Check className="w-3.5 h-3.5 font-bold" />}
                      </div>
                      <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                      <span className="truncate flex-1 font-medium">{m.title}</span>
                    </button>
                  );
                })
              )}
            </div>

            {materials.length > 0 && selectedMaterialIds.length === 0 && (
              <div className="flex items-center gap-1.5 text-xs text-rose-400 bg-rose-500/5 border border-rose-500/10 p-2.5 rounded-xl mt-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>Please select at least one learning material to launch the game.</span>
              </div>
            )}
          </div>

          {genError && (
            <div className="flex items-center gap-1.5 text-xs text-rose-400 bg-rose-500/5 border border-rose-500/10 p-2.5 rounded-xl">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{genError}</span>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => setIsBuildModalOpen(false)}
              disabled={generating}
              className="flex-1 py-3 rounded-xl border border-white/10 font-sans text-sm font-semibold text-slate-300 hover:bg-white/5 transition-all disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleBuildAndLaunchGame}
              disabled={selectedMaterialIds.length === 0 || generating}
              className="flex-1 py-3 rounded-xl bg-primary-fixed-dim text-on-primary-fixed font-sans font-bold text-sm hover:bg-primary-container transition-all active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none shadow-lg shadow-primary-fixed-dim/20 flex items-center justify-center gap-2"
            >
              {generating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Generating…
                </>
              ) : (
                'Build & Launch Game'
              )}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
