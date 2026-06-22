export interface Recipe {
  id: number;
  title: string;
  image: string;
  summary?: string;
  readyInMinutes?: number;
}