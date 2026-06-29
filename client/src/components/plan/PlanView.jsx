import React from 'react';
import { theme } from '../../lib/theme.js';
import SavingsPanel from './SavingsPanel.jsx';
import GoalPlanner from './GoalPlanner.jsx';
import DividendProjection from './DividendProjection.jsx';
import DcaBacktest from './DcaBacktest.jsx';

/**
 * "Plan" view — future-planning tools: net worth & savings, a goal projection,
 * dividend-income projection, and a DCA backtest. All amounts respect the
 * active display currency (except the DCA backtest, which is in the asset's
 * native price currency).
 */
export default function PlanView() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space(5) }}>
      <SavingsPanel />
      <GoalPlanner />
      <DividendProjection />
      <DcaBacktest />
    </div>
  );
}
