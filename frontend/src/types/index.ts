export interface Todo {
  id: string;
  text: string;
  completed: boolean;
  color: string;
  positionX: number | null;
  positionY: number | null;
  embeddingStatus: 'pending' | 'complete' | 'failed';
  archived: boolean;
  archivedAt: string | null;
  deleted: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Group {
  id: string;
  label: string | null;
  positionX: number | null;
  positionY: number | null;
  createdAt: string;
  memberIds: string[];
}

export interface Creature {
  id: string;
  todoId: string | null;
  creatureType: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'legendary' | 'resident';
  createdAt: string;
}

export type AtmosphereMode = 'zen' | 'cyberpunk';

export interface SearchResult {
  todo: Todo;
  score: number;
}

export interface SearchResponse {
  results: SearchResult[];
  query: string;
}
