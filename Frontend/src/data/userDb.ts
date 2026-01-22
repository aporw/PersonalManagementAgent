export type User = {
  id: string;
  name: string;
  email: string;
  role: string;
  avatarUrl?: string;
  bio?: string;
};

// Sample user data (randomized for development/demo purposes)
export const currentUser: User = {
  id: "u_82b9",
  name: "Asha Patel",
  email: "asha.patel@example.com",
  role: "Product Designer",
  avatarUrl: "https://api.dicebear.com/6.x/thumbs/svg?seed=AshaPatel",
  bio: "Design-minded product lead. Loves building delightful UX and coffee. Based in Bangalore.",
};

export const userDb: User[] = [
  currentUser,
  {
    id: "u_73k1",
    name: "Jon Rivers",
    email: "jon.rivers@example.com",
    role: "ML Engineer",
    avatarUrl: "https://api.dicebear.com/6.x/thumbs/svg?seed=JonRivers",
    bio: "Works on model infra and MLOps. Enjoys trail running and chess.",
  },
  {
    id: "u_54m2",
    name: "Maya Chen",
    email: "maya.chen@example.com",
    role: "Frontend Engineer",
    avatarUrl: "https://api.dicebear.com/6.x/thumbs/svg?seed=MayaChen",
    bio: "Building performant UIs with a focus on accessibility.",
  },
];
