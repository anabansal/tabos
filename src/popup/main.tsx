import '@fontsource-variable/inter/opsz.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../ui/styles.css';
import './popup.css';
import { FeedbackProvider } from '../ui/feedback';
import { Popup } from './Popup';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FeedbackProvider>
      <Popup />
    </FeedbackProvider>
  </StrictMode>,
);
