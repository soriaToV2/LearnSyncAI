export interface Student {
  id: string;
  name: string;
  avatar: string;
  university: string;
  location: string;
  followers: number;
  following: number;
  completedSpaces: number;
  isFollowing: boolean;
  isFollower?: boolean;
  achievements: {
    id: string;
    title: string;
    organization: string;
    iconUrl?: string;
    iconType: 'BrainCircuit' | 'Award' | 'Star' | 'Book';
    colorType: 'primary' | 'indigo' | 'emerald' | 'amber';
  }[];
  spaces: {
    id: string;
    title: string;
    description: string;
    studiedCount: number;
    isTopRated: boolean;
    isPublic: boolean;
  }[];
}

export const MOCK_STUDENTS: Student[] = [
  {
    id: "me",
    name: "Sarah Jenkins",
    avatar: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=300",
    university: "MIT",
    location: "Cambridge, MA",
    followers: 342,
    following: 128,
    completedSpaces: 12,
    isFollowing: false,
    isFollower: false,
    achievements: [
      { id: "1", title: "Advanced Neurobiology", organization: "MIT", iconType: "BrainCircuit", colorType: "primary" },
      { id: "2", title: "Cognitive Psychology", organization: "Stanford Global", iconType: "Award", colorType: "indigo" },
      { id: "3", title: "Bioethics 101", organization: "MIT", iconType: "Star", colorType: "emerald" },
    ],
    spaces: [
      { id: "s1", title: "Synaptic Transmitters Decks", description: "45 flashcards focused on neurotransmitter release mechanisms.", studiedCount: 1200, isTopRated: true, isPublic: true },
      { id: "s2", title: "Neuroanatomy Midterm Prep", description: "Comprehensive review of brain structures and pathways.", studiedCount: 840, isTopRated: false, isPublic: false },
    ]
  },
  {
    id: "user2",
    name: "David Chen",
    avatar: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&q=80&w=300",
    university: "Stanford",
    location: "Stanford, CA",
    followers: 890,
    following: 245,
    completedSpaces: 24,
    isFollowing: true,
    isFollower: true,
    achievements: [
      { id: "4", title: "Systems Architecture", organization: "Stanford", iconType: "Book", colorType: "amber" },
      { id: "5", title: "Algorithms Master", organization: "Codecademy", iconType: "Award", colorType: "indigo" },
    ],
    spaces: [
      { id: "s3", title: "Data Structures Fast-Track", description: "Trees, Graphs, and Hash Maps in detailed visual guides.", studiedCount: 3400, isTopRated: true, isPublic: true },
    ]
  },
  {
    id: "user3",
    name: "Elena Rodriguez",
    avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=300",
    university: "UC Berkeley",
    location: "Berkeley, CA",
    followers: 124,
    following: 430,
    completedSpaces: 5,
    isFollowing: false,
    isFollower: true,
    achievements: [
      { id: "6", title: "Organic Chemistry", organization: "UC Berkeley", iconType: "Star", colorType: "emerald" },
    ],
    spaces: [
      { id: "s4", title: "O-Chem Reactions Viewer", description: "Interactive molecules and standard reactions.", studiedCount: 156, isTopRated: false, isPublic: false },
    ]
  },
  {
    id: "user4",
    name: "James Wilson",
    avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=300",
    university: "Harvard",
    location: "Cambridge, MA",
    followers: 512,
    following: 110,
    completedSpaces: 18,
    isFollowing: true,
    isFollower: false,
    achievements: [
      { id: "7", title: "Constitutional Law", organization: "Harvard", iconType: "Book", colorType: "amber" },
      { id: "8", title: "Debate Champion", organization: "National Forensics", iconType: "Award", colorType: "indigo" },
    ],
    spaces: [
      { id: "s5", title: "Law Case Briefs", description: "Summarized cases for 1L Constitutional Law.", studiedCount: 890, isTopRated: true, isPublic: true },
    ]
  }
];
