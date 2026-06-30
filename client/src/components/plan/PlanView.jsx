import React from 'react';
import { theme } from '../../lib/theme.js';
import SavingsPanel from './SavingsPanel.jsx';
import GoalPlanner from './GoalPlanner.jsx';
import RetirementPlanner from './RetirementPlanner.jsx';
import DividendProjection from './DividendProjection.jsx';
import DcaBacktest from './DcaBacktest.jsx';
import ThaiTaxPanel from './ThaiTaxPanel.jsx';

/**
 * "Plan" view — future-planning tools: net worth & savings, a goal projection,
 * a retirement / financial-freedom plan, dividend-income projection, a DCA
 * backtest, and a Thai income-tax estimator. All amounts respect the active
 * display currency (except the DCA backtest, in the asset's native price
 * currency, and the Thai tax tool, in THB).
 */
export default function PlanView() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space(5) }}>
      <SavingsPanel />
      <GoalPlanner />
      <RetirementPlanner />
      <DividendProjection />
      <DcaBacktest />
      <ThaiTaxPanel />
    </div>
  );
}
