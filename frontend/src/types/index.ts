export interface Todo {
  id: string;
  text: string;
  completed: boolean;
  color: string;
  positionX: number | null;
  positionY: number | null;
  rotationY: number;
  driftSeed: number;
  embeddingStatus: 'pending' | 'complete' | 'failed';
  archived: boolean;
  archivedAt: string | null;
  deleted: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Creature {
  id: string;
  todoId: string | null;
  creatureType: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'legendary' | 'resident';
  createdAt: string;
}

export type AtmosphereMode = 'zen' | 'cyberpunk';

export type SearchMatchType = 'keyword' | 'semantic' | 'hybrid';

export interface SearchHit {
  score: number;
  matchType: SearchMatchType;
}

export interface SearchResult {
  todo: Todo;
  score: number;
  matchType: SearchMatchType;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  vectorSearchUnavailable: boolean;
  ftsSupported: boolean;
}
