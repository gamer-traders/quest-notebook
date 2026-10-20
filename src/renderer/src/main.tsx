import '@fontsource/instrument-sans/400.css';
import '@fontsource/instrument-sans/500.css';
import '@fontsource/instrument-sans/600.css';
import '@fontsource/newsreader/400.css';
import '@fontsource/newsreader/400-italic.css';
import '@fontsource/newsreader/600.css';
import './styles.css';
import { createRoot } from 'react-dom/client';
import { mountApp } from './mountApp';

mountApp(createRoot(document.getElementById('root')!));
