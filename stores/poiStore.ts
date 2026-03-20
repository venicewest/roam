// stores/poiStore.ts
// In-memory POI tile cache — zero network calls during scan loop
import { create } from "zustand/react";
import type { PoiTileItem } from "../services/supabase";

type PoiStore = {
  tile: PoiTileItem[];
  tileCenterLat: number | null;
  tileCenterLon: number | null;
  tileLastFetchedAt: string | null;
  isFetching: boolean;

  setTile: (
    pois: PoiTileItem[],
    centerLat: number,
    centerLon: number,
  ) => void;
  addToTile: (pois: PoiTileItem[]) => void;
  setFetching: (v: boolean) => void;
  clearTile: () => void;

  getPoiById: (id: string) => PoiTileItem | undefined;
};

export const usePoiStore = create<PoiStore>((set, get) => ({
  tile: [],
  tileCenterLat: null,
  tileCenterLon: null,
  tileLastFetchedAt: null,
  isFetching: false,

  setTile: (pois, centerLat, centerLon) =>
    set({
      tile: pois,
      tileCenterLat: centerLat,
      tileCenterLon: centerLon,
      tileLastFetchedAt: new Date().toISOString(),
      isFetching: false,
    }),

  addToTile: (pois) =>
    set((s) => {
      const existingIds = new Set(s.tile.map((p) => p.id));
      const newPois = pois.filter((p) => !existingIds.has(p.id));
      return { tile: [...s.tile, ...newPois] };
    }),

  setFetching: (v) => set({ isFetching: v }),

  clearTile: () =>
    set({
      tile: [],
      tileCenterLat: null,
      tileCenterLon: null,
      tileLastFetchedAt: null,
      isFetching: false,
    }),

  getPoiById: (id) => get().tile.find((p) => p.id === id),
}));
