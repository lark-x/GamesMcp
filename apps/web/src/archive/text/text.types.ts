export type TextBookVolume = {
  stableId: string;
  bookStableId: string;
  documentId: string;
  title: string;
  volume: number | string | null;
  order: number;
  segmentCount: number;
  gameVersion?: string | null;
  revision?: string;
};

export type TextBook = {
  stableId: string;
  bookStableId: string;
  title: string;
  volumes: TextBookVolume[];
};

export type TextChapterRef = {
  book: TextBook;
  volume: TextBookVolume;
};
