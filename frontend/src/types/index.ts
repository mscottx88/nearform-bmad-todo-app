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
  // Story 4.6: null when the pad is solo; set to the owning group's
  // UUID when the pad is a member of a cluster. Populated by the
  // backend `TodoResponse.group_id` via an outerjoin on
  // `group_memberships` (see backend/src/services/todo_service.py).
  groupId: string | null;
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
