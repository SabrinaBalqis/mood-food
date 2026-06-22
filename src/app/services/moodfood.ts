import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { SupabaseService } from './supabase.service';

// One shared shape for both APIs so the component/template never has to care
// which source a dish came from. dbId is only set once a dish has been saved
// to mf_recipes, and is what we use later to mark it as the spin winner.
export interface Dish {
  id: string;
  title: string;
  image: string;
  source: 'mealdb' | 'spoonacular';
  dbId?: string;
}

export interface RecipeFilters {
  cuisine?: string;
  diet?: string;
  maxCalories?: number | null;
  mood?: string;
}

@Injectable({ providedIn: 'root' })
export class MoodfoodService {
  private supabase = inject(SupabaseService);

  constructor(private http: HttpClient) {}

  // Mood is fuzzy by nature, so it doesn't map to a strict API field - instead
  // each mood nudges the free-text search query toward food that matches the vibe.
  private moodQueries: Record<string, string> = {
    happy: 'celebration treat',
    stressed: 'comfort soup',
    lazy: 'quick easy',
    adventurous: 'spicy fusion',
    romantic: 'chocolate dessert'
  };

  // ---------- External recipe APIs ----------

  getCuisineList(): Observable<any> {
    return this.http.get(
      `https://www.themealdb.com/api/json/v1/${environment.mealDbApiKey}/list.php?a=list`
    );
  }

  getRecipes(filters: RecipeFilters): Observable<Dish[]> {
    const hasCuisine = !!filters.cuisine && filters.cuisine !== 'Any';
    const hasMood = !!filters.mood;
    // Mood needs a free-text query, which TheMealDB's area filter can't combine with -
    // so a mood pick routes to Spoonacular just like diet/calories do.
    const needsSpoonacular = !!filters.diet || !!filters.maxCalories || hasMood;

    if (hasCuisine && !needsSpoonacular) {
      return this.http
        .get(`https://www.themealdb.com/api/json/v1/${environment.mealDbApiKey}/filter.php?a=${filters.cuisine}`)
        .pipe(map((res: any) => this.normalizeMealDb(res.meals)));
    }

    let url = `https://api.spoonacular.com/recipes/complexSearch?apiKey=${environment.spoonacularApiKey}&number=10&sort=random`;
    if (hasCuisine) url += `&cuisine=${encodeURIComponent(filters.cuisine!)}`;
    if (filters.diet) url += `&diet=${encodeURIComponent(filters.diet)}`;
    if (filters.maxCalories) url += `&maxCalories=${filters.maxCalories}`;

    const queryText = hasMood ? this.moodQueries[filters.mood!] || filters.mood : '';
    if (queryText) url += `&query=${encodeURIComponent(queryText)}`;

    return this.http
      .get(url)
      .pipe(map((res: any) => this.normalizeSpoonacular(res.results || [])));
  }

  private normalizeSpoonacular(results: any[]): Dish[] {
    return results.map((r) => ({
      id: String(r.id),
      title: r.title,
      image: r.image,
      source: 'spoonacular' as const
    }));
  }

  private normalizeMealDb(meals: any[]): Dish[] {
    return (meals || []).map((m) => ({
      id: m.idMeal,
      title: m.strMeal,
      image: m.strMealThumb,
      source: 'mealdb' as const
    }));
  }

  // ---------- Supabase persistence ----------

  // Logs one "Find recipes" search and returns the new mf_mood_logs row id.
  async logSearch(filters: RecipeFilters): Promise<string | null> {
    const { data, error } = await this.supabase.client
      .from('mf_mood_logs')
      .insert({
        mood: filters.mood || null,
        cuisine: filters.cuisine && filters.cuisine !== 'Any' ? filters.cuisine : null,
        diet: filters.diet || null,
        max_calories: filters.maxCalories ?? null
      })
      .select('id')
      .single();

    if (error) {
      console.error('logSearch error:', error);
      return null;
    }
    return data.id;
  }

  // Saves the candidate pool shown for a search, linked to that search's session id.
  // Returns the same dishes with dbId filled in, so a later spin can mark a winner.
  async saveCandidates(sessionId: string, dishes: Dish[]): Promise<Dish[]> {
    const rows = dishes.map((d) => ({
      session_id: sessionId,
      api_recipe_id: Number(d.id),
      title: d.title,
      image_url: d.image,
      source: d.source
    }));

    const { data, error } = await this.supabase.client.from('mf_recipes').insert(rows).select();

    if (error || !data) {
      console.error('saveCandidates error:', error);
      return dishes;
    }
    return dishes.map((d, i) => ({ ...d, dbId: data[i].id }));
  }

  // Marks a saved candidate as the one a spin actually landed on.
  async markWinner(dbId: string | undefined): Promise<void> {
    if (!dbId) return;
    const { error } = await this.supabase.client
      .from('mf_recipes')
      .update({ is_winner: true })
      .eq('id', dbId);
    if (error) console.error('markWinner error:', error);
  }

  // Loads past winners, most recent first - this is what makes History (and the
  // Final Round feature) survive a page reload.
  async getPersistedHistory(limit = 8): Promise<Dish[]> {
    const { data, error } = await this.supabase.client
      .from('mf_recipes')
      .select('id, api_recipe_id, title, image_url, source')
      .eq('is_winner', true)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error || !data) {
      console.error('getPersistedHistory error:', error);
      return [];
    }
    return data.map((r: any) => ({
      id: String(r.api_recipe_id),
      dbId: r.id,
      title: r.title,
      image: r.image_url,
      source: r.source
    }));
  }
}