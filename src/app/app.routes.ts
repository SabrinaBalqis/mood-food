import { Routes } from '@angular/router';
import { DashboardComponent } from './components/dashboard/dashboard'; // Adjust path if needed

export const routes: Routes = [
  { path: '', component: DashboardComponent }, // Empty path means "home"
  { path: '**', redirectTo: '' } // Fallback
];