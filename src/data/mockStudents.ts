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
  },
  {
    id: "user5",
    name: "Aisha Patel",
    avatar: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&q=80&w=300",
    university: "NYU",
    location: "New York, NY",
    followers: 1045,
    following: 320,
    completedSpaces: 35,
    isFollowing: false,
    isFollower: true,
    achievements: [
      { id: "9", title: "Creative Writing", organization: "NYU", iconType: "Book", colorType: "primary" },
      { id: "10", title: "Published Author", organization: "NYT", iconType: "Star", colorType: "amber" },
    ],
    spaces: [
      { id: "s6", title: "World-Building Workshop", description: "Character arcs and setting generation techniques.", studiedCount: 5600, isTopRated: true, isPublic: true },
    ]
  },
  {
    id: "user6",
    name: "Michael Chang",
    avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=300",
    university: "Georgia Tech",
    location: "Atlanta, GA",
    followers: 210,
    following: 150,
    completedSpaces: 8,
    isFollowing: true,
    isFollower: false,
    achievements: [
      { id: "11", title: "Robotics Fundamentals", organization: "Georgia Tech", iconType: "BrainCircuit", colorType: "indigo" },
    ],
    spaces: [
      { id: "s7", title: "Kinematics Equations", description: "Forward and inverse kinematics for robotic arms.", studiedCount: 420, isTopRated: false, isPublic: true },
    ]
  },
  {
    id: "user7",
    name: "Sophia Rossi",
    avatar: "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&q=80&w=300",
    university: "Politecnico di Milano",
    location: "Milan, Italy",
    followers: 3400,
    following: 890,
    completedSpaces: 42,
    isFollowing: false,
    isFollower: false,
    achievements: [
      { id: "12", title: "Sustainable Architecture", organization: "PoliMi", iconType: "Star", colorType: "emerald" },
    ],
    spaces: [
      { id: "s8", title: "Eco-Materials Gallery", description: "Properties of sustainable building materials.", studiedCount: 12000, isTopRated: true, isPublic: true },
    ]
  },
  {
    id: "user8",
    name: "Tariq Al-Hassan",
    avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=300",
    university: "Oxford",
    location: "Oxford, UK",
    followers: 678,
    following: 412,
    completedSpaces: 15,
    isFollowing: true,
    isFollower: true,
    achievements: [
      { id: "13", title: "Quantum Physics", organization: "Oxford", iconType: "BrainCircuit", colorType: "primary" },
    ],
    spaces: [
      { id: "s9", title: "Quantum Mechanics Visualized", description: "Wave functions and probability density.", studiedCount: 2300, isTopRated: true, isPublic: true },
    ]
  }
];
