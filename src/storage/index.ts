import type { PendingSelection, RefinementItem } from '../shared/types';
import { STORAGE_KEYS } from '../shared/types';

export async function getItems(): Promise<RefinementItem[]> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.items);
  return (result[STORAGE_KEYS.items] as RefinementItem[] | undefined) ?? [];
}

export async function setItems(items: RefinementItem[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.items]: items });
}

export async function addItem(item: RefinementItem): Promise<RefinementItem[]> {
  const items = await getItems();
  const next = [item, ...items];
  await setItems(next);
  return next;
}

export async function updateItem(
  id: string,
  patch: Partial<RefinementItem>,
): Promise<RefinementItem[]> {
  const items = await getItems();
  const next = items.map((i) => (i.id === id ? { ...i, ...patch } : i));
  await setItems(next);
  return next;
}

export async function deleteItem(id: string): Promise<RefinementItem[]> {
  const items = await getItems();
  const next = items.filter((i) => i.id !== id);
  await setItems(next);
  return next;
}

export async function getPendingSelection(): Promise<PendingSelection | null> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.pending);
  return (result[STORAGE_KEYS.pending] as PendingSelection | undefined) ?? null;
}

export async function setPendingSelection(p: PendingSelection): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.pending]: p });
}

export async function updatePendingSelection(
  patch: Partial<PendingSelection>,
): Promise<PendingSelection | null> {
  const current = await getPendingSelection();
  if (!current) return null;
  const next = { ...current, ...patch };
  await setPendingSelection(next);
  return next;
}

export async function clearPendingSelection(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.pending);
}

export function subscribeToStorage(
  handler: (changes: { [key: string]: chrome.storage.StorageChange }) => void,
): () => void {
  const listener = (
    changes: { [key: string]: chrome.storage.StorageChange },
    areaName: string,
  ) => {
    if (areaName === 'local') handler(changes);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
