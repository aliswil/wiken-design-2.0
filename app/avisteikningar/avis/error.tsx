'use client';

import styles from '@/components/avis/avis.module.css';

export default function AvisError() {
  return (
    <div lang="nn" className={styles.notice}>
      <h1>Avisteikningar</h1>
      <p>Avisa er ikkje tilgjengeleg akkurat no. Prøv igjen litt seinare.</p>
    </div>
  );
}
