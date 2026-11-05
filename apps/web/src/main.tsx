import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './index.css';

const root = document.getElementById('root');
if (root === null) throw new Error('#root not found');
createRoot(root).render(<App />);
