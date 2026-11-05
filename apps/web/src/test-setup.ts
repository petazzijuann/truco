import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Vitest runs without globals here, so Testing Library's automatic teardown never
// registers itself. Without this, each test renders on top of the last one.
afterEach(cleanup);
