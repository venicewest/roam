// stores/userStore.ts
import { create } from "zustand/react";
import { InterestCategory, Profile, supabase } from "../services/supabase";

type UserStore = {
  profile: Profile | null;
  categories: InterestCategory[];
  selectedCategoryIds: number[];
  isLoading: boolean;
  adaptiveLock: boolean;

  fetchProfile: () => Promise<void>;
  fetchCategories: () => Promise<void>;
  refreshBalance: () => Promise<void>;
  toggleCategory: (categoryId: number) => void;
  savePreferences: () => Promise<void>;
  saveVoice: (voiceId: string) => Promise<void>;
  setAdaptiveLock: (locked: boolean) => void;
  reset: () => void;
};

export const useUserStore = create<UserStore>((set, get) => ({
  profile: null,
  categories: [],
  selectedCategoryIds: [],
  isLoading: false,
  adaptiveLock: false,

  fetchProfile: async () => {
    set({ isLoading: true });
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      set({ isLoading: false });
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    const { data: prefs } = await supabase
      .from("user_interest_preferences")
      .select("category_id")
      .eq("user_id", user.id);

    set({
      profile,
      selectedCategoryIds: prefs?.map((p) => p.category_id) ?? [],
      isLoading: false,
    });
  },

  fetchCategories: async () => {
    const { data } = await supabase
      .from("interest_categories")
      .select("*")
      .order("id");
    set({ categories: data ?? [] });
  },

  refreshBalance: async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: profile } = await supabase
      .from("profiles")
      .select("credit_balance")
      .eq("id", user.id)
      .single();

    if (profile) {
      set((state) => ({
        profile: state.profile
          ? { ...state.profile, credit_balance: profile.credit_balance }
          : null,
      }));
    }
  },

  toggleCategory: (categoryId: number) => {
    const current = get().selectedCategoryIds;
    const updated = current.includes(categoryId)
      ? current.filter((id) => id !== categoryId)
      : [...current, categoryId];
    set({ selectedCategoryIds: updated });
  },

  savePreferences: async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const selectedIds = get().selectedCategoryIds;

    await supabase
      .from("user_interest_preferences")
      .delete()
      .eq("user_id", user.id);

    if (selectedIds.length > 0) {
      await supabase
        .from("user_interest_preferences")
        .insert(
          selectedIds.map((id) => ({ user_id: user.id, category_id: id })),
        );
    }
  },

  saveVoice: async (voiceId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("profiles").update({ preferred_voice_id: voiceId }).eq("id", user.id);
    set((state) => ({
      profile: state.profile ? { ...state.profile, preferred_voice_id: voiceId } : null,
    }));
  },

  setAdaptiveLock: (locked) => set({ adaptiveLock: locked }),

  reset: () => set({ profile: null, selectedCategoryIds: [], categories: [] }),
}));
