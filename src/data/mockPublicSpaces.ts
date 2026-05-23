export interface Flashcard {
  id: number;
  front: string;
  back: string;
}

export interface PublicSpaceDetail {
  id: string; // matches space.id, e.g. "s1", "s3", "s5", "s6", "s7", "s8", "s9"
  title: string;
  description: string;
  authorId: string;
  authorName: string;
  university: string;
  studiedCount: number;
  flashcardsCount: number;
  color: string; // tailwind gradient classes
  borderColor: string;
  flashcards: Flashcard[];
  resources: string[];
}

export const MOCK_PUBLIC_SPACES: Record<string, PublicSpaceDetail> = {
  s1: {
    id: "s1",
    title: "Synaptic Transmitters Decks",
    description: "45 flashcards focused on neurotransmitter release mechanisms.",
    authorId: "me",
    authorName: "Sarah Jenkins",
    university: "MIT",
    studiedCount: 1200,
    flashcardsCount: 3,
    color: "from-cyan-500/20 to-blue-500/20",
    borderColor: "border-cyan-500/30",
    flashcards: [
      { id: 1, front: "What initiates the release of neurotransmitters?", back: "An influx of Calcium ions (Ca2+) into the presynaptic terminal, triggered by an action potential." },
      { id: 2, front: "What is the synaptic cleft?", back: "The tiny gap between the presynaptic and postsynaptic neurons where neurotransmitters are released." },
      { id: 3, front: "What are vesicles in the context of synaptic transmission?", back: "Small membrane-bound sacs that store neurotransmitters and release them via exocytosis." }
    ],
    resources: ["Synaptic_Pathways_Ch4.pdf", "Lecture_03_Action_Potentials.pptx"]
  },
  s3: {
    id: "s3",
    title: "Data Structures Fast-Track",
    description: "Trees, Graphs, and Hash Maps in detailed visual guides.",
    authorId: "user2",
    authorName: "David Chen",
    university: "Stanford",
    studiedCount: 3400,
    flashcardsCount: 3,
    color: "from-blue-500/20 to-indigo-500/20",
    borderColor: "border-blue-500/30",
    flashcards: [
      { id: 4, front: "What is the worst-case time complexity of lookup in a Binary Search Tree?", back: "O(N), which occurs when the tree becomes completely unbalanced/skewed." },
      { id: 5, front: "What is the key difference between a Stack and a Queue?", back: "A Stack is Last-In-First-Out (LIFO), whereas a Queue is First-In-First-Out (FIFO)." },
      { id: 6, front: "How does a hash collision occur?", back: "When two different keys produce the same hash value from a hash function." }
    ],
    resources: ["Data_Structures_Lecture_Notes.pdf", "BST_Visual_Guide.pptx"]
  },
  s5: {
    id: "s5",
    title: "Law Case Briefs",
    description: "Summarized cases for 1L Constitutional Law.",
    authorId: "user4",
    authorName: "James Wilson",
    university: "Harvard",
    studiedCount: 890,
    flashcardsCount: 3,
    color: "from-amber-500/20 to-orange-500/20",
    borderColor: "border-amber-500/30",
    flashcards: [
      { id: 7, front: "What is the significance of Marbury v. Madison?", back: "It established the principle of judicial review in the United States." },
      { id: 8, front: "What is the Commerce Clause?", back: "Article I, Section 8, Clause 3, which gives Congress power to regulate commerce with foreign nations and among states." },
      { id: 9, front: "What is the standard of proof in a civil case?", back: "Preponderance of the evidence." }
    ],
    resources: ["Constitutional_Law_Syllabus.pdf", "Marbury_v_Madison_Brief.pdf"]
  },
  s6: {
    id: "s6",
    title: "World-Building Workshop",
    description: "Character arcs and setting generation techniques.",
    authorId: "user5",
    authorName: "Aisha Patel",
    university: "NYU",
    studiedCount: 5600,
    flashcardsCount: 3,
    color: "from-purple-500/20 to-fuchsia-500/20",
    borderColor: "border-purple-500/30",
    flashcards: [
      { id: 10, front: "What is the 'Show, Don't Tell' rule?", back: "The technique of writing actions and sensory details rather than summarizing a character's traits directly." },
      { id: 11, front: "What is a foil character?", back: "A character who contrasts with another character (usually the protagonist) to highlight particular qualities." },
      { id: 12, front: "What is the Hero's Journey (Monomyth)?", back: "A common story template involving a hero who goes on an adventure, wins a victory in a crisis, and returns transformed." }
    ],
    resources: ["World_Building_Frameworks.docx", "Hero_Journey_Stages.pptx"]
  },
  s7: {
    id: "s7",
    title: "Kinematics Equations",
    description: "Forward and inverse kinematics for robotic arms.",
    authorId: "user6",
    authorName: "Michael Chang",
    university: "Georgia Tech",
    studiedCount: 420,
    flashcardsCount: 3,
    color: "from-emerald-500/20 to-teal-500/20",
    borderColor: "border-emerald-500/30",
    flashcards: [
      { id: 13, front: "What is Forward Kinematics?", back: "Calculating the position and orientation of the end-effector from joint angles." },
      { id: 14, front: "What is Inverse Kinematics?", back: "Calculating the required joint angles to achieve a desired end-effector position." },
      { id: 15, front: "What is a Jacobian matrix in robotics?", back: "A matrix representing the relationship between joint velocities and end-effector velocities." }
    ],
    resources: ["Robot_Kinematics_Handbook.pdf", "Forward_Kinematics_Practice.docx"]
  },
  s8: {
    id: "s8",
    title: "Eco-Materials Gallery",
    description: "Properties of sustainable building materials.",
    authorId: "user7",
    authorName: "Sophia Rossi",
    university: "Politecnico di Milano",
    studiedCount: 12000,
    flashcardsCount: 3,
    color: "from-teal-500/20 to-emerald-500/20",
    borderColor: "border-teal-500/30",
    flashcards: [
      { id: 16, front: "What is Rammed Earth?", back: "A structural wall material made by compacting damp soil, sand, gravel, and clay into formwork." },
      { id: 17, front: "What is Embodied Carbon?", back: "The sum of all greenhouse gas emissions resulting from the mining, harvesting, processing, manufacturing, transportation, and installation of building materials." },
      { id: 18, front: "What is cross-laminated timber (CLT)?", back: "A mass timber product made of glued layers of solid-sawn lumber, offering a low-carbon alternative to concrete." }
    ],
    resources: ["Sustainable_Materials_Index.pdf", "CLT_Structural_Specs.pptx"]
  },
  s9: {
    id: "s9",
    title: "Quantum Mechanics Visualized",
    description: "Wave functions and probability density.",
    authorId: "user8",
    authorName: "Tariq Al-Hassan",
    university: "Oxford",
    studiedCount: 2300,
    flashcardsCount: 3,
    color: "from-rose-500/20 to-orange-500/20",
    borderColor: "border-rose-500/30",
    flashcards: [
      { id: 19, front: "What is the Schrodinger Equation?", back: "A linear partial differential equation that describes the wave function or state function of a quantum-mechanical system." },
      { id: 20, front: "What is Quantum Superposition?", back: "A fundamental principle where a physical system exists in multiple states simultaneously until measured." },
      { id: 21, front: "Define Quantum Entanglement.", back: "A phenomenon where quantum states of two or more particles are linked, such that measurement of one instantly determines the state of the other." }
    ],
    resources: ["Quantum_Visualizations.pdf", "Schrodinger_Derivation.docx"]
  }
};

let savedSpacesMemory: any[] = [];

export const getSavedSpaces = () => {
  return savedSpacesMemory;
};

export const saveSpaceToMemory = (space: any) => {
  if (!savedSpacesMemory.some(s => s.id === space.id)) {
    savedSpacesMemory = [space, ...savedSpacesMemory];
  }
};

export const unsaveSpaceFromMemory = (spaceId: string) => {
  savedSpacesMemory = savedSpacesMemory.filter(s => s.id !== spaceId);
};

export const updateSavedSpaceFlashcards = (spaceId: string, cards: any[]) => {
  const space = savedSpacesMemory.find(s => s.id === spaceId);
  if (space) {
    space.flashcards = cards;
    space.flashcardsCount = cards.length;
  }
};
