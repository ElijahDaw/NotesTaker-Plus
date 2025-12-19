import type { NoteDocument } from '../types/note';
import { supabase } from './supabaseClient';

const TABLE_NAME = 'documents';

export interface SharedDocumentRecord {
  share_id: string;
  payload: NoteDocument;
  updated_at: string;
}

export const fetchSharedDocument = async (shareId: string): Promise<SharedDocumentRecord | null> => {
  if (!shareId) return null;
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('share_id, payload, updated_at')
    .eq('share_id', shareId)
    .maybeSingle();
  if (error) {
    console.error('Failed to fetch document', error);
    return null;
  }
  return data as SharedDocumentRecord | null;
};

export const upsertSharedDocument = async (shareId: string, document: NoteDocument) => {
  if (!shareId) return;
  const payload = { ...document, shareId };
  await supabase.from(TABLE_NAME).upsert({
    share_id: shareId,
    payload,
    updated_at: payload.sharedUpdatedAt ?? new Date().toISOString()
  }, { onConflict: 'share_id' });
};
