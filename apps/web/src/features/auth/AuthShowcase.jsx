'use client';

import { useEffect, useState } from 'react';
import { LayoutGroup, MotionConfig, motion } from 'motion/react';
import BlurText from '@/components/reactbits/BlurText';

// A small, self-running board: every few seconds one card moves a column to the right,
// the way work moves on the real board. Decorative, so it is hidden from screen readers.
const START = [
  { id: 'a', title: 'Draft the API error contract', column: 0, tone: 'high' },
  { id: 'b', title: 'Connect login to the auth API', column: 1, tone: 'high' },
  { id: 'c', title: 'Keyboard moves on the board', column: 0, tone: 'medium' },
  { id: 'd', title: 'Seed the test database', column: 2, tone: 'medium' },
  { id: 'e', title: 'Accessibility checklist', column: 1, tone: 'low' },
];
const COLUMNS = ['To Do', 'In Progress', 'Done'];
const ORDER = ['b', 'a', 'e', 'c'];

export function AuthShowcase() {
  const [cards, setCards] = useState(START);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setStep((s) => s + 1), 2600);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (step === 0) return;
    const id = ORDER[(step - 1) % ORDER.length];
    setCards((current) => {
      const allDone = current.every((c) => c.column === 2);
      if (allDone) return START;
      return current.map((c) => (c.id === id && c.column < 2 ? { ...c, column: c.column + 1 } : c));
    });
  }, [step]);

  return (
    <aside className="auth-showcase" aria-hidden="true">
      <div className="auth-showcase-copy">
        <BlurText text="Know what is next, together." className="auth-showcase-title" animateBy="words" delay={90} trigger="load" />
        <p className="auth-showcase-sub">
          Projects, one shared board and the reminders that keep a small team moving.
        </p>
      </div>
      <MotionConfig reducedMotion="user" transition={{ type: 'spring', duration: 0.55, bounce: 0.12 }}>
        <LayoutGroup>
          <div className="mini-board">
            {COLUMNS.map((name, columnIndex) => {
              const columnCards = cards.filter((c) => c.column === columnIndex);
              return (
                <div key={name} className="mini-column">
                  <div className="mini-column-head">
                    <span>{name}</span>
                    <span className="tabular">{columnCards.length}</span>
                  </div>
                  {columnCards.map((card) => (
                    <motion.div layout layoutId={card.id} key={card.id} className="mini-card" data-done={columnIndex === 2 || undefined}>
                      <span className="mini-card-bar" data-tone={card.tone} />
                      {card.title}
                    </motion.div>
                  ))}
                </div>
              );
            })}
          </div>
        </LayoutGroup>
      </MotionConfig>
    </aside>
  );
}
