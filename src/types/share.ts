export type ShareJoinResult =
  | { status: 'joined' }
  | { status: 'error'; message: string };
