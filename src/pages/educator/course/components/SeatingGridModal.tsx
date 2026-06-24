import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Users, Sparkles, RefreshCw, Move, HelpCircle, CheckCircle2, AlertTriangle, Monitor, Grid, RotateCw } from 'lucide-react';
import type { EnrolledStudent, Assessment } from '../../../../data/mockEducatorData';
import Dropdown from '../../../../components/ui/Dropdown';
import Modal from '../../../../components/ui/Modal';

interface SeatInfo {
  row: number;
  col: number;
  studentId: string | null;
  isAbsent?: boolean;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  courseId: string;
  students: EnrolledStudent[];
  assessment: Assessment;
  onDeploy?: () => void;
}

// Set Color Config mapping
const SET_COLORS: Record<string, { bg: string; text: string; border: string; accent: string }> = {
  'Set A': { bg: 'bg-indigo-500/15', text: 'text-indigo-400', border: 'border-indigo-500/30', accent: '#6366f1' },
  'Set B': { bg: 'bg-purple-500/15', text: 'text-purple-400', border: 'border-purple-500/30', accent: '#a855f7' },
  'Set C': { bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/30', accent: '#10b981' },
  'Set D': { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/30', accent: '#f59e0b' },
  'Set E': { bg: 'bg-rose-500/15', text: 'text-rose-400', border: 'border-rose-500/30', accent: '#f43f5e' },
};

const SET_KEYS = ['Set A', 'Set B', 'Set C', 'Set D', 'Set E'];

export default function SeatingGridModal({ isOpen, onClose, courseId, students, assessment, onDeploy }: Props) {
  const [gridRows, setGridRows] = useState(6);
  const [gridCols, setGridCols] = useState(8);
  const [seats, setSeats] = useState<SeatInfo[]>([]);
  const [selectedSeat, setSelectedSeat] = useState<SeatInfo | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  const isReadOnly = assessment.status === 'deployed' || assessment.status === 'closed';

  // Load / initialize seating grid
  useEffect(() => {
    if (!isOpen) return;

    const storageKey = `learnSyncAI_seating_grid_${courseId}`;
    const saved = localStorage.getItem(storageKey);

    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setSeats(parsed);
          // find dimensions
          let maxR = 5, maxC = 7;
          parsed.forEach((s: SeatInfo) => {
            if (s.row > maxR) maxR = s.row;
            if (s.col > maxC) maxC = s.col;
          });
          setGridRows(maxR + 1);
          setGridCols(maxC + 1);
          return;
        }
      } catch (e) {
        console.error('Failed to parse seating layout', e);
      }
    }

    // Default Initialization
    const initialSeats: SeatInfo[] = [];
    const cols = 8;
    const rows = 6;
    setGridRows(rows);
    setGridCols(cols);

    // Sort students alphabetically by name
    const sortedStudents = [...students].sort((a, b) => a.name.localeCompare(b.name));

    sortedStudents.forEach((student, idx) => {
      const r = Math.floor(idx / cols);
      const c = idx % cols;
      initialSeats.push({
        row: r,
        col: c,
        studentId: student.id,
        isAbsent: false,
      });
    });

    // Fill remaining cells
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!initialSeats.some(s => s.row === r && s.col === c)) {
          initialSeats.push({ row: r, col: c, studentId: null });
        }
      }
    }
    setSeats(initialSeats);
  }, [isOpen, courseId, students]);

  if (!isOpen) return null;

  // Save current layout to local storage
  const saveLayout = (updatedSeats: SeatInfo[]) => {
    localStorage.setItem(`learnSyncAI_seating_grid_${courseId}`, JSON.stringify(updatedSeats));
  };

  // Resize grid
  const handleResize = (newRows: number, newCols: number) => {
    if (isReadOnly) return;
    setGridRows(newRows);
    setGridCols(newCols);

    const updated = [...seats];
    const presentStudents = updated
      .filter(s => s.studentId !== null)
      .map(s => ({ id: s.studentId!, isAbsent: !!s.isAbsent }));

    const newSeats: SeatInfo[] = [];
    let studentIdx = 0;

    for (let r = 0; r < newRows; r++) {
      for (let c = 0; c < newCols; c++) {
        if (studentIdx < presentStudents.length) {
          const stud = presentStudents[studentIdx++];
          newSeats.push({ row: r, col: c, studentId: stud.id, isAbsent: stud.isAbsent });
        } else {
          newSeats.push({ row: r, col: c, studentId: null });
        }
      }
    }
    setSeats(newSeats);
    saveLayout(newSeats);
    setSelectedSeat(null);
  };

  // Get student info
  const getStudent = (id: string | null) => students.find(s => s.id === id);

  // Toggle absence
  const toggleAbsence = (seat: SeatInfo) => {
    if (isReadOnly) return;
    const updated = seats.map(s => {
      if (s.row === seat.row && s.col === seat.col) {
        return { ...s, isAbsent: !s.isAbsent };
      }
      return s;
    });
    setSeats(updated);
    saveLayout(updated);
  };

  // Seat Click handler
  const handleSeatClick = (seat: SeatInfo) => {
    if (isReadOnly) return;
    if (!selectedSeat) {
      setSelectedSeat(seat);
    } else {
      const updated = seats.map(s => {
        if (s.row === selectedSeat.row && s.col === selectedSeat.col) {
          return { ...s, studentId: seat.studentId, isAbsent: seat.isAbsent };
        }
        if (s.row === seat.row && s.col === seat.col) {
          return { ...s, studentId: selectedSeat.studentId, isAbsent: selectedSeat.isAbsent };
        }
        return s;
      });
      setSeats(updated);
      saveLayout(updated);
      setSelectedSeat(null);
    }
  };

  // Reset/Clear selection
  const cancelSelection = () => {
    setSelectedSeat(null);
  };

  // Mark all present
  const markAllPresent = () => {
    if (isReadOnly) return;
    const updated = seats.map(s => ({ ...s, isAbsent: false }));
    setSeats(updated);
    saveLayout(updated);
  };

  // Dynamically calculate set assignments for present students in layout order 
  const numSets = assessment.numberOfSets || 3;
  const dynamicSetAssignments = React.useMemo(() => {
    const assignments: Record<string, string> = {};
    let presentIndex = 0;

    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        const seat = seats.find(s => s.row === r && s.col === c);
        if (seat && seat.studentId !== null && !seat.isAbsent) {
          assignments[seat.studentId] = SET_KEYS[presentIndex % numSets];
          presentIndex++;
        }
      }
    }
    return assignments;
  }, [seats, gridRows, gridCols, numSets]);

  // Drag and Drop Handlers
  const handleDragStart = (e: React.DragEvent, seat: SeatInfo) => {
    if (isReadOnly) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData('text/plain', JSON.stringify(seat));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (isReadOnly) return;
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, targetSeat: SeatInfo) => {
    if (isReadOnly) return;
    e.preventDefault();
    try {
      const sourceSeat = JSON.parse(e.dataTransfer.getData('text/plain')) as SeatInfo;
      if (sourceSeat.row === targetSeat.row && sourceSeat.col === targetSeat.col) return;

      // Swap or Move
      const updated = seats.map(s => {
        if (s.row === sourceSeat.row && s.col === sourceSeat.col) {
          return { ...s, studentId: targetSeat.studentId, isAbsent: targetSeat.isAbsent };
        }
        if (s.row === targetSeat.row && s.col === targetSeat.col) {
          return { ...s, studentId: sourceSeat.studentId, isAbsent: sourceSeat.isAbsent };
        }
        return s;
      });
      setSeats(updated);
      saveLayout(updated);
      setSelectedSeat(null);
    } catch (err) {
      console.error('Failed to drop seat', err);
    }
  };

  // Statistics
  const activeSeats = seats.filter(s => s.studentId !== null);
  const presentCount = activeSeats.filter(s => !s.isAbsent).length;
  const absentCount = activeSeats.filter(s => s.isAbsent).length;
  const totalStudents = students.length;
  // Any student unassigned to a seat?
  const assignedIds = seats.map(s => s.studentId).filter(Boolean);
  const unassignedStudents = students.filter(s => !assignedIds.includes(s.id));

  // Handle Deploy
  const handleDeployClick = () => {
    if (onDeploy) {
      // Mark as deployed
      onDeploy();
    }
    onClose();
  };

  // Helper for row names
  const getRowLetter = (rIdx: number) => String.fromCharCode(65 + rIdx);

  return (
    <>
      {/* Landscape rotation warning for mobile portrait screens */}
      {isOpen && createPortal(
        <div
          onClick={onClose}
          className="hidden portrait:max-sm:flex fixed inset-0 bg-slate-950/95 z-[250] flex-col items-center justify-center text-center p-6 select-none animate-in fade-in duration-200 cursor-pointer"
        >
          <div className="w-16 h-16 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-4 animate-bounce">
            <RotateCw className="w-8 h-8 text-amber-400" />
          </div>
          <h3 className="font-display text-base font-bold text-white mb-2">Rotate Your Device</h3>
          <p className="font-sans text-xs text-slate-400 max-w-[240px] leading-relaxed mb-6 normal-case">
            For this to work, please rotate your phone to landscape mode.
          </p>
          <span className="font-sans text-[11px] uppercase tracking-wider text-slate-500 font-semibold border border-white/10 px-3 py-1.5 rounded-full hover:text-white hover:border-white/20 transition-all">
            Tap anywhere to cancel
          </span>
        </div>,
        document.body
      )}

      <Modal
        isOpen={isOpen}
      onClose={onClose}
      title={
        <div className="flex flex-col gap-1 items-start">
          <div className="flex items-center gap-2">
            <span className="font-display text-base sm:text-lg font-semibold text-white">Classroom Seating &amp; Attendance</span>
            <span className="px-2 py-0.5 rounded-full bg-primary-fixed-dim/15 text-primary-fixed-dim border border-primary-fixed-dim/20 text-[10px] uppercase font-bold tracking-wider font-sans whitespace-nowrap">
              {assessment.type} Layout
            </span>
          </div>
          <p className="hidden sm:block font-sans text-xs text-slate-400 font-normal normal-case">
            Confirm who is absent and verify the anti-cheat isomorphic set distribution before students take the test.
          </p>
        </div>
      }
      headerActions={
        <button
          onClick={() => setShowHelp(h => !h)}
          className={`p-2 text-slate-400 hover:text-white rounded-full transition-colors ${showHelp ? 'bg-white/10 text-white' : 'hover:bg-white/5'}`}
          title="Show Layout Help"
        >
          <HelpCircle className="w-5 h-5" />
        </button>
      }
      maxWidth="max-w-5xl"
      noPadding={true}
    >
      <div className="relative w-full flex flex-col max-h-[75vh] landscape:max-h-[60vh] sm:max-h-[80vh] md:max-h-[85vh] overflow-y-auto no-scrollbar">

        {/* Top Info Dashboard */}
        <div className="bg-surface-container/60 px-4 py-2 sm:px-6 sm:py-3.5 border-b border-white/5 flex flex-wrap items-center justify-between gap-3 shrink-0 text-sans text-[11px] sm:text-xs">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Users className="w-3.5 h-3.5 text-indigo-400" />
              <span className="text-slate-300 normal-case">
                Attendance: <strong className="text-emerald-400 font-semibold">{presentCount} Present</strong>
                {absentCount > 0 && <span className="text-slate-500"> / </span>}
                {absentCount > 0 && <strong className="text-rose-400 font-semibold">{absentCount} Absent</strong>}
                <span className="text-slate-500"> (Total: {totalStudents})</span>
              </span>
            </div>
            {unassignedStudents.length > 0 && (
              <div className="flex items-center gap-1.5 text-amber-400 font-semibold">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>{unassignedStudents.length} Unassigned</span>
              </div>
            )}
          </div>

          {isReadOnly ? (
            <div className="flex items-center gap-3">
              <span className="text-slate-400 italic font-sans text-[11px] bg-white/5 border border-white/5 rounded-xl px-2.5 py-1 flex items-center gap-1.5 normal-case">
                <Monitor className="w-3.5 h-3.5 text-slate-500" /> Layout is Locked
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-slate-400 font-medium hidden sm:inline normal-case">Grid Dimension:</span>
              <Dropdown
                value={String(gridRows)}
                onChange={(val) => handleResize(parseInt(val), gridCols)}
                options={[
                  { label: '3 Rows', value: '3' },
                  { label: '4 Rows', value: '4' },
                  { label: '5 Rows', value: '5' },
                  { label: '6 Rows', value: '6' },
                  { label: '7 Rows', value: '7' },
                  { label: '8 Rows', value: '8' }
                ]}
                className="w-24 sm:w-28 text-xs"
              />
              <span className="text-slate-600 font-sans font-semibold text-xs">x</span>
              <Dropdown
                value={String(gridCols)}
                onChange={(val) => handleResize(gridRows, parseInt(val))}
                options={[
                  { label: '4 Columns', value: '4' },
                  { label: '5 Columns', value: '5' },
                  { label: '6 Columns', value: '6' },
                  { label: '7 Columns', value: '7' },
                  { label: '8 Columns', value: '8' },
                  { label: '9 Columns', value: '9' },
                  { label: '10 Columns', value: '10' }
                ]}
                className="w-28 sm:w-32 text-xs"
              />

              <button
                onClick={markAllPresent}
                className="px-2.5 py-1.5 bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300 rounded-xl font-sans text-xs font-semibold transition-all hover:text-white normal-case"
              >
                Reset Attendance
              </button>
            </div>
          )}
        </div>

        {/* Scrollable grid area */}
        <div className="flex-1 overflow-auto p-4 sm:p-6 bg-surface-container-lowest/20 sm:min-h-[350px] min-h-0 flex flex-col justify-between">
          <div className="flex flex-col gap-4">

            {/* Help / Alert banner */}
            {isReadOnly ? (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-xs font-sans text-amber-200 leading-relaxed normal-case">
                <h4 className="font-semibold text-white mb-1 uppercase tracking-wide flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 font-bold animate-pulse" /> Seating Layout Locked
                </h4>
                <p className="mt-0.5">
                  This exam is currently {assessment.status === 'deployed' ? 'ongoing' : 'closed'}. The seating layout, attendance records, and student test set assignments are locked and cannot be edited.
                </p>
              </div>
            ) : (
              showHelp && (
                <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-4 text-xs font-sans text-indigo-200 leading-relaxed animate-in slide-in-from-top-2 normal-case">
                  <h4 className="font-semibold text-white mb-1 uppercase tracking-wide flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-primary-fixed-dim" /> How to Edit Seats &amp; Attendance
                  </h4>
                  <ul className="list-disc pl-4 space-y-1 mt-1">
                    <li><strong>Seating Swap / Move:</strong> Click a student card (it will pulse in cyan). Then click <i>any other seat</i> (either empty or occupied) to instantly swap or move them there.</li>
                    <li><strong>Attendance:</strong> Click the <span className="text-emerald-400 font-semibold font-normal">Present</span> or <span className="text-rose-400 font-semibold font-normal">Absent</span> toggle on each student's card to change their attendance.</li>
                    <li><strong>Anti-Cheat sets:</strong> Color codes correspond to the test sets assigned to each seat. If a student is absent, their set assignment is released to prevent key leakage. Sets are optimized checkerboard style.</li>
                  </ul>
                </div>
              )
            )}

            {/* Selection floating helper */}
            {selectedSeat && (
              <div className="bg-primary-fixed-dim/10 border border-primary-fixed-dim/20 rounded-xl px-4 py-3 flex items-center justify-between text-xs font-sans text-slate-200 animate-pulse normal-case">
                <div className="flex items-center gap-2">
                  <Move className="w-4 h-4 text-primary-fixed-dim" />
                  <span>
                    Selected seat <strong>{getRowLetter(selectedSeat.row)}{selectedSeat.col + 1}</strong>
                    {selectedSeat.studentId ? ` (${getStudent(selectedSeat.studentId)?.name})` : ' (Empty Seat)'}.
                    Click any other seat to swap/move, or click cancel.
                  </span>
                </div>
                <button
                  onClick={cancelSelection}
                  className="px-3 py-1 bg-white/10 hover:bg-white/15 text-white rounded-lg font-semibold transition-colors"
                >
                  Cancel Selection
                </button>
              </div>
            )}

            {/* The Seating Grid Layout */}
            <div className="relative border border-white/5 rounded-2xl bg-white/[0.01] p-6 flex flex-col gap-4 overflow-x-auto no-scrollbar">

              {/* Front of the Classroom indicator */}
              <div className="flex items-center justify-center gap-3 py-2 border-b border-dashed border-white/10 mb-2 shrink-0">
                <Monitor className="w-4 h-4 text-slate-500" />
                <span className="font-sans text-[10px] text-slate-500 uppercase tracking-[0.2em] font-bold">Board / Instructor's Desk (Front)</span>
              </div>

              <div
                className="grid gap-3 select-none mx-auto"
                style={{
                  gridTemplateColumns: `repeat(${gridCols}, minmax(110px, 1fr))`,
                  width: 'max-content',
                  minWidth: '100%',
                }}
              >
                {Array.from({ length: gridRows }).map((_, rIdx) => {
                  return Array.from({ length: gridCols }).map((_, cIdx) => {
                    const seat = seats.find(s => s.row === rIdx && s.col === cIdx) || { row: rIdx, col: cIdx, studentId: null };
                    const student = getStudent(seat.studentId);
                    const isSelected = selectedSeat?.row === rIdx && selectedSeat?.col === cIdx;
                    const setLabel = seat.studentId !== null && !seat.isAbsent ? dynamicSetAssignments[seat.studentId] : null;
                    const setCfg = setLabel ? (SET_COLORS[setLabel] || { bg: 'bg-white/5', text: 'text-slate-400', border: 'border-white/10', accent: 'transparent' }) : { bg: 'bg-white/5', text: 'text-slate-400', border: 'border-white/10', accent: 'transparent' };

                    return (
                      <div
                        key={`${rIdx}-${cIdx}`}
                        onClick={() => !isReadOnly && handleSeatClick(seat)}
                        draggable={!isReadOnly && seat.studentId !== null}
                        onDragStart={(e) => handleDragStart(e, seat)}
                        onDragOver={(e) => handleDragOver(e)}
                        onDrop={(e) => handleDrop(e, seat)}
                        className={`group relative min-h-[92px] rounded-xl border flex flex-col justify-between p-2.5 transition-all duration-300 cursor-pointer ${isSelected
                          ? 'border-primary-fixed-dim bg-primary-fixed-dim/10 shadow-[0_0_15px_rgba(0,218,243,0.25)] scale-[1.02] z-10'
                          : seat.studentId === null
                            ? 'border-white/5 hover:border-white/15 bg-white/[0.01] hover:bg-white/[0.03]'
                            : seat.isAbsent
                              ? 'border-red-500/20 bg-red-950/10 hover:border-red-500/40 opacity-50'
                              : `bg-white/[0.02] hover:bg-white/[0.04] ${setCfg.border} hover:border-white/20`
                          }`}
                        style={{
                          borderLeftWidth: seat.studentId !== null && !seat.isAbsent && setLabel ? '4px' : '1px',
                          borderLeftColor: seat.studentId !== null && !seat.isAbsent && setLabel ? setCfg.accent : undefined
                        }}
                      >
                        {/* Coordinates marker */}
                        <div className="absolute top-1 right-1.5 font-mono text-[9px] text-slate-600 font-bold">
                          {getRowLetter(rIdx)}{cIdx + 1}
                        </div>

                        {seat.studentId === null ? (
                          /* EMPTY SEAT */
                          <div className="flex-1 flex flex-col items-center justify-center text-center p-2">
                            <span className="text-[10px] font-sans text-slate-600 font-bold uppercase tracking-wider group-hover:text-slate-400 transition-colors">
                              Empty Seat
                            </span>
                          </div>
                        ) : (
                          <div className="flex-1 flex flex-col justify-between h-full gap-2">
                            <div className="flex items-center gap-1.5 pr-2">
                              {student?.avatar ? (
                                <img
                                  src={student.avatar}
                                  alt={student.name}
                                  className="w-5 h-5 rounded-full object-cover border border-white/10"
                                />
                              ) : (
                                <div className="w-5 h-5 rounded-full bg-white/15 flex items-center justify-center font-sans text-[8px] font-bold text-white uppercase border border-white/10">
                                  {student?.name.charAt(0)}
                                </div>
                              )}
                              <p className="font-sans text-[11px] font-bold text-slate-100 group-hover:text-white truncate normal-case" title={student?.name}>
                                {student?.name.split(' ')[0]}
                              </p>
                            </div>

                            {/* Set Display or Absent Label */}
                            {seat.isAbsent ? (
                              <div className="px-2 py-0.5 rounded bg-rose-500/15 border border-rose-500/20 text-rose-400 font-sans font-bold text-[9px] uppercase tracking-wider w-max">
                                Absent
                              </div>
                            ) : (
                              <div className={`px-2 py-0.5 rounded font-sans font-bold text-[9px] uppercase tracking-wider w-max ${setCfg.bg} ${setCfg.text}`}>
                                {setLabel}
                              </div>
                            )}

                            {/* Present / Absent Toggle Buttons */}
                            {!isReadOnly && (
                              <div
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleAbsence(seat);
                                }}
                                className={`w-full text-center py-0.5 rounded text-[8px] font-bold uppercase tracking-widest transition-all ${seat.isAbsent
                                  ? 'bg-rose-500/10 hover:bg-rose-500/25 text-rose-400 border border-rose-500/20'
                                  : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20'
                                  }`}
                              >
                                {seat.isAbsent ? 'Mark Present' : 'Mark Absent'}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  });
                })}
              </div>
            </div>
          </div>

          {/* Unassigned Students Tray */}
          {!isReadOnly && unassignedStudents.length > 0 && (
            <div className="mt-6 border border-amber-500/15 rounded-2xl bg-amber-500/[0.02] p-4">
              <h4 className="font-sans text-[10px] text-amber-400 font-bold uppercase tracking-widest mb-2 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> Unassigned Students ({unassignedStudents.length})
              </h4>
              <div className="flex flex-wrap gap-2">
                {unassignedStudents.map(student => (
                  <div
                    key={student.id}
                    onClick={() => {
                      const firstEmptyIdx = seats.findIndex(s => s.studentId === null);
                      if (firstEmptyIdx !== -1) {
                        const updated = [...seats];
                        updated[firstEmptyIdx] = { ...updated[firstEmptyIdx], studentId: student.id, isAbsent: false };
                        setSeats(updated);
                        saveLayout(updated);
                        showToast(`Placed ${student.name} at seat ${getRowLetter(updated[firstEmptyIdx].row)}${updated[firstEmptyIdx].col + 1}`);
                      }
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-amber-400/40 text-slate-300 hover:text-white transition-all text-xs cursor-pointer normal-case"
                  >
                    {student.avatar ? (
                      <img src={student.avatar} alt={student.name} className="w-4 h-4 rounded-full object-cover" />
                    ) : (
                      <div className="w-4 h-4 rounded-full bg-white/10 text-[8px] flex items-center justify-center font-bold text-white">{student.name.charAt(0)}</div>
                    )}
                    <span>{student.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Legend / Key Footer */}
        <div className="bg-surface-container/40 px-4 py-2 sm:px-6 sm:py-3 border-t border-white/5 shrink-0 flex items-center gap-4 text-[10px] font-sans font-bold text-slate-500 uppercase tracking-wider flex-wrap">
          <span>Set Key:</span>
          {SET_KEYS.slice(0, numSets).map(setLabel => {
            const cfg = SET_COLORS[setLabel];
            return (
              <div key={setLabel} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cfg.accent }} />
                <span className={cfg.text}>{setLabel}</span>
              </div>
            );
          })}
        </div>

        {/* Modal Actions Footer */}
        <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between px-4 py-3 sm:px-6 sm:py-4 border-t border-white/10 shrink-0 gap-3">
          {isReadOnly ? (
            <div className="w-full flex justify-end">
              <button
                onClick={onClose}
                className="w-full sm:w-auto px-6 py-2 bg-white/5 border border-white/10 hover:bg-white/10 text-white rounded-xl font-sans text-sm font-bold transition-all text-center normal-case"
              >
                Close View
              </button>
            </div>
          ) : (
            <>
              <button
                onClick={onClose}
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl font-sans text-sm font-semibold text-slate-300 hover:bg-white/5 transition-colors text-center normal-case"
              >
                Cancel
              </button>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                <button
                  onClick={() => {
                    saveLayout(seats);
                    onClose();
                  }}
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl font-sans text-sm font-bold border border-white/20 text-slate-300 hover:bg-white/5 transition-all text-center normal-case"
                >
                  Save Layout
                </button>

                {onDeploy && assessment.status === 'ready' && (
                  <button
                    onClick={handleDeployClick}
                    className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-xl font-sans text-sm font-bold shadow-lg shadow-emerald-500/10 hover:opacity-90 transition-all active:scale-[0.98] normal-case"
                  >
                    <CheckCircle2 className="w-4 h-4" /> Save &amp; Deploy Now
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
    </>
  );
}

function showToast(msg: string) {
  const ev = new CustomEvent('learnSyncAI_toast', { detail: msg });
  window.dispatchEvent(ev);
}
