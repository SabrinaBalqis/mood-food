import { TestBed } from '@angular/core/testing';

import { Moodfood } from './moodfood';

describe('Moodfood', () => {
  let service: Moodfood;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Moodfood);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
