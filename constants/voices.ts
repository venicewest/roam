// constants/voices.ts
// Available ElevenLabs voices for Roam narration.

export type Voice = {
  id: string;
  name: string;
  accent: "British" | "American";
  gender: "male" | "female";
};

export const ELEVENLABS_VOICES: Voice[] = [
  { id: "ZF6FPAbjXT4488VcRRnw", name: "Amelia",    accent: "British",  gender: "female" },
  { id: "j9jfwdrw7BRfcR43Qohk", name: "Frederick", accent: "British",  gender: "male"   },
  { id: "ZthjuvLPty3kTMaNKVKb", name: "Peter",     accent: "American", gender: "male"   },
  { id: "NFG5qt843uXKj4pFvR7C", name: "Adam",      accent: "British",  gender: "male"   },
  { id: "EkK5I93UQWFDigLMpZcX", name: "James",     accent: "American", gender: "male"   },
  { id: "uju3wxzG5OhpWcoi3SMy", name: "Michael",   accent: "American", gender: "male"   },
  { id: "lxYfHSkYm1EzQzGhdbfc", name: "Jessica",   accent: "American", gender: "female" },
  { id: "Z3R5wn05IrDiVCyEkUrK", name: "Arabella",  accent: "American", gender: "female" },
];

export const DEFAULT_VOICE_ID = ELEVENLABS_VOICES[0].id; // Amelia

export function getVoiceById(id: string): Voice | undefined {
  return ELEVENLABS_VOICES.find((v) => v.id === id);
}
