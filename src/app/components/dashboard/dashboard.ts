import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MoodfoodService, Dish } from '../../services/moodfood';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './dashboard.html',
  styleUrls: ['./dashboard.css']
})
export class DashboardComponent implements OnInit {
  private moodService = inject(MoodfoodService);

  // Data
  recipes: Dish[] = [];
  cuisines: string[] = [];
  diets = ['Vegetarian', 'Vegan', 'Gluten Free', 'Ketogenic', 'Pescetarian', 'Paleo', 'Whole30'];

  // The three explicit controls: what / how / boundaries
  filters = {
    cuisine: 'Any',
    diet: '',
    maxCalories: null as number | null,
    mood: ''
  };

  // Mood is the fuzzy, fun fourth lever - a vibe, not a strict filter.
  moods = [
    { key: 'happy', label: 'Happy' },
    { key: 'stressed', label: 'Stressed' },
    { key: 'lazy', label: 'Lazy' },
    { key: 'adventurous', label: 'Adventurous' },
    { key: 'romantic', label: 'Romantic' }
  ];

  setMood(key: string) {
    this.filters.mood = this.filters.mood === key ? '' : key;
  }

  // Result + feedback state
  nowServing = 'Nothing yet';
  statusMessage = 'Set your preferences, then find some recipes.';
  history: Dish[] = [];

  isLoading = false;
  isSpinning = false;

  // Final Round: once you've collected a few winners, spin again among
  // just those to make the actual final call.
  isFinalRound = false;

  // Tracks which search produced the recipes currently loaded, so a spin's
  // winner can be linked back to it in Supabase.
  private currentSessionId: string | null = null;

  // Wheel visuals
  private wheelColors = ['#FF5A4E', '#FFB23E', '#1B9C8E', '#5C2A52'];
  wheelRotation = 0;

  async ngOnInit() {
    this.moodService.getCuisineList().subscribe({
      next: (data: any) => {
        const areas = data.meals.map((m: any) => m.strArea);
        this.cuisines = Array.from(new Set(areas));
      },
      error: (err) => console.error('Cuisine list error:', err)
    });

    // Restore past winners first so History/Final Round work even after a reload.
    this.history = await this.moodService.getPersistedHistory();

    // Load an initial batch so the wheel isn't empty on first paint.
    this.findRecipes();
  }

  get segmentAngle(): number {
    return 360 / Math.max(this.recipes.length, 1);
  }

  get wheelGradient(): string {
    const n = this.recipes.length;
    if (!n) return this.wheelColors[0];
    const slice = 360 / n;
    const stops = this.recipes.map(
      (_, i) => `${this.wheelColors[i % this.wheelColors.length]} ${i * slice}deg ${(i + 1) * slice}deg`
    );
    return `conic-gradient(${stops.join(', ')})`;
  }

  // "Find recipes" - the agency/control action. Talks to the API, fills the wheel,
  // and logs the search + its candidates to Supabase.
  findRecipes() {
    this.isLoading = true;
    this.isFinalRound = false;

    this.moodService.getRecipes(this.filters).subscribe({
      next: async (dishes) => {
        this.currentSessionId = await this.moodService.logSearch(this.filters);
        this.recipes = this.currentSessionId
          ? await this.moodService.saveCandidates(this.currentSessionId, dishes)
          : dishes;

        this.wheelRotation = 0;
        this.statusMessage = dishes.length
          ? `${dishes.length} dish${dishes.length > 1 ? 'es' : ''} loaded — give the wheel a spin!`
          : 'No matches for that combination — try loosening a filter.';
        this.isLoading = false;
      },
      error: () => {
        this.recipes = [];
        this.statusMessage = 'Something went wrong fetching recipes — try again.';
        this.isLoading = false;
      }
    });
  }

  // "Final round" - swaps the wheel's pool to be your collected history,
  // so the next spin picks the actual final answer from what you've already won.
  startFinalRound() {
    if (this.history.length < 2) return;
    this.recipes = [...this.history];
    this.wheelRotation = 0;
    this.isFinalRound = true;
    this.statusMessage = 'Final round — spin to crown your pick.';
  }

  // "Spin" - picks among whatever's currently loaded (either a fresh search,
  // or your history during a Final Round) and animates the wheel to land on it.
  spinRoulette() {
    if (this.isSpinning || this.recipes.length < 2) return;
    this.isSpinning = true;
    this.nowServing = 'Spinning…';

    const winnerIndex = Math.floor(Math.random() * this.recipes.length);
    const angle = (360 - (winnerIndex * this.segmentAngle + this.segmentAngle / 2)) % 360;
    const fullSpins = 4 * 360;
    this.wheelRotation += fullSpins + angle - (this.wheelRotation % 360);

    setTimeout(async () => {
      this.isSpinning = false;
      const winner = this.recipes[winnerIndex];

      if (this.isFinalRound) {
        this.nowServing = winner.title;
        this.statusMessage = `🏆 Final pick: ${winner.title}`;
        this.isFinalRound = false;
        return;
      }

      this.nowServing = winner.title;
      await this.moodService.markWinner(winner.dbId);
      this.history.unshift(winner);
      this.history = this.history.slice(0, 8);
    }, 3200);
  }
}
