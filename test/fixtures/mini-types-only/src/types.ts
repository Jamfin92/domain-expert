/**
 * Plain TypeScript interfaces: the shapes an app passes around when it keeps
 * its data somewhere psq does not read (an API, a file, an ORM). No CREATE
 * TABLE literal exists anywhere in this fixture, so psq extracts 0 entities.
 */
export interface Author {
  id: string;
  name: string;
  email?: string;
}

export interface Post {
  id: string;
  authorId: string;
  title: string;
  publishedAt: string | null;
  tags: string[];
}
